import { angle, move, nearestOnPath, pointAt } from "./math.js";
import { ACCELERATION, routeSection, routeSpeedLimit } from "./planning.js";
import { roadGeometry, roadOccupancy } from "./road-geometry.js";
import {
  leadVehicle,
  otherPose,
  footprintClearance,
} from "./traffic-safety.js";

// A bounded profile returns to the navigation lane even if the next API call is late.
export function passingOffset(pass, s) {
  if (s <= pass.start || s >= pass.end) return 0;
  const smooth = (t) => {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  };
  return (
    (pass.offset ?? -4.5) * Math.min(smooth((s - pass.start) / (pass.transition ?? 16)), smooth((pass.end - s) / (pass.transition ?? 20)))
  );
}
export function passingOpportunity(car, world, obstacles, speedCeiling = Infinity) {
  if (world.type === "city" || world.type === "town") return urbanPassing(car, world, obstacles, speedCeiling);
  if (world.type !== "highway" || !world.roadSamples) return null;
  const near = nearestOnPath(car, car.route.points),
    section = routeSection(car, near.s);
  if (section?.kind !== "interstate") return null;
  const existing = car.maneuver?.passing;
  let pass = existing && near.s < existing.end - 1 ? existing : null;
  if (!pass) {
    const lead = leadVehicle(car, obstacles);
    if (!lead || lead.gap < 12 || lead.gap > 65 || lead.other.speed > 4.5)
      return null;
    const end = near.s + lead.gap + 65;
    if (end + 30 > section.endS) return null;
    pass = { start: near.s, end, object_id: lead.other.id, speed: 8 };
  }
  if (pass.end + 20 > section.endS) return null;
  // Verify lane direction/center, curve visibility and space along the complete
  // pass, including the return slot. Reserve against rear traffic for 10 seconds.
  for (let s = Math.max(near.s, pass.start); s <= pass.end + 15; s += 5) {
    const center = pointAt(car.route.points, s),
      median = nearestOnPath(center, world.roadSamples);
    const offset =
      (center.x - median.x) * Math.cos(center.heading) +
      (center.z - median.z) * Math.sin(center.heading);
    if (
      Math.abs(offset - 9) > 0.6 ||
      Math.abs(angle(center.heading - near.heading)) > 0.3
    )
      return null;
    const left = move(center, center.heading + Math.PI / 2, -4.5);
    for (const other of obstacles) {
      if (other.id === car.id || other.id === pass.object_id) continue;
      for (const t of [0, 2, 4, 6, 8, 10]) {
        const predicted = otherPose(other, t);
        if (
          footprintClearance(
            { ...car, ...left, heading: center.heading, depth: car.depth + 14 },
            predicted,
          ) < 1
        )
          return null;
        if (
          s >= pass.end - 20 &&
          footprintClearance(
            { ...car, ...center, depth: car.depth + 14 },
            predicted,
          ) < 1
        )
          return null;
      }
    }
  }
  const lead = obstacles.find((o) => o.id === pass.object_id);
  if (lead) {
    const projected = otherPose(
      lead,
      Math.max(0, (pass.end - 20 - near.s) / pass.speed),
    );
    if (
      nearestOnPath(projected, car.route.points).s +
        lead.depth / 2 +
        car.depth / 2 +
        8 >
      pass.end - 20
    )
      return null;
  }
  return pass;
}

export function urbanPassingAssessment(car, world, obstacles, speedCeiling = Infinity) {
  if (!['city', 'town'].includes(world.type)) return null;
  const assessment = {};
  const pass = urbanPassing(car, world, obstacles, speedCeiling, assessment);
  return { ...assessment, available: !!pass, reason: assessment.reason ?? '借道空间检查通过，等待安全轨迹规划' };
}

function urbanPassing(car, world, obstacles, speedCeiling, assessment = null) {
  const reject = (reason) => {
    if (assessment) assessment.reason = reason;
    return null;
  };
  const near = nearestOnPath(car, car.route.points);
  let pass = car.maneuver?.passing;
  if (pass?.kind !== 'urban' || near.s >= pass.end - 1) {
    const lead = leadVehicle(car, obstacles);
    if (!lead || !['car', 'motorcycle'].includes(lead.other.type)) return reject('前方没有可超越车辆');
    if (assessment) Object.assign(assessment, {lead_id: lead.other.id, lead_gap_m: lead.gap, lead_speed_kmh: lead.other.speed * 3.6});
    // Normal following gaps can be below six metres. The swept candidate check
    // decides whether departure is collision-free; do not lock followers out.
    const moving = lead.other.speed > 0.2;
    if (lead.gap < (moving ? 2.5 : 6) || lead.gap > (moving ? 45 : 30)) return reject('前车距离不适合发起借道');
    const speed = Math.min(moving ? 8 : 3, speedCeiling, world.theme.limit, routeSpeedLimit(car, near.s));
    if (moving) {
      // Only materially slower, same-direction traffic merits borrowing the
      // opposing lane. Stopped queues retain their existing wait requirement.
      if (speed - lead.other.speed < 1) return reject('当前轨迹速度不足以完成超越');
      if (Math.abs(angle(lead.other.heading - near.heading)) > 0.1) return reject('前车方向不适合直线超越');
    }
    const transition = 12;
    const clearance = (car.depth + lead.other.depth) / 2 + 5;
    const distance = nearestOnPath(lead.other, car.route.points).s - near.s;
    // Clear the moving lead BEFORE starting the return. Allow two extra seconds
    // for acceleration and the longer curved path, plus a metre of slack.
    const length = moving
      ? (distance + clearance + lead.other.speed * 2 + 1) * speed / (speed - lead.other.speed) + transition
      : lead.gap + 35;
    pass = { kind: 'urban', start: near.s, end: near.s + length,
      object_id: lead.other.id, speed, offset: -6, transition, moving,
      lead_speed_mps: lead.other.speed,
      recently_stopped: !moving && (lead.other.waitingSince == null ||
        (car.observedTime ?? 0) - lead.other.waitingSince < 8) };
  }
  if (assessment) assessment.required_distance_m = pass.end - near.s;
  if (pass.end - pass.start > 300) return reject('超出当前轨迹预测范围');
  if (pass.speed <= 0 || pass.speed > speedCeiling) return reject('当前速度限制不足以完成超车');
  if (pass.end + car.depth / 2 + 2 > car.route.length) return reject('剩余路线不足以完成超车并返回');
  // Only reject intersection overlap. The former 25/30 m comfort buffers are
  // advisory facts for Jev, not a veto on a physically clear return.
  const junction = car.route.crossings.find(c => c.stopS + 20 > pass.start && c.stopS - car.depth / 2 - 2 < pass.end);
  if (junction) {
    if (assessment) assessment.junction_distance_m = junction.stopS - near.s;
    return reject('超车路径进入路口保护范围');
  }
  const surfaces = roadGeometry(world);
  const duration = (pass.end - near.s) / pass.speed + 4;
  for (let s = Math.max(near.s, pass.start); s <= pass.end + 8; s += 2) {
    const p = pointAt(car.route.points, s);
    if (routeSpeedLimit(car, s) < pass.speed) return reject('超车路径限速不足');
    if (Math.abs(angle(p.heading - near.heading)) > 0.1) return reject('直线路段不足');
    for (const offset of [0, -3, -6]) {
      const pose = { ...car, ...move(p, p.heading + Math.PI / 2, offset), heading: p.heading };
      if (!roadOccupancy(pose, surfaces).on_road) return reject('借道路径超出路面');
    }
  }
  // Reserve the complete opposing lane for the entire maneuver. Fine time
  // sampling and extra longitudinal padding cover gaps between predictions.
  for (const o of obstacles) {
    if (o.id === car.id || o.id === pass.object_id) continue;
    for (let t = 0; t <= duration; t += 0.5) {
      const q = otherPose(o, t), n = nearestOnPath(q, car.route.points);
      const lateral = (q.x - n.x) * Math.cos(n.heading) + (q.z - n.z) * Math.sin(n.heading);
      if (n.s < near.s - 15 || n.s > pass.end + 15) continue;
      const reason = o.type === 'pedestrian' && Math.abs(lateral) < 9 ? '行人可能进入超车路径'
        : lateral > -9 && lateral < -2 ? '借用车道有车辆或障碍'
        : n.s >= pass.end - 18 && Math.abs(lateral) < 3 ? '返回原车道的空间被占用' : null;
      if (reason) {
        if (assessment) assessment.blocker_id = o.id;
        return reject(reason);
      }
    }
  }
  const lead = obstacles.find(o => o.id === pass.object_id);
  if (lead) {
    if (pass.moving) {
      if (pass.speed - lead.speed < 1) return reject('前车加速，超车速度差不足');
      const returnS = Math.max(near.s, pass.end - pass.transition);
      // Consume the launch allowance as we accelerate and leave the lane;
      // restarting the full allowance every frame falsely cancels a safe pass.
      const delay = Math.max(0, pass.speed - car.speed) / (2 * ACCELERATION) +
        Math.max(0, 1 - (near.s - pass.start) / pass.transition);
      const time = returnS > near.s ? (returnS - near.s) / pass.speed + delay : 0;
      const projected = otherPose(lead, time);
      if (nearestOnPath(projected, car.route.points).s + (car.depth + lead.depth) / 2 + 5 > returnS) return reject('预测返回时尚未安全超越前车');
    } else if (lead.speed > 0.2 || nearestOnPath(lead, car.route.points).s + lead.depth + 5 > pass.end - 12) return reject('静止障碍状态已变化');
  }
  const nextJunction = car.route.crossings.find(c => c.stopS >= near.s);
  return { ...pass, remaining_distance_m: pass.end - near.s,
    estimated_duration_s: (pass.end - near.s) / pass.speed + 2,
    return_before_junction_m: nextJunction ? nextJunction.stopS - pass.end : null,
    route_remaining_after_m: car.route.length - pass.end,
    min_return_gap_m: 5 };
}
