import test from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeDrivingEnv, obstacleChallenge, curriculumChallenge, CHALLENGE_OBSERVATIONS } from '../src/rl/challenge-environment.js';
import { loadPolicy } from '../src/rl/browser-policy.js';

test('curriculum stages preserve contract and generate valid deterministic layouts',()=>{
 for(let stage=0;stage<4;stage++)for(let seed=0;seed<40;seed++){
   const config=curriculumChallenge(seed,stage);
   assert.deepEqual(config,curriculumChallenge(seed,stage));
   assert.equal(config.draft.actors.length,stage===0?0:1);
   const env=new ChallengeDrivingEnv({curriculumStage:stage});
   assert.equal(env.reset(seed).observation.length,96);
   assert.equal(env.info().curriculum_stage,stage);
   assert.ok(env.goalS-env.startS>=15);
   if(stage===2)assert.ok(Math.abs(config.draft.actors[0].x-env.sim.player.x)<.3);
 }
 assert.throws(()=>curriculumChallenge(1,4));
});

test('challenge observations include obstacles and reset deterministically',()=>{
 const a=new ChallengeDrivingEnv(),b=new ChallengeDrivingEnv();
 assert.deepEqual(a.reset(42),b.reset(42));
 assert.equal(a.observe().length,CHALLENGE_OBSERVATIONS);
 assert.ok(a.observe().slice(24).some(x=>x!==0));
 for(let i=0;i<30;i++)assert.deepEqual(a.step([.1,.7]),b.step([.1,.7]));
});
test('full throttle into a parked challenge car uses the real collision detector',()=>{
 const e=new ChallengeDrivingEnv({draft:obstacleChallenge(0,{x:3,z:80}),task:{startS:0,goalS:60}});e.reset(1);
 let result;for(let i=0;i<450&&!e.done;i++)result=e.step([0,1]);
 assert.equal(result.info.reason,'collision');assert.equal(e.sim.collisions,1);
 assert.equal(e.sim.crash.object_id,'challenge-obstacle');assert.throws(()=>e.step([0,1]),/reset/);
});
test('challenge arrival requires low speed, deadline and road failures terminate',()=>{
 const e=new ChallengeDrivingEnv();e.reset(1);
 Object.assign(e.sim.player,{x:e.goal.x,z:e.goal.z,speed:5});
 assert.notEqual(e.step([0,0]).info.reason,'success');
 e.reset(1);Object.assign(e.sim.player,{x:e.goal.x,z:e.goal.z,speed:0});
 assert.equal(e.step([0,-1]).info.reason,'success');
 e.reset(1);e.sim.time=e.limit-.025;
 assert.equal(e.step([0,0]).info.reason,'deadline');
 e.reset(1);e.sim.player.x=12;
 assert.equal(e.step([0,0]).info.reason,'offroad');
});
test('challenge checks invalid task and model schema instead of silently adapting',()=>{
 assert.throws(()=>new ChallengeDrivingEnv({task:{goalS:1}}).reset(0));
 const e=new ChallengeDrivingEnv();e.reset(2);assert.throws(()=>e.step([Infinity,0]));
 assert.throws(()=>loadPolicy({schema:'straight-pass-v1'}));
});
