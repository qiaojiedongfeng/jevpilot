import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation.js";
import {
  makeActor,
  newChallenge,
  applyChallengeActors,
} from "../src/challenge-model.js";
import { pointAt, move, dist, nearestOnPath } from "../src/math.js";
import { passingOpportunity, passingOffset } from "../src/passing.js";
import {
  candidateChoices,
} from "../src/planning.js";
import { createDrivingPlan } from "../src/driving-plan.js";

test("authored motorcycle continues beyond its waypoint, stop option stays put", () => {
  for (const behavior of ["continue", "stop"]) {
    const sim = new Simulation(42, "town");
    sim.traffic = [];
    sim.pedestrians = [];
    const draft = newChallenge(sim.world);
    const a = makeActor(
      sim.world,
      "bike",
      pointAt(sim.world.route.points, 30),
      "challenge-motion",
    );
    a.endBehavior = behavior;
    draft.actors = [a];
    applyChallengeActors(sim, draft);
    const bike = sim.traffic[0];
    for (let i = 0; i < 1600; i++) sim.step(0.05);
    assert.equal(sim.crash, null);
    if (behavior === "continue") assert(dist(bike, a.target) > 10);
    else assert(dist(bike, a.target) < 0.01);
  }
});

function interstate() {
  const sim = new Simulation(42, "highway");
  const section = sim.player.route.sections.find(
    (s) => s.kind === "interstate",
  );
  const s = section.startS + 60;
  Object.assign(sim.player, pointAt(sim.player.route.points, s), {
    s,
    speed: 5,
  });
  const obstacle = {
    ...pointAt(sim.player.route.points, s + 35),
    id: "blocker",
    type: "car",
    speed: 0,
    width: 1.9,
    depth: 4.2,
  };
  return { sim, obstacle, s };
}
test("checked interstate pass is offered and completes a collision-free return", () => {
  const { sim, obstacle, s } = interstate(),
    car = sim.player;
  const pass = passingOpportunity(car, sim.world, [obstacle]);
  assert(pass);
  assert.equal(passingOffset(pass, pass.end), 0);
  const plan = createDrivingPlan(
    car,
    sim.world,
    [obstacle],
    () => 0.5,
    "test",
    20,
  );
  const candidate = Object.values(
    candidateChoices({ vectors: plan.vectors }),
  ).find((v) => v.passing_safe);
  assert(candidate);
  obstacle.kind = "parked";
  obstacle.scripted = {};
  sim.traffic = [obstacle];
  sim.pedestrians = [];
  sim.autopilot = true;
  car.maneuver = candidate;
  car.target = candidate.velocity_mps;
  for (let i = 0; i < 800 && car.s < pass.end + 10; i++) sim.step(0.05);
  assert.equal(sim.crash, null);
  assert(car.s > pass.end, `stalled at ${car.s - s}`);
  assert(nearestOnPath(car, car.route.points).distance < 0.5);
});
test("passing denied for rear/side traffic, approaching exit and urban roads", () => {
  const { sim, obstacle, s } = interstate(),
    car = sim.player;
  const rear = {
    ...obstacle,
    ...move(pointAt(car.route.points, s - 12), car.heading + Math.PI / 2, -4.5),
    id: "rear",
    speed: 25,
  };
  assert.equal(passingOpportunity(car, sim.world, [obstacle, rear]), null);
  const section = car.route.sections.find((s) => s.kind === "interstate");
  Object.assign(car, pointAt(car.route.points, section.endS - 40));
  assert.equal(passingOpportunity(car, sim.world, [obstacle]), null);
  const town = new Simulation(42, "town");
  assert.equal(passingOpportunity(town.player, town.world, [obstacle]), null);
});
