import { Simulation } from '../simulation.js';
import { rng, clamp } from '../math.js';

export const SCHEMA = 'straight-pass-v1';
export const DT = 0.025;
export const LIMIT = 30;
export const LENGTH = 60;

// This introductory course measures passing a finish line, NOT parking.
// Arena is empty; raw human pedals, no target-speed or planning assistance.
export class DrivingEnv {
  reset(seed = 0) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error('seed must be a uint32');
    this.seed = seed;
    this.sim = new Simulation(seed, 'arena');
    this.sim.freeExplore = true; // disables route replanning and automatic arrival
    this.sim.safety = false;
    const random = rng(seed);
    const car = this.sim.player;
    this.center = car.x;
    this.startZ = car.z;
    car.x += (random() - 0.5) * 1.0;
    car.heading = (random() - 0.5) * 0.10;
    this.previousAction = [0, 0];
    this.done = false;
    this.steps = 0;
    return { observation: this.observe(), info: this.info() };
  }

  observe() {
    const v = this.sim.player;
    return [
      (v.x - this.center) / 3, Math.sin(v.heading), Math.cos(v.heading),
      v.speed / 34, v.steeringProgress || 0, v.wheelSteering || 0,
      (LENGTH - this.progress()) / LENGTH, 1 - this.sim.time / LIMIT,
      ...this.previousAction,
    ].map(x => clamp(x, -1, 1));
  }

  progress() { return this.startZ - this.sim.player.z; }

  info(reason = null, rewardParts = {}, elapsed = 0) {
    const v = this.sim.player;
    return {
      schema: SCHEMA, seed: this.seed, reason, is_success: reason === 'success',
      progress: this.progress(), lateral_error: v.x - this.center,
      simulation_time: this.sim.time, elapsed, reward_parts: rewardParts,
      pose: { x: v.x, z: v.z, heading: v.heading, speed: v.speed },
    };
  }

  step(action) {
    if (!this.sim || this.done) throw new Error('reset required');
    if (!Array.isArray(action) || action.length !== 2 || !action.every(Number.isFinite))
      throw new Error('action must contain two finite numbers');
    const applied = action.map(x => clamp(x, -1, 1));
    const s = this.sim;
    s.steeringInput = applied[0];
    s.pedals = { throttle: Math.max(0, applied[1]), brake: Math.max(0, -applied[1]) };
    const before = this.progress(), time = s.time;
    let reason = null;
    for (let i = 0; i < 4; i++) {
      s.step(DT);
      const v = s.player;
      if (![v.x, v.z, v.speed, v.heading].every(Number.isFinite))
        throw new Error('non-finite simulation state');
      // Keep the whole oriented vehicle inside a 6 m lane corridor.
      const extent = Math.abs(Math.cos(v.heading)) * v.width / 2 +
        Math.abs(Math.sin(v.heading)) * v.depth / 2;
      if (s.crash) reason = 'collision';
      else if (Math.abs(v.x - this.center) + extent > 3 || this.progress() < -3)
        reason = 'offroad';
      else if (this.progress() >= LENGTH && Math.cos(v.heading) > 0.9)
        reason = 'success';
      else if (s.time >= LIMIT - 1e-9) reason = 'deadline';
      if (reason) break;
    }
    this.steps++;
    this.done = reason !== null;
    const elapsed = s.time - time;
    const parts = {
      progress: 0.2 * (this.progress() - before),
      time: -0.05 * elapsed,
      jitter: -0.02 * applied.reduce((sum, a, i) => sum + (a - this.previousAction[i]) ** 2, 0),
      terminal: reason === 'success' ? 20 : reason ? -20 : 0,
    };
    this.previousAction = applied;
    return {
      observation: this.observe(), reward: Object.values(parts).reduce((a, b) => a + b, 0),
      terminated: this.done, truncated: false,
      info: { ...this.info(reason, parts, elapsed), requested_action: action, applied_action: applied },
    };
  }
}
