import { angle, clamp, heading, nearestOnPath, pointAt } from "./math.js";

export const VECTOR_AXES = {
  L4: -0.85,
  L3: -0.45,
  L2: -0.2,
  L1: -0.07,
  L0: -0.025,
  C: 0,
  R0: 0.025,
  R1: 0.07,
  R2: 0.2,
  R3: 0.45,
  R4: 0.85,
};
export const VECTOR_NAMES = {
  L4: "Hard left",
  L3: "Left",
  L2: "Soft left",
  L1: "Trim left",
  L0: "Ease left",
  C: "Straight",
  R0: "Ease right",
  R1: "Trim right",
  R2: "Soft right",
  R3: "Right",
  R4: "Hard right",
};
export const VELOCITY = {
  stop: 0,
  creep: 2,
  slow: 5,
  cruise: 10,
  fast: 14,
  city: 18,
  open: 28,
};
export const VECTOR_HORIZON = 3;
export const VECTOR_STEPS = 60;
export const EVALUATION_STEPS = 24;
export const ACCELERATION = 5;
export const BRAKING = 8;

export function physics(car, steer, target, dt) {
  car.speed += clamp(target - car.speed, -BRAKING * dt, ACCELERATION * dt);
  integratePose(car, steer, dt);
}

// Free play uses pedals. Rolling resistance, engine braking, and aerodynamic
// drag slow a released accelerator without an artificial target-speed lock.
export function pedalPhysics(car, steer, throttle, brake, dt) {
  throttle = clamp(throttle, -1, 1);
  brake = clamp(brake, 0, 1);
  const speed = Math.abs(car.speed);
  const resistance =
    0.18 + 0.0017 * speed * speed + (Math.abs(throttle) < 0.01 ? 0.32 : 0);
  const opposingPedal = throttle * car.speed < -0.01;
  const braking = brake * 11 + (opposingPedal ? Math.abs(throttle) * 8 : 0);
  if (brake || opposingPedal || !throttle) {
    car.speed =
      Math.sign(car.speed) * Math.max(0, speed - (resistance + braking) * dt);
  } else {
    const acceleration = throttle * (throttle < 0 ? 2.5 : 5);
    car.speed +=
      (acceleration - Math.sign(car.speed || throttle) * resistance) * dt;
    car.speed = clamp(car.speed, -3, 34);
  }
  // Build a virtual steering stick while a key is held (full travel in 0.63s).
  // A soft center makes taps precise; continued input reaches a sharp turn.
  steer = clamp(steer, -1, 1);
  const current = car.steeringProgress || 0;
  const reversing = steer * current < 0;
  const goal = reversing ? 0 : steer;
  const returning = reversing || Math.abs(goal) < Math.abs(current);
  const step = (returning ? 5 : 1.6) * dt;
  car.steeringProgress = current + clamp(goal - current, -step, step);
  const input = car.steeringProgress;
  const shaped = input * (0.2 + 0.8 * Math.abs(input));
  // Retain substantial steering at speed, rather than a near-zero angle cap.
  const limit = Math.min(
    1,
    (0.72 * 1.4) / (1 + (Math.abs(car.speed) / 7) ** 1.4),
  );
  integratePose(car, shaped * limit, dt);
}

function integratePose(car, steer, dt) {
  if (Math.abs(car.speed) < 0.01) car.speed = 0;
  car.steering = steer;
  car.heading = angle(
    car.heading + (car.speed / 2.7) * Math.tan(steer * 0.58) * dt,
  );
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z -= Math.cos(car.heading) * car.speed * dt;
}

// The same rollouts feed the classifier and the road visualization.
// At rest, use 5 m/s to show possible departure directions.
export function vectorAxis(id, speed) {
  return (
    VECTOR_AXES[id] *
    Math.min(1, 9 / Math.max(5, Math.abs(Math.round(speed * 10) / 10)))
  );
}
export function projectVectors(car, preview = true) {
  const route = car.route?.points;
  const nearest = preview && route ? nearestOnPath(car, route).index : 0;
  const localRoute = route?.slice(
    Math.max(0, nearest - 25),
    nearest + Math.ceil(Math.max(5, Math.abs(car.speed)) * 5) + 100,
  );
  return Object.fromEntries(
    Object.keys(VECTOR_AXES).map((id) => {
      const axis = vectorAxis(id, car.speed);
      const ghost = {
        x: car.x,
        z: car.z,
        heading: car.heading,
        speed: Math.max(5, Math.abs(car.speed)),
      };
      const points = [{ x: ghost.x, z: ghost.z }];
      let evaluation;
      for (let i = 0; i < (preview ? VECTOR_STEPS : EVALUATION_STEPS); i++) {
        let steer = axis;
        // After the initial maneuver, preview a feasible return to the route.
        // This is a proposal only: the next Jev choice replaces it in real time.
        if (i >= EVALUATION_STEPS && car.route) {
          const near = nearestOnPath(ghost, localRoute, 0);
          const look = pointAt(
            car.route.points,
            near.s + Math.max(8, ghost.speed * 1.2),
          );
          const error = angle(heading(ghost, look) - ghost.heading);
          steer = clamp(
            Math.atan(
              (2 * 2.7 * Math.sin(error)) / Math.max(8, ghost.speed * 1.2),
            ) / 0.58,
            -0.85,
            0.85,
          );
        } else if (i >= EVALUATION_STEPS) {
          steer *= Math.exp(-(i - EVALUATION_STEPS) / 8);
        }
        physics(ghost, steer, ghost.speed, VECTOR_HORIZON / VECTOR_STEPS);
        points.push({ x: ghost.x, z: ghost.z });
        if (i === EVALUATION_STEPS - 1)
          evaluation = { x: ghost.x, z: ghost.z, heading: ghost.heading };
      }
      return [id, { axis, points, evaluation, endHeading: ghost.heading }];
    }),
  );
}

// Return measured probabilities unchanged; absent/expired predictions are unweighted.
export function vectorWeights(answer, ageMs = 0) {
  if (!answer || ageMs > 1800) return null;
  const probabilities = answer.probabilities;
  if (
    !probabilities ||
    !Object.keys(VECTOR_AXES).every(
      (id) =>
        Number.isFinite(probabilities[id]) &&
        probabilities[id] >= 0 &&
        probabilities[id] <= 1,
    )
  )
    return null;
  return Object.fromEntries(
    Object.keys(VECTOR_AXES).map((id) => [
      id,
      { probability: probabilities[id], selected: id === answer.choice },
    ]),
  );
}
