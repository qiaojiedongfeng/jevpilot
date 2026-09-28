// Rebuild a challenge from an exported scene and exercise the real server
// evaluator. API wall time advances the simulation before applying its answer.
import fs from 'node:fs';
import path from 'node:path';
import {Simulation} from '../src/simulation.js';
import {applyChallengeActors, ChallengeScore} from '../src/challenge-model.js';
import {evaluate} from '../server/jev.js';
import {candidateChoices, decisionControls} from '../src/planning.js';
import {recordDecision} from '../src/decision-trace.js';
import {diagnosticSnapshot} from '../src/traffic-diagnostics.js';
import {nearestOnPath} from '../src/math.js';

const input = process.argv[2];
if (!input) throw Error('Usage: node --env-file=.env scripts/replay-challenge.mjs snapshot.json [output.json]');
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
const draft = source.challenge;
const sim = new Simulation(draft.world.seed, draft.world.type);
applyChallengeActors(sim, draft);
const score = new ChallengeScore(draft.limit);
sim.challengeClock = {limit_s: draft.limit, elapsed_s: 0};
sim.autopilot = true;
const metrics = {calls: 0, cost_usd: 0, offered_pass: 0, selected_pass: 0,
  applied_pass: 0, completed_pass: 0, aborted_pass: 0, expired: 0, context_changed: 0, errors: []};
let activePass = null, failures = 0;
const completedPasses = new Set();
function advance(seconds) {
  for (let t = 0; t < seconds && !score.result; t += 0.05) {
    const dt = Math.min(0.05, seconds - t);
    sim.step(dt); score.update(sim, dt, metrics.cost_usd);
    if (activePass && sim.player.s >= activePass.end) {
      const lead = sim.traffic.find(v => v.id === activePass.object_id);
      if (nearestOnPath(sim.player, sim.player.route.points).distance < 0.8 &&
        (!lead || nearestOnPath(lead, sim.player.route.points).s + (lead.depth + sim.player.depth) / 2 < sim.player.s)) {
        const key = JSON.stringify([activePass.object_id, activePass.start, activePass.end]);
        if (!completedPasses.has(key)) {
          completedPasses.add(key);
          metrics.completed_pass++;
        }
        activePass = null;
      }
    }
  }
}
const maxCalls = Number(process.env.REPLAY_MAX_CALLS ?? 650);
while (!score.result && metrics.calls < maxCalls && metrics.cost_usd < 0.25) {
  const started = performance.now();
  const state = sim.decisionState();
  const trace = recordDecision(sim, state);
  metrics.offered_pass += Number(Object.values(candidateChoices(state)).some(v => v.passing && v.velocity_mps > 0));
  try {
    metrics.calls++;
    const result = await evaluate(state, process.env);
    metrics.cost_usd += result.cost_usd;
    const chosen = state.vectors[result.selection.choice];
    metrics.selected_pass += Number(!!chosen.passing && chosen.velocity_mps > 0);
    const latency = (performance.now() - started) / 1000;
    Object.assign(trace, {selected: result.selection.choice, latency_ms: latency * 1000,
      source: result.decision_source});
    advance(Math.min(latency, 1.8));
    if (latency > 1.8) { sim.player.target = 0; advance(latency - 1.8); }
    if (score.result) { trace.status = 'discarded_challenge_finished'; break; }
    if (latency > 1.8) { trace.status = 'expired'; metrics.expired++; continue; }
    if (sim.decisionContextChanged(state)) {
      trace.status = 'discarded_context_changed'; metrics.context_changed++; continue;
    }
    const controls = decisionControls(state, result);
    if (!controls) throw Error('Invalid returned controls');
    if (activePass && !chosen.passing && sim.player.s < activePass.end - 1) {
      metrics.aborted_pass++; activePass = null;
    }
    sim.player.maneuver = chosen;
    sim.player.target = controls.velocity;
    sim.player.steering = controls.steering;
    Object.assign(trace, {status: 'applied', applied_time_s: sim.time});
    if (chosen.passing && chosen.velocity_mps > 0) {
      metrics.applied_pass++; activePass = chosen.passing;
    }
    advance(Math.max(0, 0.25 - latency));
    failures = 0;
  } catch (error) {
    trace.status = 'error'; trace.error = error.message;
    metrics.errors.push(error.message);
    sim.player.target = 0;
    advance(Math.max(0.25, (performance.now() - started) / 1000));
    if (++failures >= 3) break;
  }
  if (metrics.calls % 25 === 0) console.log(JSON.stringify({calls: metrics.calls,
    time_s: sim.time, remaining_m: sim.navigation().remaining_m,
    offered: metrics.offered_pass, selected: metrics.selected_pass, applied: metrics.applied_pass}));
}
const output = path.resolve(process.argv[3] ?? `artifacts/replay-${draft.world.seed}.json`);
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify({metrics, result: score.result,
  stop_reason: score.result?.outcome ?? (failures >= 3 ? 'api_error' : 'budget_limit'),
  final_remaining_m: sim.navigation().remaining_m,
  snapshot: diagnosticSnapshot(sim, draft)}, null, 2));
console.log(JSON.stringify({output, metrics, result: score.result,
  remaining_m: sim.navigation().remaining_m}));
if (!score.result || score.result.outcome !== 'arrived') process.exitCode = 1;
