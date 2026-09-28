import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/simulation.js';
import {pointAt, move, nearestOnPath} from '../src/math.js';
import {candidateChoices, decisionControls} from '../src/planning.js';
import {prepareJevRequest} from '../src/jev-request.js';
import {ChallengeScore} from '../src/challenge-model.js';
import {evaluate, validState} from '../server/jev.js';
import {recordDecision} from '../src/decision-trace.js';
import {diagnosticSnapshot} from '../src/traffic-diagnostics.js';

function fixture() {
  const sim = new Simulation(973617, 'city'), car = sim.player;
  car.s = 195; Object.assign(car, pointAt(car.route.points, car.s)); car.speed = 12 / 3.6;
  const s = car.s + 18;
  sim.traffic = [{...pointAt(car.route.points, s), id: 'slow', type: 'car', s,
    speed: 12 / 3.6, width: 1.9, depth: 4.2, stops: {}, route: car.route,
    scripted: {traffic: true, active: true, speed: 12 / 3.6}}];
  sim.pedestrians = [];
  sim.challengeClock = {limit_s: 150, elapsed_s: 40};
  return sim;
}

function mockChoice(t, choosePass) {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    const aliases = Object.keys(request.state.maneuvers);
    const chosen = aliases.find(id => (request.state.maneuvers[id].action === 'pass_and_return') === choosePass);
    assert(chosen, 'both strategies reach the model');
    return Response.json({usage: {input_tokens: 100, output_tokens: 10},
      answers: Object.fromEntries(Object.entries(request.questions).map(([name, q]) => {
        const ids = Object.keys(q.criteria);
        const choice = name === 'vector' ? chosen : ids.includes('drive') ? 'drive' : ids[0];
        return [name, {choice, probabilities: Object.fromEntries(ids.map(id => [id, Number(id === choice)]))}];
      }))});
  });
}

test('server accepts a real pass batch, lets the model choose either strategy, and executes its pass', async t => {
  const sim = fixture();
  const state = sim.decisionState(), choices = Object.values(candidateChoices(state));
  assert(choices.some(v => v.passing_safe));
  assert(choices.some(v => !v.passing && v.velocity_mps > 0));
  assert(validState(state));
  mockChoice(t, true);
  const attempt = recordDecision(sim, state);
  const decision = await evaluate(state, {TYPESAFE_API_KEY: 'test-key'});
  assert(decisionControls(state, decision));
  const selected = state.vectors[decision.selection.choice];
  assert(selected.passing);
  Object.assign(attempt, {selected: decision.selection.choice, status: 'applied'});
  sim.player.maneuver = selected; sim.player.target = decision.controls.velocity;
  sim.autopilot = true;
  for (let i = 0; i < 400 && sim.player.s < selected.passing.end + 2; i++) sim.step(0.05);
  assert.equal(sim.crash, null);
  assert(sim.player.s > selected.passing.end);
  const snapshot = diagnosticSnapshot(sim);
  assert(snapshot.decision_trace.some(x => x.status === 'applied'));
  assert(snapshot.decision_trace.some(x => x.kind === 'execution' && x.passing));
  assert(!JSON.stringify(snapshot).includes('test-key'));
});

test('model can choose following even when a pass is offered', async t => {
  const sim = fixture(), state = sim.decisionState();
  mockChoice(t, false);
  const decision = await evaluate(state, {TYPESAFE_API_KEY: 'test-key'});
  assert.equal(state.vectors[decision.selection.choice].passing, null);
});

test('a blocked active pass offers a checked return instead of only stopping forever', () => {
  const sim = fixture(), car = sim.player;
  const initial = sim.decisionState();
  car.maneuver = Object.values(candidateChoices(initial)).find(v => v.passing_safe);
  car.target = car.maneuver.velocity_mps; sim.autopilot = true;
  for (let i = 0; i < 30; i++) sim.step(0.05);
  const p = pointAt(car.route.points, car.s + 30);
  sim.traffic.push({...move(p, p.heading + Math.PI / 2, -6), id: 'new-obstacle',
    type: 'car', kind: 'parked', heading: p.heading, speed: 0, width: 1.9, depth: 4.2,
    s: 0, stops: {}, scripted: {}, route: {points: [], crossings: [], length: 0}});
  car.target = 0;
  for (let i = 0; i < 40; i++) sim.step(0.05);
  const state = sim.decisionState();
  assert(state.traffic.passing_blocked);
  const returning = Object.values(candidateChoices(state)).find(v => v.velocity_mps > 0 && !v.passing && v.returning_to_lane);
  assert(returning);
  assert(validState(state));
  car.maneuver = returning; car.target = returning.velocity_mps;
  for (let i = 0; i < 300 && nearestOnPath(car, car.route.points).distance >= 0.6; i++) sim.step(0.05);
  assert.equal(sim.crash, null);
  assert(nearestOnPath(car, car.route.points).distance < 0.7);
});

test('wide offsets require a bounded checked passing profile', () => {
  const original = fixture().decisionState();
  const id = Object.keys(original.vectors).find(id => original.vectors[id].passing_safe);
  for (const corrupt of [v => {v.passing = null;}, v => {v.passing.end = Infinity;},
    v => {v.passing.offset = -20;}, v => {v.passing.speed = 99;},
    v => {v.passing.end = v.passing.start - 1;}, v => {v.collision_predicted = true;}]) {
    const state = structuredClone(original); corrupt(state.vectors[id]);
    assert.equal(validState(state), false);
  }
});

test('seed 309983: an outward-pointing stopped pass can abort and return without a lane-containment deadlock', () => {
  const sim = new Simulation(309983, 'city'), car = sim.player;
  // Exact ego pose from the user snapshot: stopped halfway out of the lane.
  Object.assign(car, {x: -118.3515628371601, z: 27.704162757529026,
    heading: 1.0870220707229454, s: 185.86447282776118, speed: 0,
    steering: -0.06196069039249189,
    maneuver: {passing: {kind: 'urban', start: 172.8164295738364,
      end: 233.70361835506958, object_id: 'departed-lead', speed: 8,
      offset: -6, transition: 12, moving: true}}});
  const s = 255;
  sim.traffic = [{...pointAt(car.route.points, s), id: 'departed-lead', type: 'car',
    s, speed: 3.33, width: 1.9, depth: 4.2, stops: {}, route: car.route,
    scripted: {traffic: true, active: true, speed: 3.33}}];
  sim.pedestrians = [];
  const state = sim.decisionState();
  assert(state.traffic.passing_blocked);
  const returning = Object.values(candidateChoices(state)).find(v => v.returning_to_lane && v.velocity_mps > 0);
  assert(returning, 'a checked return must reach the model even if the initial outward arc increases lane excess');
  assert(!returning.passing && !returning.collision_predicted && returning.stays_on_road);
  assert(validState(state));
  car.maneuver = returning; car.target = returning.velocity_mps; sim.autopilot = true;
  for (let i = 0; i < 240 && nearestOnPath(car, car.route.points).distance >= 0.6; i++) sim.step(0.05);
  assert.equal(sim.crash, null);
  assert(nearestOnPath(car, car.route.points).distance < 0.6);
});

test('deliberate lane-change heading does not invoke a distant right-turn speed cap', () => {
  const sim = new Simulation(412146, 'city'), car = sim.player;
  car.s = 317; Object.assign(car, pointAt(car.route.points, car.s)); car.speed = 3.33;
  const s = car.s + 10;
  sim.traffic = [{...pointAt(car.route.points, s), id: 'slow', type: 'car', s,
    speed: 3.33, width: 1.9, depth: 4.2, stops: {}, route: car.route,
    scripted: {traffic: true, active: true, speed: 3.33}}];
  sim.pedestrians = [];
  car.maneuver = Object.values(sim.decisionState().vectors).find(v => v.passing_safe);
  assert(car.maneuver);
  car.target = 8; sim.autopilot = true;
  for (let i = 0; i < 20; i++) sim.step(0.05);
  assert(Math.abs(sim.navigation().heading_error_deg) > 15);
  const state = sim.decisionState();
  assert.equal(state.traffic.passing_blocked, false);
  assert(Object.values(candidateChoices(state)).some(v => v.passing_safe && v.velocity_mps > 0));
});

test('actual request carries challenge time and distance, free driving does not', () => {
  const sim = fixture();
  const score = new ChallengeScore(150);
  score.update(sim, 40, 0);
  const state = sim.decisionState(), request = prepareJevRequest(state).request;
  assert.equal(request.state.challenge.elapsed_s, 40);
  assert.equal(request.state.challenge.remaining_s, 110);
  assert.equal(request.state.challenge.remaining_m, request.state.nav.remaining_m);
  score.update(sim, 110, 0);
  assert.equal(prepareJevRequest(sim.decisionState()).request.state.challenge.remaining_s, 0);
  sim.reset(973617, 'city');
  assert.equal(prepareJevRequest(sim.decisionState()).request.state.challenge, undefined);
  assert.deepEqual(sim.decisionTrace, []);
});
