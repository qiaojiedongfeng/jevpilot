import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation.js";
import { emptyDraft, newActor, validateDraft, installActors, stepActor, TrialScore } from "../src/arena-model.js";
import { validState } from "../server/jev.js";

test("fixed exam has a short road and no random traffic or mandatory stop", () => {
  const sim = new Simulation(42, "arena");
  assert.equal(sim.world.route.length, 211);
  assert.equal(sim.traffic.length + sim.pedestrians.length, 0);
  assert.equal(sim.rule(sim.player).mustStop, false);
  assert(validState(sim.decisionState()));
});
test("all four objects load into the real simulation and survive reset identically", () => {
  const draft = emptyDraft();
  draft.actors = [newActor("slow", { x: 3, z: 65 }), newActor("parked", { x: -3, z: -40 }), newActor("bike", { x: -25, z: 3 }), newActor("pedestrian", { x: 9, z: 15 })];
  const original = structuredClone(draft);
  const sim = new Simulation(42, "arena"); installActors(sim, draft);
  const initial = structuredClone([...sim.traffic, ...sim.pedestrians]);
  assert.equal(sim.traffic.length, 3); assert.equal(sim.pedestrians.length, 1);
  for (let i = 0; i < 20; i++) sim.step(.05);
  assert(sim.traffic[0].z < 65); assert.equal(sim.traffic[1].z, -40);
  assert.deepEqual(draft, original);
  sim.reset(42, "arena"); installActors(sim, draft);
  assert.deepEqual([...sim.traffic, ...sim.pedestrians], initial);
});
test("proximity trigger fires once and actors stop at the authored endpoint", () => {
  const draft = emptyDraft(), a = newActor("pedestrian", { x: 9, z: 0 }); draft.actors.push(a);
  const sim = new Simulation(42, "arena"); installActors(sim, draft); const p = sim.pedestrians[0];
  stepActor(p, { x: 3, z: 100 }, 1); assert.equal(p.s, 0);
  stepActor(p, { x: 3, z: 0 }, 1); assert(p.s > 0);
  const started = p.s; stepActor(p, { x: 3, z: 100 }, 1); assert(p.s > started);
  stepActor(p, sim.player, 100); assert.equal(p.x, a.target.x); assert.equal(p.z, a.target.z);
  stepActor(p, sim.player, 1); assert.equal(p.speed, 0);
});
test("invalid placements, crossings through grass and overlapping actors are rejected", () => {
  const draft = emptyDraft(); draft.actors.push(newActor("slow", { x: 3, z: 60 }));
  assert.equal(validateDraft(draft), null);
  for (const changes of [{ x: 200 }, { speed: NaN }, { speed: 999 }, { distance: 0 }, { target: { x: 30, z: 3 } }]) {
    const bad = structuredClone(draft); Object.assign(bad.actors[0], changes); assert(validateDraft(bad));
  }
  draft.actors.push(newActor("parked", { x: 3, z: 60 })); assert(validateDraft(draft));
  assert(validateDraft({ ...draft, actors: [{ kind: "constructor" }] }));
});
test("scripted objects participate in actual player collisions", () => {
  const sim = new Simulation(42, "arena"), draft = emptyDraft();
  draft.actors.push(newActor("parked", { x: 3, z: 90 })); installActors(sim, draft);
  sim.player.z = 92; sim.step(.05);
  assert.equal(sim.collisions, 1); assert.equal(sim.crash.object_id, draft.actors[0].id);
});
test("scripted actors are visible in Jev observations", () => {
  const sim = new Simulation(42, "arena"), draft = emptyDraft();
  const a = newActor("pedestrian", { x: 5, z: 86 }); draft.actors.push(a); installActors(sim, draft);
  const state = sim.decisionState(); assert(validState(state));
  assert(JSON.stringify(state).includes(a.id));
});
test("score distinguishes arrival, collision and timeout; interventions count episodes", () => {
  for (const outcome of ["arrived", "collision", "timeout"]) {
    const sim = new Simulation(42, "arena"), score = new TrialScore();
    sim.brakeReason = "Vehicle ahead"; score.update(sim); score.update(sim);
    sim.brakeReason = null; score.update(sim); sim.brakeReason = "Vehicle ahead"; score.update(sim);
    assert.equal(score.interventions, 2);
    if (outcome === "arrived") sim.complete = true;
    if (outcome === "collision") { sim.crash = {}; sim.collisions = 1; }
    if (outcome === "timeout") sim.time = 90;
    const result = score.update(sim, .002); assert.equal(result.outcome, outcome); assert.equal(result.cost, .002);
    sim.time = 99; assert.equal(score.update(sim), result);
  }
});
