import { candidateChoices } from './planning.js';

function append(sim, entry) {
  sim.decisionTrace ??= [];
  sim.decisionTrace.push(entry);
  if (sim.decisionTrace.length > 2000) sim.decisionTrace.shift();
  return entry;
}

export function recordDecision(sim, state) {
  const offered = new Set(Object.keys(candidateChoices(state)));
  return append(sim, {kind: 'decision', time_s: sim.time, batch_id: state.batch_id,
    challenge: state.challenge, remaining_m: state.destination_m,
    passing_check: state.traffic?.passing_check, status: 'requested',
    candidates: Object.entries(state.vectors).map(([id, v]) => ({id,
      offered: offered.has(id), speed_mps: v.velocity_mps,
      action: v.velocity_mps === 0 ? 'stop' : v.passing ? 'pass_and_return'
        : v.returning_to_lane ? 'return_to_lane' : 'follow_or_continue',
      progress_m: v.route_progress_m, passing: v.passing,
      sampled_min_clearance_m: v.sampled_min_clearance_m,
      collision_predicted: v.collision_predicted, collision_imminent: v.collision_imminent,
      on_road: v.stays_on_road, in_lane: v.stays_in_lane})),
  });
}

export function recordExecution(sim) {
  if (!sim.autopilot || sim.time < (sim.nextExecutionTrace ?? 0)) return;
  sim.nextExecutionTrace = sim.time + 1;
  append(sim, {kind: 'execution', time_s: sim.time, s: sim.player.s,
    speed_mps: sim.player.speed, target_mps: sim.player.appliedTarget,
    passing: sim.player.maneuver?.passing ?? null,
    safety_reason: sim.brakeReason, crash: sim.crash?.type ?? null});
}
