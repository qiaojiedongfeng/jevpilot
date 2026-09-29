import { Simulation } from '../simulation.js';
import { applyChallengeActors, newChallenge, makeActor } from '../challenge-model.js';
import { roadGeometry, roadOccupancy } from '../road-geometry.js';
import { rng, clamp, dist, heading, angle, nearestOnPath, pointAt } from '../math.js';

export const LEGACY_CHALLENGE_SCHEMA = 'challenge-structured-v1';
export const CHALLENGE_SCHEMA = 'challenge-structured-v2';
export const CHALLENGE_OBSERVATIONS = 97;
export const CHALLENGE_ACTIONS = 3;

// The same physics, observations, rewards and success condition at every level.
export function curriculumChallenge(seed, stage) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 5) throw Error('Invalid curriculum stage');
  const random = rng(seed), sim = new Simulation(42, 'arena');
  const startS = stage === 1 || stage === 4 || stage === 5 ? random() * (stage === 5 ? 10 : 15) : 0;
  const distance = stage === 0 ? 15 + random() * 10 : stage === 1 ? 20 : stage === 2 ? 35 + random() * 10 : stage === 3 ? 60 : stage === 4 ? 45 + random() * 25 : 80 + random() * 120;
  const task = { startS, goalS: startS + distance };
  if (stage === 1) {
    task.spawnS = task.goalS + 4 + random() * 6;
    task.initialSpeed = random() * 2;
  }
  const draft = newChallenge(sim.world);
  draft.name = `自动课程 ${stage + 1}`;
  draft.limit = stage <= 1 ? 30 : stage === 5 ? 90 : 45;
  draft.actors = [];
  if (stage > 1) {
    const p = pointAt(sim.world.route.points, startS + distance * (.4 + random() * .2));
    // This arena route is straight; leave space on the opposite side to pass.
    const x = stage === 2 ? p.x - 6 : p.x + (stage >= 4 ? (random() - .5) * 1.5 : 0);
    draft.actors = [makeActor(sim.world, 'parked', { x, z: p.z }, 'challenge-curriculum-obstacle')];
  }
  return { draft, task };
}

export function obstacleChallenge(seed = 0, options = {}) {
  const sim = new Simulation(42, 'arena'), random = rng(seed);
  const draft = newChallenge(sim.world);
  draft.name = '绕过障碍并到达终点'; draft.limit = 45;
  const x = options.x ?? (random() < .5 ? -3 : 3);
  const z = options.z ?? (72 + random() * 12);
  // Reuse the editor's actor shape and path; parked cars stay stationary.
  const actor = makeActor(sim.world, 'parked', { x, z }, 'challenge-obstacle');
  draft.actors = [actor];
  return draft;
}

export class ChallengeDrivingEnv {
  constructor(config = {}) {
    this.config = structuredClone(config);
    this.schema = config.policySchema ?? CHALLENGE_SCHEMA;
    if (![CHALLENGE_SCHEMA, LEGACY_CHALLENGE_SCHEMA].includes(this.schema)) throw Error('Unsupported policy schema');
    this.legacy = this.schema === LEGACY_CHALLENGE_SCHEMA;
  }
  reset(seed = 0) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Invalid seed');
    const random = rng(seed);
    this.seed = seed;
    if (this.config.curriculumStage !== undefined && this.config.draft) throw Error('Cannot combine draft and curriculum');
    const generated = this.config.curriculumStage === undefined ? null : curriculumChallenge(seed, this.config.curriculumStage);
    this.draft = generated?.draft ?? (this.config.draft ? structuredClone(this.config.draft) : obstacleChallenge(seed));
    const w = this.draft.world;
    if (!w || !['arena','city','town','highway'].includes(w.type) || !Number.isInteger(w.seed)) throw Error('Invalid challenge world');
    this.sim = new Simulation(w.seed, w.type);
    // Background traffic is explicitly opt-in; supplied challenge actors remain.
    if (!this.config.ambient) { this.sim.traffic = []; this.sim.pedestrians = []; }
    applyChallengeActors(this.sim, this.draft);
    this.sim.freeExplore = true; this.sim.safety = false;
    this.roads = roadGeometry(this.sim.world);
    const route = this.sim.world.route;
    const task = generated?.task ?? this.config.task ?? {};
    this.startS = task.startS ?? 0;
    this.goalS = task.goalS ?? (this.config.draft ? route.length : 60);
    if (![this.startS, this.goalS].every(Number.isFinite) || this.startS < 0 || this.goalS > route.length || this.goalS-this.startS < 15)
      throw Error('起终点须沿原导航路线设置，间隔至少 15 米');
    this.goal = pointAt(route.points, this.goalS);
    this.spawnS = task.spawnS ?? this.startS;
    const initialSpeed = task.initialSpeed ?? 0;
    if (!Number.isFinite(this.spawnS) || this.spawnS < 0 || this.spawnS >= route.length ||
        !Number.isFinite(initialSpeed) || initialSpeed < 0 || initialSpeed > 2) throw Error('Invalid spawn or initial speed');
    const start = pointAt(route.points, this.spawnS);
    const h = heading(start, pointAt(route.points, Math.min(route.length, this.spawnS + 1)));
    Object.assign(this.sim.player, { x:start.x, z:start.z, heading:h, s:this.spawnS, speed:initialSpeed });
    if (!this.config.draft) {
      this.sim.player.x += (random()-.5)*.4;
      this.sim.player.heading += (random()-.5)*.06;
    }
    if (roadOccupancy(this.sim.player, this.roads).outside_fraction > .05) throw Error('起点不在可行驶道路内');
    if (this.draft.actors.some(a => dist(a,start)<7 || dist(a,this.goal)<7)) throw Error('起终点与挑战对象距离至少 7 米');
    this.limit = this.draft.limit; this.previousAction = this.legacy ? [0,0] : [0,0,0]; this.done = false;
    this.lastProgress = this.spawnS; this.offroadTime=0;
    return { observation:this.observe(), info:this.info() };
  }
  local(p) {
    const v=this.sim.player, dx=p.x-v.x,dz=p.z-v.z;
    return [dx*Math.cos(v.heading)+dz*Math.sin(v.heading), dx*Math.sin(v.heading)-dz*Math.cos(v.heading)];
  }
  observe() {
    const v=this.sim.player, near=nearestOnPath(v,v.route.points), delta=angle(near.heading-v.heading), goal=this.local(this.goal);
    const out=[v.speed/34,v.steeringProgress||0,v.wheelSteering||0,Math.sin(delta),Math.cos(delta),near.distance/12,
      goal[0]/(this.legacy?80:240),goal[1]/(this.legacy?80:240),1-this.sim.time/this.limit,...this.previousAction,
      roadOccupancy(v,this.roads).outside_fraction]; // v1:12, v2:13
    for(const ahead of [5,10,20,35,50,70]) out.push(...this.local(pointAt(v.route.points,Math.min(this.goalS,near.s+ahead))).map(x=>x/80)); // 12
    const obstacles=[...this.sim.traffic,...this.sim.pedestrians,...this.sim.world.objects.filter(o=>o.type==='building')]
      .map(o=>({o,d:Math.max(0,dist(v,o)-Math.hypot(o.width,o.depth)/2)}))
      .filter(o=>o.d<80).sort((a,b)=>a.d-b.d||String(a.o.id).localeCompare(String(b.o.id)));
    this.omittedObjects=Math.max(0,obstacles.length-8);
    for(let i=0;i<8;i++) {
      if(!obstacles[i]) {out.push(0,0,0,0,0,0,0,0,0);continue;}
      const o=obstacles[i].o,[right,ahead]=this.local(o),h=o.heading??-(o.rotation||0);
      // Privileged structured simulator observations, not camera perception.
      out.push(right/80,ahead/80,o.width/20,o.depth/20,Math.sin(h-v.heading)*(o.speed||0)/34,Math.cos(h-v.heading)*(o.speed||0)/34,Math.sin(h-v.heading),Math.cos(h-v.heading),1);
    }
    if(out.length!==(this.legacy?96:CHALLENGE_OBSERVATIONS) || !out.every(Number.isFinite)) throw Error('Invalid observation');
    return out.map(x=>clamp(x,-1,1));
  }
  info(reason=null,parts={}) {
    const s=this.sim;
    return {schema:this.schema,seed:this.seed,reason,is_success:reason==='success',simulation_time:s.time,
      start_s:this.startS,goal_s:this.goalS,spawn_s:this.spawnS,
      curriculum_stage:this.config.curriculumStage??null,
      progress:s.player.s-this.startS,distance_to_goal:dist(s.player,this.goal),collisions:s.collisions,
      omitted_objects:this.omittedObjects??0,reward_parts:parts,pose:{x:s.player.x,z:s.player.z,heading:s.player.heading,speed:s.player.speed}};
  }
  step(action) {
    if(!this.sim||this.done)throw Error('reset required');
    if(!Array.isArray(action)||action.length!==(this.legacy?2:CHALLENGE_ACTIONS)||!action.every(Number.isFinite))throw Error('Invalid action');
    const a=action.map(x=>clamp(x,-1,1)),s=this.sim;
    s.steeringInput=a[0];
    s.pedals=this.legacy ? {throttle:Math.max(0,a[1]),brake:Math.max(0,-a[1])} : {throttle:a[1],brake:Math.max(0,a[2])};
    const before=dist(s.player,this.goal),time=s.time;let reason=null;
    for(let i=0;i<4;i++) {
      s.step(.025);
      const offroad=roadOccupancy(s.player,this.roads).outside_fraction;
      this.offroadTime=offroad>.1?this.offroadTime+.025:0;
      if(s.crash)reason='collision';
      else if(this.offroadTime>=.1-1e-9)reason='offroad';
      else if(dist(s.player,this.goal)<3 && Math.abs(s.player.speed)<1)reason='success';
      else if(s.time>=this.limit-1e-9)reason='deadline';
      if(reason)break;
    }
    const elapsed=s.time-time,near=nearestOnPath(s.player,s.player.route.points);
    const progress = this.legacy ? near.s-this.lastProgress : Math.abs(this.goalS-this.lastProgress)-Math.abs(this.goalS-near.s);
    const parts={progress:.3*clamp(progress,-4,4),
      approach:.2*(before-dist(s.player,this.goal)),time:-.05*elapsed,
      offroad:-2*roadOccupancy(s.player,this.roads).outside_fraction*elapsed,
      jitter:-.01*a.reduce((r,x,i)=>r+(x-this.previousAction[i])**2,0),
      terminal:reason==='success'?60:reason==='collision'?-60:reason?-30:0};
    this.lastProgress=near.s;this.previousAction=a;this.done=!!reason;
    const observation=this.observe();
    return {observation,reward:Object.values(parts).reduce((a,b)=>a+b,0),terminated:this.done,truncated:false,
      info:{...this.info(reason,parts),elapsed,applied_action:a}};
  }
}
