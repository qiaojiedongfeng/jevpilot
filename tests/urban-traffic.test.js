import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/simulation.js';
import {pointAt, move, nearestOnPath, samplePolyline} from '../src/math.js';
import {passingOpportunity, urbanPassingAssessment} from '../src/passing.js';
import {vehicleDiagnostic, diagnosticSnapshot} from '../src/traffic-diagnostics.js';
import {createDrivingPlan} from '../src/driving-plan.js';
import {candidateChoices} from '../src/planning.js';
import {followingGap, followingSpeed, leadVehicle} from '../src/traffic-safety.js';
import {prepareJevRequest} from '../src/jev-request.js';

test('green NPC ignores nonconflicting reservation, but respects occupied path and red', () => {
  const sim = new Simulation(42,'town');
  const v = {...sim.player, id:'test-npc', stops:{}};
  const c = v.route.crossings[0], node = sim.world.byId[c.nodeId];
  node.control = 'signal'; node.offset = 0;
  v.s = c.stopS - 8; Object.assign(v, pointAt(v.route.points,v.s));
  sim.time = Math.abs(Math.cos(c.approach)) > 0.5 ? 2 : 12;
  const holder = {...v, id:'holder', ...move(pointAt(v.route.points,c.stopS+3),c.approach+Math.PI/2,6), speed:0, route:{points:v.route.points,crossings:[],length:v.route.length}};
  sim.traffic = [v,holder]; sim.pedestrians = [];
  sim.locks.set(node.id,{id:holder.id,at:sim.time});
  assert.equal(sim.rule(v).color,'green');
  assert.equal(sim.rule(v).mustStop,false);
  Object.assign(holder,pointAt(v.route.points,c.stopS+3));
  assert.equal(sim.rule(v).reason,'Yield to crossing traffic');
  sim.time = 21;
  assert.equal(sim.rule(v).mustStop,true);
});

function urban(type = 'town') {
  const sim = new Simulation(42,type);
  const car = sim.player;
  car.s = 20; Object.assign(car,pointAt(car.route.points,car.s));
  car.speed=0; car.waitingSince=0; car.observedTime=10; sim.time=10;
  const obstacle={...pointAt(car.route.points,car.s+20),id:'blocker',type:'car',kind:'parked',scripted:{},speed:0,width:1.9,depth:4.2,waitingSince:0,stops:{},s:0,route:{points:car.route.points,crossings:[],length:car.route.length}};
  sim.traffic=[obstacle]; sim.pedestrians=[];
  return {sim,car,obstacle};
}

function movingUrban(speed = 12 / 3.6, type = 'town') {
  const fixture = urban(type);
  const {car, obstacle} = fixture;
  car.speed = speed;
  car.waitingSince = null;
  obstacle.speed = speed;
  obstacle.waitingSince = null;
  obstacle.s = car.s + 20;
  obstacle.kind = 'slow';
  obstacle.scripted = {traffic: true, active: true, speed};
  return fixture;
}

function closeFollowing(s = 195) {
  const sim = new Simulation(973617, 'city'), car = sim.player;
  car.s = s;
  Object.assign(car, pointAt(car.route.points, s));
  car.speed = 4.96459547695258;
  const leadS = s + 8.57142767220489;
  const obstacle = {...pointAt(car.route.points, leadS), id: 'diagnostic-slow', type: 'car',
    speed: 12 / 3.6, width: 1.9, depth: 4.2, s: leadS, stops: {}, route: car.route,
    scripted: {traffic: true, active: true, speed: 12 / 3.6}};
  sim.traffic = [obstacle]; sim.pedestrians = [];
  return {sim, car, obstacle};
}

test('moving following preserves launch room while stopped queues retain a short gap', () => {
  const car = {type: 'car', speed: 12 / 3.6};
  const slow = {type: 'car', speed: 12 / 3.6, heading: 0};
  car.heading = 0;
  assert(followingGap(car, slow) > 5);
  assert(followingSpeed(car, {other: slow, gap: 2.2}) < slow.speed,
    'open a following gap instead of remaining locked at the reported 2.2 metres');
  assert(followingGap(car, {...slow, speed: 0}) < 2, 'stationary queues retain close stopping');
});

test('full decisions offer an early pass beyond the old thirty-metre trigger', () => {
  const {sim, car, obstacle} = closeFollowing(5);
  car.speed = 12 / 3.6;
  obstacle.s = car.s + (car.depth + obstacle.depth) / 2 + 35;
  Object.assign(obstacle, pointAt(car.route.points, obstacle.s));
  const state = sim.decisionState();
  assert(Object.values(candidateChoices(state)).some(v => v.passing_safe && v.velocity_mps > 0));
});

for (const initialGap of [2.2, 20]) {
test(`full decisions: after oncoming traffic clears, pass from initial gap ${initialGap}`, () => {
  const {sim, car, obstacle} = closeFollowing(185);
  car.speed = initialGap === 2.2 ? 12 / 3.6 : 10;
  obstacle.s = car.s + (car.depth + obstacle.depth) / 2 + initialGap;
  Object.assign(obstacle, pointAt(car.route.points, obstacle.s));
  const start = move(pointAt(car.route.points, car.s + 30), car.heading + Math.PI / 2, -6);
  const end = move(start, car.heading, -100);
  const points = samplePolyline([start, end], 1);
  const oncoming = {...obstacle, ...start, id: 'oncoming', heading: car.heading + Math.PI,
    s: 0, speed: 10, route: {points, length: points.at(-1).s, crossings: []},
    scripted: {active: true, speed: 10}};
  sim.traffic.push(oncoming);
  sim.autopilot = true;
  let selectedPass = null, launchGap = null;
  for (let i = 0; i < 500 && (!selectedPass || car.s < selectedPass.end + 2); i++) {
    if (i % 10 === 0 && (!selectedPass || car.s < selectedPass.end - 1)) {
      const state = sim.decisionState();
      const choices = Object.entries(candidateChoices(state));
      const passing = choices.find(([, v]) => v.passing_safe && v.velocity_mps > 0);
      if (i === 0) assert(!passing, 'must initially yield to opposing traffic');
      if (passing && !selectedPass) {
        selectedPass = passing[1].passing;
        launchGap = leadVehicle(car, [obstacle]).gap;
        const prepared = prepareJevRequest(state);
        assert(Object.values(prepared.aliases).includes(passing[0]), 'the real API request includes the pass');
      }
      const chosen = passing ?? choices.sort((a, b) => b[1].velocity_mps - a[1].velocity_mps)[0];
      assert(chosen);
      car.maneuver = chosen[1]; car.target = chosen[1].velocity_mps;
    }
    sim.step(0.05);
  }
  assert(selectedPass, `never offered a pass; final gap ${leadVehicle(car, [obstacle])?.gap}`);
  assert(launchGap > 2.5);
  if (initialGap === 20) assert(launchGap > 5, 'initiate before tailgating');
  assert.equal(sim.crash, null);
  assert(car.s > selectedPass.end, 'complete the maneuver selected through decisionState');
  assert(car.s - obstacle.s > (car.depth + obstacle.depth) / 2 + 5);
  assert(nearestOnPath(car, car.route.points).distance < 0.6);
});
}

test('diagnostic seed: a four-metre following gap can start and complete a safe pass', () => {
  const {sim, car, obstacle} = closeFollowing();
  const pass = passingOpportunity(car, sim.world, [obstacle]);
  assert(pass);
  const assessment = urbanPassingAssessment(car, sim.world, [obstacle]);
  assert(assessment.lead_gap_m > 3 && assessment.lead_gap_m < 6);
  sim.autopilot = true;
  for (let i = 0; i < 400 && car.s < pass.end + 3; i++) {
    if (i % 10 === 0 && car.s < pass.end - 1) {
      const env = sim.speedEnvelope(car);
      const plan = createDrivingPlan(car, sim.world, [obstacle], () => 0.5, `close-${i}`, env.planningMax, env.rule);
      const candidate = Object.values(candidateChoices({vectors: plan.vectors,
        traffic: {queue: plan.queue, passing_blocked: plan.passingBlocked}})).find(v => v.passing_safe && v.velocity_mps > 0);
      assert(candidate, `no safe close-gap pass at ${car.s}`);
      car.maneuver = candidate; car.target = candidate.velocity_mps;
    }
    sim.step(0.05);
  }
  assert.equal(sim.crash, null);
  assert(car.s > pass.end);
  assert(car.s - obstacle.s > (car.depth + obstacle.depth) / 2 + 5);
  assert(nearestOnPath(car, car.route.points).distance < 0.6);
});

test('diagnostic seed: a clear return near the junction is advisory, actual overlap is rejected', () => {
  const {sim, car, obstacle} = closeFollowing(232.29188855734674);
  const assessment = urbanPassingAssessment(car, sim.world, [obstacle]);
  assert.equal(assessment.available, true);
  const pass = passingOpportunity(car, sim.world, [obstacle]);
  assert(pass.return_before_junction_m > 5 && pass.return_before_junction_m < 25);
  assert.equal(vehicleDiagnostic(sim, car).passing.reason, assessment.reason);
  car.route = {...car.route, crossings: [{stopS: pass.end + 2}]};
  assert.equal(passingOpportunity(car, sim.world, [obstacle]), null);
});

test('close following still rejects a departure that would hit the slow car', () => {
  const {sim, car, obstacle} = closeFollowing();
  car.speed = 14;
  obstacle.s = car.s + (car.depth + obstacle.depth) / 2 + 2.6;
  Object.assign(obstacle, pointAt(car.route.points, obstacle.s));
  const plan = createDrivingPlan(car, sim.world, [obstacle], () => 0.5, 'closing', 18);
  assert(!Object.values(plan.vectors).some(v => v.passing_safe && v.velocity_mps > 0));
  obstacle.s = car.s + (car.depth + obstacle.depth) / 2 + 2;
  Object.assign(obstacle, pointAt(car.route.points, obstacle.s));
  assert.equal(urbanPassingAssessment(car, sim.world, [obstacle]).reason, '前车距离不适合发起借道');
});

for (const type of ['city', 'town']) {
test(`${type} moving slow car offers a pass without waiting and completes with real physics`, () => {
  const {sim, car, obstacle} = movingUrban(12 / 3.6, type);
  const pass = passingOpportunity(car, sim.world, [obstacle]);
  assert(pass, 'default 12 km/h slow car can be overtaken');
  const plan = createDrivingPlan(car, sim.world, [obstacle], () => 0.5, 'moving', sim.speedEnvelope(car).planningMax);
  const candidate = Object.values(candidateChoices({vectors: plan.vectors})).find(v => v.passing_safe);
  assert(candidate, 'planner offers the moving pass');
  car.maneuver = candidate;
  car.target = candidate.velocity_mps;
  sim.autopilot = true;
  for (let i = 0; i < 600 && car.s < pass.end + 3; i++) {
    if (i % 10 === 0 && car.s < pass.end - 1) {
      const env = sim.speedEnvelope(car);
      const update = createDrivingPlan(car, sim.world, [obstacle], () => 0.5, `moving-${i}`, env.planningMax, env.rule);
      const next = Object.values(candidateChoices({vectors: update.vectors,
        traffic: {queue: update.queue, passing_blocked: update.passingBlocked}})).find(v => v.passing_safe && v.velocity_mps > 0);
      assert(next, `replan lost the pass at ${car.s}`);
      car.maneuver = next;
      car.target = next.velocity_mps;
    }
    sim.step(0.05);
  }
  assert.equal(sim.crash, null);
  assert(car.s > pass.end, `stalled at ${car.s}: ${sim.speedEnvelope(car).reason}`);
  assert(car.s - obstacle.s > (car.depth + obstacle.depth) / 2 + 5);
  assert(nearestOnPath(car, car.route.points).distance < 0.6);
  assert(obstacle.s > 40, 'lead kept moving throughout the pass');
});
}

test('moving urban pass rejects unsafe speed, road length, oncoming traffic and occupied return', () => {
  const {sim, car, obstacle} = movingUrban();
  const pass = passingOpportunity(car, sim.world, [obstacle]);
  assert(pass);
  obstacle.speed = 6;
  assert.equal(passingOpportunity(car, sim.world, [obstacle]), null);
  obstacle.speed = 12 / 3.6;
  const opposite = {...obstacle, id: 'oncoming',
    ...move(pointAt(car.route.points, 110), car.heading + Math.PI / 2, -6),
    heading: car.heading + Math.PI, speed: 10};
  delete opposite.route;
  assert.equal(passingOpportunity(car, sim.world, [obstacle, opposite]), null);
  const pedestrian = {...opposite, id: 'pedestrian', type: 'pedestrian', speed: 0,
    ...pointAt(car.route.points, car.s + 25)};
  assert.equal(passingOpportunity(car, sim.world, [obstacle, pedestrian]), null);
  const returnBlocker = {...obstacle, id: 'return-blocker', speed: 0,
    ...pointAt(car.route.points, pass.end - 5), s: pass.end - 5};
  assert.equal(passingOpportunity(car, sim.world, [obstacle, returnBlocker]), null);
  car.route = {...car.route, crossings: [{stopS: pass.end + 2}]};
  assert.equal(passingOpportunity(car, sim.world, [obstacle]), null);
});

test('active moving pass rechecks an accelerating lead and local speed limit', () => {
  const {sim, car, obstacle} = movingUrban();
  const pass = passingOpportunity(car, sim.world, [obstacle]);
  assert(pass);
  car.maneuver = {passing: pass};
  obstacle.speed = 4.4;
  assert.equal(passingOpportunity(car, sim.world, [obstacle]), null, 'lead would occupy the return slot');
  obstacle.speed = 12 / 3.6;
  car.maneuver = null;
  sim.world.theme = {...sim.world.theme, limit: 5};
  assert.equal(passingOpportunity(car, sim.world, [obstacle]), null, 'insufficient speed advantage');
  sim.world.theme = {...sim.world.theme, limit: 14};
  const plan = createDrivingPlan(car, sim.world, [obstacle], () => 0.5, 'limited', 4);
  assert(!Object.values(plan.vectors).some(v => v.passing_safe), 'planner ceiling cannot undercut the predicted passing speed');
});
test('urban straight-road pass clears stopped vehicle and returns using real physics', () => {
  const {sim,car,obstacle}=urban();
  const pass=passingOpportunity(car,sim.world,[obstacle]);
  assert(pass,'fixture has enough straight road');
  const plan=createDrivingPlan(car,sim.world,[obstacle],()=>0.5,'urban',3);
  const candidate=Object.values(candidateChoices({vectors:plan.vectors})).find(v=>v.passing_safe);
  assert(candidate,'safe city pass offered');
  car.maneuver=candidate; car.target=3; sim.autopilot=true;
  for(let i=0;i<1000 && car.s<pass.end+8;i++) sim.step(0.05);
  assert.equal(sim.crash,null);
  assert(car.s>pass.end,`stalled at ${car.s}`);
  assert(nearestOnPath(car,car.route.points).distance<0.6);
});
test('urban pass rejects conflicts and junctions but exposes recent stops as a risk',()=>{
  const {sim,car,obstacle}=urban();
  const opposite={...obstacle,id:'oncoming',...move(pointAt(car.route.points,car.s+90),car.heading+Math.PI/2,-6),heading:car.heading+Math.PI,speed:12};
  delete opposite.route;
  assert.equal(passingOpportunity(car,sim.world,[obstacle,opposite]),null);
  const pedestrian={...opposite,id:'walker',type:'pedestrian',speed:0};
  Object.assign(pedestrian,pointAt(car.route.points,car.s+25));
  assert.equal(passingOpportunity(car,sim.world,[obstacle,pedestrian]),null);
  car.observedTime=3;
  assert.equal(passingOpportunity(car,sim.world,[obstacle]).recently_stopped,true);
  car.observedTime=10;
  car.route={...car.route,crossings:[{stopS:car.s+35}]};
  assert.equal(passingOpportunity(car,sim.world,[obstacle]),null);
});
test('diagnostics expose deliberate stops and export runtime without credentials',()=>{
  const {sim,obstacle}=urban();
  assert.equal(vehicleDiagnostic(sim,obstacle).reason,'人为设置的静止障碍');
  const data=JSON.parse(JSON.stringify(diagnosticSnapshot(sim)));
  assert.equal(data.kind,'jevpilot-traffic-diagnostic');
  assert.equal(data.time,10);
  assert.equal(data.traffic[0].id,'blocker');
  assert(!/api.?key|authorization/i.test(JSON.stringify(data)));
});
