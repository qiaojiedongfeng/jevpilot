import { angle, move, nearestOnPath, pointAt } from "./math.js";
import { routeSection } from "./planning.js";
import { roadGeometry, roadOccupancy } from "./road-geometry.js";
import {
  leadVehicle,
  otherPose,
  footprintClearance,
} from "./traffic-safety.js";

// Only the outer -> inner lane of a verified two-lane interstate carriageway.
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
export function passingOpportunity(car, world, obstacles) {
  if (world.type === "city" || world.type === "town") return urbanPassing(car, world, obstacles);
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

function urbanPassing(car, world, obstacles) {
  const near = nearestOnPath(car, car.route.points);
  let pass = car.maneuver?.passing;
  if (pass?.kind !== 'urban' || near.s >= pass.end - 1) {
    const lead = leadVehicle(car, obstacles);
    if (!lead || lead.other.speed > 0.2 || lead.gap < 6 || lead.gap > 30 ||
      lead.other.waitingSince == null || car.waitingSince == null) return null;
    // waitingSince is simulator time, carried to workers as observed wait age.
    if ((car.observedTime ?? 0) - lead.other.waitingSince < 8) return null;
    pass = { kind: 'urban', start: near.s, end: near.s + lead.gap + 35,
      object_id: lead.other.id, speed: 3, offset: -6, transition: 12 };
  }
  if (pass.end + 20 > car.route.length) return null;
  // Exclude junctions and their crosswalk/stop-line approaches, even on green.
  if (car.route.crossings.some(c => c.stopS + 30 > pass.start && c.stopS - 25 < pass.end)) return null;
  const surfaces = roadGeometry(world);
  const duration = (pass.end - near.s) / pass.speed + 4;
  for (let s = Math.max(near.s, pass.start); s <= pass.end + 8; s += 2) {
    const p = pointAt(car.route.points, s);
    if (Math.abs(angle(p.heading - near.heading)) > 0.1) return null;
    for (const offset of [0, -3, -6]) {
      const pose = { ...car, ...move(p, p.heading + Math.PI / 2, offset), heading: p.heading };
      if (!roadOccupancy(pose, surfaces).on_road) return null;
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
      if (o.type === 'pedestrian' && Math.abs(lateral) < 9) return null;
      if (lateral > -9 && lateral < -2) return null;
      if (n.s >= pass.end - 18 && Math.abs(lateral) < 3) return null;
    }
  }
  const lead = obstacles.find(o => o.id === pass.object_id);
  if (lead && (lead.speed > 0.2 || nearestOnPath(lead, car.route.points).s + lead.depth + 5 > pass.end - 12)) return null;
  return pass;
}
