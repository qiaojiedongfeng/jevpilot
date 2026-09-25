import { dist, heading, pointAt, samplePolyline } from "./math.js";

export const ACTORS = {
  slow: {
    name: "慢车",
    color: "#e7ae44",
    speed: 12,
    width: 1.9,
    depth: 4.2,
    type: "car",
  },
  parked: {
    name: "障碍车",
    color: "#e57759",
    speed: 0,
    width: 1.9,
    depth: 4.2,
    type: "car",
  },
  bike: {
    name: "摩托车",
    color: "#60a5b3",
    speed: 15,
    width: 0.8,
    depth: 2.3,
    type: "motorcycle",
  },
  pedestrian: {
    name: "行人",
    color: "#b79bd4",
    speed: 5,
    width: 0.6,
    depth: 0.6,
    type: "pedestrian",
  },
};
export const emptyDraft = () => ({
  version: 1,
  name: "我的第一道驾驶考题",
  actors: [],
});

export function snapPosition(kind, p) {
  if (kind === "pedestrian") return { x: Math.round(p.x), z: Math.round(p.z) };
  return Math.abs(p.x) <= 10 || Math.abs(p.z) > 8
    ? { x: p.x < 0 ? -3 : 3, z: Math.round(p.z) }
    : { x: Math.round(p.x), z: p.z < 0 ? -3 : 3 };
}
export function newActor(kind, point, id = crypto.randomUUID()) {
  const p = snapPosition(kind, point),
    horizontal = Math.abs(p.x) > 8;
  const target =
    kind === "pedestrian"
      ? { x: p.x > 0 ? -9 : 9, z: p.z }
      : horizontal
        ? { x: p.z > 0 ? 37 : -37, z: p.z }
        : { x: p.x > 0 ? 3 : -3, z: p.x > 0 ? -100 : 100 };
  return {
    id,
    kind,
    ...p,
    target,
    speed: ACTORS[kind].speed,
    trigger: kind === "pedestrian" ? "near" : "immediate",
    distance: 25,
  };
}
const onGround = (p) =>
  p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= 42 &&
  Math.abs(p.z) <= 115;
const onRoad = (p) =>
  Math.abs(p.x) <= 5 || (Math.abs(p.z) <= 5 && Math.abs(p.x) <= 40);
export function validateDraft(draft) {
  if (
    !draft ||
    draft.version !== 1 ||
    typeof draft.name !== "string" ||
    draft.name.length > 80 ||
    !Array.isArray(draft.actors) ||
    draft.actors.length > 24
  )
    return "关卡格式不正确，最多支持 24 个对象和 80 字名称。";
  const ids = new Set();
  for (const a of draft.actors) {
    if (
      !a ||
      !Object.hasOwn(ACTORS, a.kind) ||
      typeof a.id !== "string" ||
      !a.id ||
      ids.has(a.id)
    )
      return "对象类型或编号无效。";
    ids.add(a.id);
    if (!onGround(a) || !onGround(a.target))
      return "请把对象和终点放在考场范围内。";
    if (a.kind !== "pedestrian" && (!onRoad(a) || !onRoad(a.target)))
      return "车辆及其终点需要放在道路上。";
    const maxSpeed = a.kind === "pedestrian" ? 8 : a.kind === "bike" ? 30 : 35;
    if (
      !Number.isFinite(a.speed) ||
      a.speed < 0 ||
      a.speed > maxSpeed ||
      (a.kind === "parked" && a.speed !== 0)
    )
      return "对象速度超出允许范围。";
    if (
      !["immediate", "near"].includes(a.trigger) ||
      !Number.isFinite(a.distance) ||
      a.distance < 5 ||
      a.distance > 60
    )
      return "触发距离需要在 5～60 米之间。";
    if (a.kind !== "parked" && (a.speed === 0 || dist(a, a.target) < 2))
      return "移动对象需要非零速度和至少 2 米的路径。";
    if (a.kind !== "pedestrian") {
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        if (
          !onRoad({
            x: a.x + (a.target.x - a.x) * t,
            z: a.z + (a.target.z - a.z) * t,
          })
        )
          return "首版车辆沿直线路径行驶，请将终点放在同一道路上。";
      }
    }
    if (dist(a, { x: 3, z: 106 }) < 8 || dist(a, { x: 3, z: -105 }) < 7)
      return "请留出起点和终点的安全区域。";
    for (const b of draft.actors)
      if (
        a !== b &&
        dist(a, b) < (ACTORS[a.kind].depth + ACTORS[b.kind].depth) / 2 + 0.5
      )
        return "对象之间太近，请留出一些空间。";
  }
  return null;
}

export function installActors(sim, draft) {
  const error = validateDraft(draft);
  if (error) throw new Error(error);
  sim.traffic = [];
  sim.pedestrians = [];
  for (const a of draft.actors) {
    const spec = ACTORS[a.kind];
    const points = samplePolyline([{ x: a.x, z: a.z }, a.target]);
    const actor = {
      ...structuredClone(a),
      ...spec,
      id: a.id,
      kind: a.kind,
      heading: heading(a, a.target),
      speed: 0,
      s: 0,
      stops: {},
      height: 1.7,
      route: { ids: [], crossings: [], points, length: points.at(-1).s },
      scripted: {
        speed: a.speed / 3.6,
        trigger: a.trigger,
        distance: a.distance,
        active: false,
      },
    };
    (a.kind === "pedestrian" ? sim.pedestrians : sim.traffic).push(actor);
  }
  sim.scanScene();
}
export function stepActor(actor, player, dt) {
  const script = actor.scripted;
  if (actor.kind === "parked") return;
  if (
    !script.active &&
    (script.trigger === "immediate" || dist(actor, player) <= script.distance)
  )
    script.active = true;
  const before = actor.s;
  actor.s = Math.min(
    actor.route.length,
    actor.s + (script.active ? script.speed * dt : 0),
  );
  const p = pointAt(actor.route.points, actor.s);
  actor.x = p.x;
  actor.z = p.z;
  if (actor.s < actor.route.length - 0.01)
    actor.heading = heading(
      p,
      pointAt(actor.route.points, Math.min(actor.route.length, actor.s + 0.25)),
    );
  actor.speed = dt > 0 ? (actor.s - before) / dt : 0;
  actor.walking = actor.speed > 0;
}

export class TrialScore {
  constructor() {
    this.interventions = 0;
    this.braking = false;
    this.result = null;
  }
  update(sim, cost = 0) {
    const braking = !!sim.brakeReason;
    if (braking && !this.braking) this.interventions++;
    this.braking = braking;
    const outcome = sim.crash
      ? "collision"
      : sim.complete
        ? "arrived"
        : sim.time >= 90
          ? "timeout"
          : null;
    if (outcome && !this.result)
      this.result = {
        outcome,
        time: sim.time,
        collisions: sim.collisions,
        interventions: this.interventions,
        distance: sim.distance,
        cost,
      };
    return this.result;
  }
}
