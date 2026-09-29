import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingEnv } from '../src/rl/environment.js';

test('RL reset and transitions are deterministic and independent', () => {
  const a = new DrivingEnv(), b = new DrivingEnv();
  assert.deepEqual(a.reset(42), b.reset(42));
  for (let i = 0; i < 20; i++) assert.deepEqual(a.step([0.05, 0.5]), b.step([0.05, 0.5]));
  a.reset(9);
  assert.notEqual(a.sim.player.x, b.sim.player.x);
  assert.equal(b.steps, 20);
});

test('RL uses four physical substeps and raw pedals', () => {
  const env = new DrivingEnv(); env.reset(0);
  const result = env.step([0, 1]);
  assert.ok(Math.abs(result.info.elapsed - 0.1) < 1e-10);
  assert.ok(env.sim.player.speed > 0);
  assert.equal(env.sim.autopilot, false);
  assert.equal(env.sim.freeExplore, true);
  assert.equal(result.observation.length, 10);
});

test('RL straight course is solvable without an autopilot and braking slows the car', () => {
  const env = new DrivingEnv(); env.reset(0);
  env.sim.player.x = env.center;
  env.sim.player.heading = 0;
  env.step([0, 1]);
  const speed = env.sim.player.speed;
  env.step([0, -1]);
  assert.ok(env.sim.player.speed < speed);
  let result;
  for (let i = 0; i < 300 && !env.done; i++) result = env.step([0, 1]);
  assert.equal(result.info.reason, 'success');
  assert.equal(env.sim.complete, false);
  assert.ok(env.sim.player.speed > 1); // This course deliberately does not grade parking.
});

test('RL rejects invalid actions and terminates immediately on lane departure', () => {
  const env = new DrivingEnv(); env.reset(0);
  assert.throws(() => env.step([NaN, 1]));
  env.sim.player.x = env.center + 4;
  const result = env.step([0, 0]);
  assert.equal(result.info.reason, 'offroad');
  assert.equal(result.info.elapsed, 0.025);
  assert.equal(result.terminated, true);
  assert.throws(() => env.step([0, 0]), /reset/);
});

test('RL deadline is task termination; finish reward is one-time and requires lane containment', () => {
  const env = new DrivingEnv(); env.reset(0);
  env.sim.time = 29.975;
  assert.equal(env.step([0, 0]).info.reason, 'deadline');
  env.reset(0);
  env.sim.player.z = env.startZ - 60;
  assert.equal(env.step([0, 0]).info.reason, 'success');
  assert.throws(() => env.step([0, 0]));
  env.reset(0);
  env.sim.player.z = env.startZ - 60;
  env.sim.player.x += 4;
  assert.equal(env.step([0, 0]).info.reason, 'offroad');
});

test('RL backward movement cannot earn positive progress and random actions remain finite', () => {
  const env = new DrivingEnv(); env.reset(0);
  env.sim.player.heading = Math.PI;
  env.sim.player.speed = 2;
  assert.ok(env.step([0, 0]).info.reward_parts.progress < 0);
  for (let seed = 0; seed < 30; seed++) {
    env.reset(seed);
    for (let i = 0; i < 300 && !env.done; i++) {
      const result = env.step([Math.sin(i * 1.37 + seed), Math.cos(i * 0.17)]);
      assert.ok(result.observation.every(x => Number.isFinite(x) && x >= -1 && x <= 1));
      assert.ok(Number.isFinite(result.reward));
    }
  }
});
