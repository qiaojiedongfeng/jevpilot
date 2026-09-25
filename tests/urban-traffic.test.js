import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/simulation.js';
import {pointAt, move, nearestOnPath} from '../src/math.js';
import {passingOpportunity} from '../src/passing.js';
import {vehicleDiagnostic, diagnosticSnapshot} from '../src/traffic-diagnostics.js';
import {createDrivingPlan} from '../src/driving-plan.js';
import {candidateChoices} from '../src/planning.js';

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

function urban() {
  const sim = new Simulation(42,'town');
  const car = sim.player;
  car.s = 20; Object.assign(car,pointAt(car.route.points,car.s));
  car.speed=0; car.waitingSince=0; car.observedTime=10; sim.time=10;
  const obstacle={...pointAt(car.route.points,car.s+20),id:'blocker',type:'car',kind:'parked',scripted:{},speed:0,width:1.9,depth:4.2,waitingSince:0,stops:{},s:0,route:{points:car.route.points,crossings:[],length:car.route.length}};
  sim.traffic=[obstacle]; sim.pedestrians=[];
  return {sim,car,obstacle};
}
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
test('urban pass rejects oncoming traffic, pedestrians, new stops and junctions',()=>{
  const {sim,car,obstacle}=urban();
  const opposite={...obstacle,id:'oncoming',...move(pointAt(car.route.points,car.s+90),car.heading+Math.PI/2,-6),heading:car.heading+Math.PI,speed:12};
  delete opposite.route;
  assert.equal(passingOpportunity(car,sim.world,[obstacle,opposite]),null);
  const pedestrian={...opposite,id:'walker',type:'pedestrian',speed:0};
  Object.assign(pedestrian,pointAt(car.route.points,car.s+25));
  assert.equal(passingOpportunity(car,sim.world,[obstacle,pedestrian]),null);
  car.observedTime=3;
  assert.equal(passingOpportunity(car,sim.world,[obstacle]),null);
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
