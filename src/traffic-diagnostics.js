import { pointAt, heading } from './math.js';
import { firstCollision } from './collisions.js';

// A reservation only applies to intersecting paths. A stopped holder still
// occupies its actual footprint; it cannot reserve every arm indefinitely.
export function reservationConflicts(vehicle, holder, crossing) {
  if (!holder) return false;
  const poses = [{ ...holder }];
  if (holder.speed > 0.2 && holder.route?.points)
    for (let s = holder.s + 2; s <= Math.min(holder.route.length, holder.s + holder.speed * 3 + 5); s += 2) {
      const p = pointAt(holder.route.points, s);
      poses.push({ ...holder, ...p, heading: p.heading ?? holder.heading });
    }
  let previous = { ...vehicle };
  for (let s = vehicle.s + 1; s <= Math.min(vehicle.route.length, crossing.stopS + 25); s += 1) {
    const p = pointAt(vehicle.route.points, s), next = pointAt(vehicle.route.points, s + 0.2);
    const pose = { ...vehicle, ...p, heading: heading(p, next), width: vehicle.width + 0.6, depth: vehicle.depth + 0.6 };
    if (firstCollision(previous, pose, poses.map(object => ({ object })))) return true;
    previous = pose;
  }
  return false;
}

export function vehicleDiagnostic(sim, v) {
  const rule = sim.rule(v), env = sim.speedEnvelope(v);
  let reason = '正常行驶', blocker = null;
  if (v.kind === 'parked') reason = '人为设置的静止障碍';
  else if (v.scripted && !v.scripted.active) reason = '等待接近触发';
  else if (v.scripted && !v.scripted.traffic && v.s >= v.route.length - 0.01) reason = '已到设定终点，停车';
  else if (Math.abs(v.speed) < 0.2) {
    reason = rule.mustStop ? ({ 'Red light': '等待红灯', 'Amber light': '等待黄灯', 'Pedestrian crossing': '等待行人过街', 'Yield to pedestrian': '让行人', 'Yield to crossing traffic': '等待冲突车辆驶离路口', 'Yield to first arrival': '让先到车辆', 'Stop sign': '停车标志等待', 'Letting stopped traffic clear': '依次放行中' }[rule.reason] ?? rule.reason) : '等待驾驶决策';
    if (env.lead && env.max < 0.2 && !rule.mustStop) {
      reason = '被前车阻挡'; blocker = env.lead.other.id;
    }
    if (rule.reason === 'Yield to crossing traffic') blocker = sim.locks.get(rule.nodeId)?.id;
    if (env.reason === 'Passing corridor blocked') reason = '借道空间变化，暂停绕行';
  }
  return { id: v.id, reason, blocker: blocker ?? null, speed_kmh: Math.round(v.speed * 36) / 10,
    waiting_s: v.waitingSince == null ? 0 : Math.max(0, Math.round(sim.time - v.waitingSince)),
    signal: rule.color, node_id: rule.nodeId ?? null, rule: rule.reason, speed_cap_mps: env.max };
}

export function diagnosticSnapshot(sim, draft = null) {
  return { version: 1, kind: 'jevpilot-traffic-diagnostic', world: {seed: sim.world.seed, type: sim.world.type},
    time: sim.time, challenge: draft, player: sim.player, traffic: sim.traffic, pedestrians: sim.pedestrians,
    locks: [...sim.locks], courtesy: [...sim.courtesy], crash: sim.crash,
    vehicles: [sim.player, ...sim.traffic].map(v => vehicleDiagnostic(sim, v)) };
}
