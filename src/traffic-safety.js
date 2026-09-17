import { angle, clamp, dist, heading, nearestOnPath, pointAt } from "./math.js";
import { BRAKING, physics } from "./planning.js";

function axes(vehicle) {
  const sin = Math.sin(vehicle.heading || 0),
    cos = Math.cos(vehicle.heading || 0);
  return [
    { x: sin, z: -cos, radius: (vehicle.depth || 4.2) / 2 },
    { x: cos, z: sin, radius: (vehicle.width || 1.9) / 2 },
  ];
}

// Signed separation of oriented vehicle footprints; negative means overlap.
export function footprintClearance(a, b) {
  const aa = axes(a),
    bb = axes(b),
    dx = b.x - a.x,
    dz = b.z - a.z;
  let separation = -Infinity;
  for (const axis of [...aa, ...bb]) {
    const radius = [...aa, ...bb].reduce(
      (sum, edge) =>
        sum + Math.abs(axis.x * edge.x + axis.z * edge.z) * edge.radius,
      0,
    );
    separation = Math.max(
      separation,
      Math.abs(dx * axis.x + dz * axis.z) - radius,
    );
  }
  return separation;
}

export function leadVehicle(vehicle, traffic) {
  let lead = null;
  for (const other of traffic) {
    if (other.id === vehicle.id) continue;
    const dx = other.x - vehicle.x,
      dz = other.z - vehicle.z;
    const forward =
      dx * Math.sin(vehicle.heading) - dz * Math.cos(vehicle.heading);
    const right =
      dx * Math.cos(vehicle.heading) + dz * Math.sin(vehicle.heading);
    const relative = (other.heading || 0) - vehicle.heading;
    const length =
      (Math.abs(Math.cos(relative)) * (other.depth || 4.2)) / 2 +
      (Math.abs(Math.sin(relative)) * (other.width || 1.9)) / 2;
    const width =
      (Math.abs(Math.cos(relative)) * (other.width || 1.9)) / 2 +
      (Math.abs(Math.sin(relative)) * (other.depth || 4.2)) / 2;
    const gap = forward - (vehicle.depth || 4.2) / 2 - length;
    const buffer = other.type === "motorcycle" ? 0.8 : 0.45;
    if (
      forward > 0 &&
      Math.abs(right) < (vehicle.width || 1.9) / 2 + width + buffer &&
      (!lead || gap < lead.gap)
    )
      lead = { other, gap };
  }
  return lead;
}

export function brakingSpeed(distance) {
  const deceleration = 5,
    reaction = 0.35;
  return Math.max(
    0,
    Math.sqrt(
      (deceleration * reaction) ** 2 + 2 * deceleration * Math.max(0, distance),
    ) -
      deceleration * reaction,
  );
}

function otherPose(other, time) {
  if (other.route?.points?.length && Number.isFinite(other.s)) {
    const s = Math.min(
      other.route.length,
      other.s + Math.max(0, other.speed) * time,
    );
    const p = pointAt(other.route.points, s),
      before = pointAt(other.route.points, Math.max(0, s - 0.2));
    return { ...other, x: p.x, z: p.z, heading: heading(before, p) };
  }
  return {
    ...other,
    x: other.x + Math.sin(other.heading || 0) * (other.speed || 0) * time,
    z: other.z - Math.cos(other.heading || 0) * (other.speed || 0) * time,
  };
}

// Predict crossing/merging conflicts, including motorcycles outside the forward lane strip.
// The safeguard only limits speed; Jev remains responsible for steering.
export function predictTrafficConflict(vehicle, obstacles) {
  const target = Math.max(0, vehicle.speed, vehicle.target || 0);
  const horizon = clamp(target / BRAKING + 1, 3, 5),
    step = 0.1;
  const nearby = obstacles.filter(
    (o) =>
      o.id !== vehicle.id &&
      dist(vehicle, o) < (target + Math.abs(o.speed || 0)) * horizon + 12,
  );
  if (!nearby.length) return null;
  const ghost = { ...vehicle },
    route = vehicle.route?.points;
  const start = route ? nearestOnPath(vehicle, route).index : 0;
  const localRoute = route?.slice(
    Math.max(0, start - 20),
    start + Math.ceil(target * horizon) + 100,
  );
  let traveled = 0;
  for (let time = 0; time <= horizon; time += step) {
    if (time > 0) {
      let steering = vehicle.steering || 0;
      if (time > 0.5 && localRoute?.length > 1) {
        const near = nearestOnPath(ghost, localRoute),
          look = pointAt(route, near.s + Math.max(6, ghost.speed));
        steering = clamp(
          Math.atan(
            (5.4 * Math.sin(angle(heading(ghost, look) - ghost.heading))) /
              Math.max(6, ghost.speed),
          ) / 0.58,
          -0.85,
          0.85,
        );
      }
      const before = { x: ghost.x, z: ghost.z };
      physics(ghost, steering, target, step);
      traveled += dist(before, ghost);
    }
    for (const other of nearby) {
      const pose = otherPose(other, time);
      // Cover motion between samples and leave extra room around a rider.
      const buffer =
        (other.type === "motorcycle" ? 0.8 : 0.45) +
        Math.min(0.8, ((ghost.speed + Math.abs(other.speed || 0)) * step) / 2);
      if (footprintClearance(ghost, pose) > buffer) continue;
      return {
        object_id: other.id,
        type: other.type,
        time_s: time,
        distance_m: traveled,
        max_speed_mps: brakingSpeed(traveled - 3),
        reason:
          other.type === "motorcycle"
            ? "Motorcycle clearance"
            : other.type === "pedestrian"
              ? "Pedestrian clearance"
              : "Crossing or merging traffic",
      };
    }
  }
  return null;
}
