import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation.js";
import { pointAt, dist } from "../src/math.js";
import {
  newChallenge,
  makeActor,
  retargetActor,
  validateChallenge,
  applyChallengeActors,
  ChallengeScore,
} from "../src/challenge-model.js";
import { stepActor } from "../src/arena-model.js";

for (const type of ["city", "town", "highway"])
  test(`${type}: authored cars follow the real road while native traffic is retained`, () => {
    const sim = new Simulation(42, type),
      draft = newChallenge(sim.world);
    const native = sim.traffic.map((v) => v.id),
      pedestrians = sim.pedestrians.map((v) => v.id);
    let actor;
    for (let s = 30; s < sim.world.route.length - 80; s += 15) {
      const candidate = makeActor(
        sim.world,
        "slow",
        pointAt(sim.world.route.points, s),
        "challenge-test-1",
      );
      draft.actors = [candidate];
      if (
        !validateChallenge(draft, sim.world, [
          ...sim.traffic,
          ...sim.pedestrians,
        ])
      ) {
        actor = candidate;
        break;
      }
    }
    assert(actor, "at least one usable road placement");
    applyChallengeActors(sim, draft);
    assert.deepEqual(
      sim.traffic.filter((v) => !v.scripted).map((v) => v.id),
      native,
    );
    assert.deepEqual(
      sim.pedestrians.map((v) => v.id),
      pedestrians,
    );
    const saved = structuredClone(draft),
      runtime = sim.traffic.find((v) => v.scripted);
    for (let i = 0; i < 60; i++) stepActor(runtime, sim.player, 0.05);
    assert(dist(runtime, actor) > 1);
    assert.deepEqual(draft, saved);
    const again = new Simulation(42, type);
    applyChallengeActors(again, draft);
    assert.equal(again.traffic.find((v) => v.scripted).s, 0);
    assert.deepEqual(
      again.traffic.filter((v) => !v.scripted),
      new Simulation(42, type).traffic,
    );
    draft.actors = [];
    applyChallengeActors(sim, draft);
    assert.equal(sim.traffic.length, native.length);
  });
test("a proximity-triggered pedestrian walks once and finishes exactly at the endpoint", () => {
  const sim = new Simulation(42, "town"),
    draft = newChallenge(sim.world);
  const base = pointAt(sim.world.route.points, 50),
    a = makeActor(sim.world, "pedestrian", base, "challenge-test-2");
  a.path = [
    { x: base.x, z: base.z },
    { x: base.x + 2, z: base.z + 2 },
  ];
  a.target = a.path[1];
  draft.actors = [a];
  sim.traffic = [];
  sim.pedestrians = [];
  applyChallengeActors(sim, draft);
  const p = sim.pedestrians[0];
  stepActor(p, { x: p.x + 200, z: p.z }, 1);
  assert.equal(p.s, 0);
  stepActor(p, { x: p.x, z: p.z }, 0.05);
  assert(p.s > 0);
  stepActor(p, { x: p.x + 200, z: p.z }, 20);
  assert(dist(p, a.target) < 1e-8);
  stepActor(p, sim.player, 0.05);
  assert.equal(p.speed, 0);
});
test("invalid imports cannot set out-of-bounds actors, grass paths, duplicate IDs or invalid clocks", () => {
  const sim = new Simulation(42, "town"),
    draft = newChallenge(sim.world);
  draft.actors = [
    makeActor(
      sim.world,
      "slow",
      pointAt(sim.world.route.points, 35),
      "challenge-test-3",
    ),
  ];
  assert.equal(validateChallenge(draft, sim.world), null);
  for (const limit of [NaN, 0, 29, 1801])
    assert(validateChallenge({ ...draft, limit }, sim.world));
  const bad = structuredClone(draft);
  bad.actors[0].target = { x: 9999, z: 9999 };
  assert(validateChallenge(bad, sim.world));
  const duplicate = structuredClone(draft);
  duplicate.actors.push(structuredClone(duplicate.actors[0]));
  assert(validateChallenge(duplicate, sim.world));
  const grass = structuredClone(draft),
    a = grass.actors[0];
  a.x += 20;
  a.path = a.path.map((p) => ({ x: p.x + 20, z: p.z }));
  a.target = a.path.at(-1);
  assert(validateChallenge(grass, sim.world));
});
test("deadline is independent of API wall time and collision has priority over arrival", () => {
  const sim = new Simulation(42, "city"),
    score = new ChallengeScore(30);
  for (let i = 0; i < 29; i++) assert.equal(score.update(sim, 1, 0.001), null);
  assert.equal(score.elapsed, 29);
  const result = score.update(sim, 1, 0.002);
  assert.equal(result.outcome, "timeout");
  assert.equal(result.elapsed, 30);
  assert.equal(score.update(sim, 3, 0.003), result);
  const collision = new ChallengeScore(30);
  sim.crash = {};
  sim.complete = true;
  sim.collisions = 1;
  assert.equal(collision.update(sim, 0.1, 0).outcome, "collision");
  sim.crash = null;
  assert.equal(new ChallengeScore(30).update(sim, 0.1, 0).outcome, "arrived");
});
test("moving authored paths participate in real simulation collisions", () => {
  const sim = new Simulation(42, "town"),
    draft = newChallenge(sim.world);
  draft.actors = [
    makeActor(
      sim.world,
      "parked",
      pointAt(sim.world.route.points, 40),
      "challenge-test-4",
    ),
  ];
  sim.traffic = [];
  sim.pedestrians = [];
  applyChallengeActors(sim, draft);
  const v = sim.traffic[0];
  sim.player.x = v.x;
  sim.player.z = v.z;
  sim.step(0.025);
  assert.equal(sim.crash.object_id, v.id);
  assert.equal(sim.collisions, 1);
});
