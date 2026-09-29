import { ChallengeDrivingEnv, obstacleChallenge, curriculumChallenge } from './challenge-environment.js';
import { loadPolicy } from './browser-policy.js';
import { DriveScene } from '../scene.js';

const $=id=>document.getElementById(id);
let draft=obstacleChallenge(0,{x:3,z:80}),spawnTask={},env,scene,policy,running=false,accumulator=0,last=0,result=null;
const names={success:'安全到达并停车',collision:'发生碰撞',offroad:'驶离道路',deadline:'超时'};
function config(){return {draft:structuredClone(draft),policySchema:policy?.schema,task:{...spawnTask,startS:Number($('start').value),goalS:Number($('goal').value)}}}
function reset(){
  running=false;accumulator=0;result=null;
  const next=structuredClone(draft);next.limit=Number($('limit').value);
  const candidate=new ChallengeDrivingEnv({...config(),draft:next});candidate.reset(42);
  draft=next;env=candidate;
  if(!scene)scene=new DriveScene($('world'),env.sim,$('vectors'));
  else{scene.sim=env.sim;scene.build();}
  scene.destination.position.set(env.goal.x,.2,env.goal.z);
  scene.mode=$('camera').value;scene.snap=true;
  $('pause').disabled=true;$('pause').textContent='暂停';$('startRun').disabled=!policy;
  $('taskName').textContent=`${draft.name} · ${draft.actors.length} 个挑战对象${spawnTask.spawnS!==undefined?' · 从终点后方开始':''}`;
  $('message').textContent='场景已就绪。加载模型后开始，结果由实际仿真决定。';
  drawHud();
}
function drawHud(){const v=env.sim.player;const pedals=env.legacy?`纵向 ${env.previousAction[1].toFixed(2)}（负数刹车）`:`油门 ${env.previousAction[1].toFixed(2)}（负数倒车） · 刹车 ${Math.max(0,env.previousAction[2]).toFixed(2)}`;$('hud').textContent=`${result?names[result]:running?'模型驾驶中':'准备 / 暂停'}   ·   ${env.sim.time.toFixed(1)} / ${env.limit} s\n速度 ${(v.speed*3.6).toFixed(1)} km/h   ·   距离终点 ${Math.hypot(v.x-env.goal.x,v.z-env.goal.z).toFixed(1)} m   ·   碰撞 ${env.sim.collisions}\n转向 ${env.previousAction[0].toFixed(2)}   ·   ${pedals}   ·   感知容量外对象 ${env.omittedObjects}`;}
function safely(fn){return async()=>{try{await fn()}catch(e){running=false;$('message').textContent=e.message;console.error(e)}}}
function setPolicy(data){policy=loadPolicy(data);reset();$('policyName').textContent=`已加载 ${policy.steps.toLocaleString()} 步策略；${policy.legacy?'旧版：前进/刹车，不支持倒车':'新版：前进/倒车与独立刹车'}；Python/浏览器固定样例校验通过。`;$('startRun').disabled=false;}
$('policyFile').onchange=safely(async()=>{running=false;setPolicy(JSON.parse(await $('policyFile').files[0].text()))});
$('challengeFile').onchange=safely(async()=>{const imported=JSON.parse(await $('challengeFile').files[0].text());
  const next=new ChallengeDrivingEnv({draft:imported,task:imported.task??{}});next.reset(42);
  draft=imported;spawnTask={spawnS:imported.task?.spawnS,initialSpeed:imported.task?.initialSpeed};$('start').value=next.startS;$('goal').value=next.goalS;$('limit').value=draft.limit;
  $('arena-controls').hidden=draft.world.type!=='arena';reset();});
$('place').onclick=safely(()=>{spawnTask={};draft=obstacleChallenge(0,{x:Number($('obstacleX').value),z:Number($('obstacleZ').value)});reset()});
$('reversePractice').onclick=safely(()=>{const practice=curriculumChallenge(42,1);draft=practice.draft;spawnTask={spawnS:practice.task.spawnS,initialSpeed:practice.task.initialSpeed};$('start').value=practice.task.startS;$('goal').value=practice.task.goalS;$('limit').value=draft.limit;$('arena-controls').hidden=false;reset()});
for(const id of ['start','goal'])$(id).addEventListener('change',()=>{spawnTask={}});
$('reset').onclick=safely(reset);
$('startRun').onclick=safely(()=>{reset();running=true;$('pause').disabled=false;$('message').textContent='固定 0.1 秒决策间隔；页面卡顿时放慢仿真，不跳过物理步。'});
$('pause').onclick=()=>{if(result)return;running=!running;$('pause').textContent=running?'暂停':'继续';accumulator=0;drawHud()};
$('camera').onchange=()=>{scene.mode=$('camera').value;scene.snap=true};
$('export').onclick=safely(()=>{reset();const blob=new Blob([JSON.stringify({...draft,task:config().task},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rl-challenge.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
function frame(now){const dt=last?Math.min(.1,(now-last)/1000):0;last=now;
  if(running){accumulator+=dt;try{while(accumulator>=.1&&running){const r=env.step(policy.predict(env.observe()));accumulator-=.1;if(r.terminated||r.truncated){result=r.info.reason;running=false;$('pause').disabled=true;$('message').textContent=`本局结果：${names[result]}。可调整障碍后重新测试。`}}}catch(e){running=false;$('message').textContent=e.message;console.error(e)}}
  if(scene){scene.render(dt);drawHud()}requestAnimationFrame(frame);
}
try{reset();const url=new URL(location.href).searchParams.get('policy');if(url&&url.startsWith('/artifacts/rl/')&&url.endsWith('/policy.json')){const response=await fetch(url);if(!response.ok)throw Error('示例模型文件不可用');setPolicy(await response.json())}}catch(e){$('message').textContent=e.message;console.error(e)}
requestAnimationFrame(frame);
