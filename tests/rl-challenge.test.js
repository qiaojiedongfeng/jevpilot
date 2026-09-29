import test from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeDrivingEnv, obstacleChallenge, curriculumChallenge, CHALLENGE_OBSERVATIONS, LEGACY_CHALLENGE_SCHEMA } from '../src/rl/challenge-environment.js';
import { loadPolicy } from '../src/rl/browser-policy.js';

test('curriculum stages preserve contract and generate valid deterministic layouts',()=>{
 for(let stage=0;stage<6;stage++)for(let seed=0;seed<100;seed++){
   const config=curriculumChallenge(seed,stage);
   assert.deepEqual(config,curriculumChallenge(seed,stage));
   assert.equal(config.draft.actors.length,stage<=1?0:1);
   const env=new ChallengeDrivingEnv({curriculumStage:stage});
   assert.equal(env.reset(seed).observation.length,97);
   assert.equal(env.info().curriculum_stage,stage);
   assert.ok(env.goalS-env.startS>=15);
   if(stage===3)assert.ok(Math.abs(config.draft.actors[0].x-env.sim.player.x)<.3);
   if(stage===1)assert.ok(env.spawnS-env.goalS>=4 && env.spawnS-env.goalS<=10);
   if(stage===5)assert.ok(env.goalS-env.startS>=80 && env.goalS-env.startS<=200);
 }
 assert.throws(()=>curriculumChallenge(1,6));
});

test('challenge observations include obstacles and reset deterministically',()=>{
 const a=new ChallengeDrivingEnv(),b=new ChallengeDrivingEnv();
 assert.deepEqual(a.reset(42),b.reset(42));
 assert.equal(a.observe().length,CHALLENGE_OBSERVATIONS);
 assert.ok(a.observe().slice(25).some(x=>x!==0));
 for(let i=0;i<30;i++)assert.deepEqual(a.step([.1,.7,0]),b.step([.1,.7,0]));
});
test('full throttle into a parked challenge car uses the real collision detector',()=>{
 const e=new ChallengeDrivingEnv({draft:obstacleChallenge(0,{x:3,z:80}),task:{startS:0,goalS:60}});e.reset(1);
 let result;for(let i=0;i<450&&!e.done;i++)result=e.step([0,1,0]);
 assert.equal(result.info.reason,'collision');assert.equal(e.sim.collisions,1);
 assert.equal(e.sim.crash.object_id,'challenge-obstacle');assert.throws(()=>e.step([0,1,0]),/reset/);
});
test('challenge arrival requires low speed, deadline and road failures terminate',()=>{
 const e=new ChallengeDrivingEnv();e.reset(1);
 Object.assign(e.sim.player,{x:e.goal.x,z:e.goal.z,speed:5});
 assert.notEqual(e.step([0,0,0]).info.reason,'success');
 e.reset(1);Object.assign(e.sim.player,{x:e.goal.x,z:e.goal.z,speed:0});
 assert.equal(e.step([0,0,1]).info.reason,'success');
 e.reset(1);e.sim.time=e.limit-.025;
 assert.equal(e.step([0,0,0]).info.reason,'deadline');
 e.reset(1);e.sim.player.x=12;
 assert.equal(e.step([0,0,0]).info.reason,'offroad');
});
test('challenge checks invalid task and model schema instead of silently adapting',()=>{
 assert.throws(()=>new ChallengeDrivingEnv({task:{goalS:1}}).reset(0));
 const e=new ChallengeDrivingEnv();e.reset(2);assert.throws(()=>e.step([Infinity,0,0]));
 assert.throws(()=>e.step([0,-1]));
 assert.throws(()=>loadPolicy({schema:'straight-pass-v1'}));
});

test('reverse throttle brakes forward motion first; separate brake holds without reversing',()=>{
 const e=new ChallengeDrivingEnv({curriculumStage:0});e.reset(1);
 for(let i=0;i<10;i++)e.step([0,1,0]);
 assert.ok(e.sim.player.speed>0);
 let backward=false;
 for(let i=0;i<40;i++){
   e.step([0,-1,0]);
   if(e.sim.player.speed<-.1){backward=true;break;}
 }
 assert.ok(backward);
 for(let i=0;i<20;i++)e.step([0,-1,1]);
 assert.equal(e.sim.player.speed,0);
 const z=e.sim.player.z;
 for(let i=0;i<20;i++)e.step([0,-1,1]);
 assert.equal(e.sim.player.z,z);
});

test('backing into a rear obstacle observes it and uses the real collision detector',()=>{
 const draft=obstacleChallenge(0,{x:3,z:68});
 const e=new ChallengeDrivingEnv({draft,task:{startS:0,goalS:20,spawnS:50}});e.reset(1);
 assert.ok(e.observe()[26]<0, 'rear object must be visible in structured observations');
 let r;for(let i=0;i<300&&!e.done;i++)r=e.step([0,-1,0]);
 assert.equal(r.info.reason,'collision');
 assert.equal(e.sim.crash.object_id,'challenge-obstacle');
});

test('reverse recovery can complete with raw controls and earns progress toward the goal',()=>{
 for(let seed=0;seed<20;seed++){
   const e=new ChallengeDrivingEnv({curriculumStage:1});e.reset(seed);
   let r,reverseSeen=false,positiveProgress=false;
   for(let i=0;i<300&&!e.done;i++){
     const distance=e.info().distance_to_goal;
     r=e.step(distance<2.7?[0,0,1]:[0,-.6,0]);
     reverseSeen ||= e.sim.player.speed<0;
     positiveProgress ||= e.sim.player.speed<0 && r.info.reward_parts.progress>0;
   }
   assert.equal(r.info.reason,'success');
   assert.ok(reverseSeen && positiveProgress);
 }
});

test('v1 remains forward/brake and v2 distinguishes distant targets without saturation',()=>{
 const old=new ChallengeDrivingEnv({policySchema:LEGACY_CHALLENGE_SCHEMA});
 assert.equal(old.reset(42).observation.length,96);
 for(let i=0;i<20;i++)old.step([0,-1]);
 assert.equal(old.sim.player.speed,0);
 assert.throws(()=>old.step([0,-1,0]));
 const a=new ChallengeDrivingEnv({task:{goalS:100}}),b=new ChallengeDrivingEnv({task:{goalS:200}});
 assert.notEqual(a.reset(42).observation[7],b.reset(42).observation[7]);
 assert.ok(Math.abs(b.observe()[7])<1);
});
