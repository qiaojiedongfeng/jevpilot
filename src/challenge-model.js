import { ACTORS } from "./arena-model.js";
import { makeRoute } from "./world.js";
import {
  dist,
  heading,
  pointAt,
  nearestOnPath,
  samplePolyline,
} from "./math.js";
import { roadGeometry, roadOccupancy } from "./road-geometry.js";
import { continuingRoute } from "./challenge-traffic.js";
export { ACTORS };

const lanes = new WeakMap();
export function worldLanes(world) {
  if (lanes.has(world)) return lanes.get(world);
  const paths = [world.route.points];
  for (const edge of world.edges)
    for (const ids of [
      [edge.a, edge.b],
      ...(!edge.oneWay ? [[edge.b, edge.a]] : []),
    ]) {
      try {
        paths.push(makeRoute(world, ids).points);
      } catch {
        /* Not every graph edge is a drivable direction. */
      }
    }
  lanes.set(world, paths);
  return paths;
}
const plain = (p) => ({
  x: Math.round(p.x * 100) / 100,
  z: Math.round(p.z * 100) / 100,
});
function pathSlice(points, from, to) {
  return samplePolyline(
    [
      pointAt(points, from),
      ...points.filter((p) => p.s > from && p.s < to),
      pointAt(points, to),
    ],
    2,
  ).map(plain);
}
export function snapToLane(world, p) {
  return worldLanes(world)
    .map((points) => ({ points, near: nearestOnPath(p, points) }))
    .sort((a, b) => a.near.distance - b.near.distance)[0];
}
export function newChallenge(world) {
  return {
    version: 2,
    name: "我的限时驾驶挑战",
    world: { seed: world.seed, type: world.type },
    limit: Math.min(
      1800,
      Math.max(
        60,
        Math.ceil(((world.route.length / world.theme.limit) * 2 + 60) / 30) *
          30,
      ),
    ),
    actors: [],
  };
}
export function makeActor(
  world,
  kind,
  p,
  id = `challenge-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
) {
  const spec = ACTORS[kind];
  if (!spec) throw Error("未知对象类型。");
  const lane = snapToLane(world, p);
  let start, path;
  if (kind === "pedestrian") {
    start = plain(p);
    const near = pointAt(lane.points, lane.near.s),
      dir = heading(
        near,
        pointAt(lane.points, Math.min(lane.points.at(-1).s, lane.near.s + 1)),
      );
    const right = Math.cos(dir),
      ahead = Math.sin(dir);
    const side = (p.x - near.x) * right + (p.z - near.z) * ahead >= 0 ? -1 : 1;
    path = [
      start,
      plain({ x: p.x + right * 16 * side, z: p.z + ahead * 16 * side }),
    ];
  } else {
    if (lane.near.distance > 9) throw Error("请点击道路附近放置车辆。");
    start = plain(pointAt(lane.points, lane.near.s));
    path = pathSlice(
      lane.points,
      lane.near.s,
      Math.min(lane.points.at(-1).s, lane.near.s + 65),
    );
    if (path.length < 2 || dist(path[0], path.at(-1)) < 2)
      throw Error("这里太接近路段终点，请往前留出行驶空间。");
  }
  return {
    id,
    kind,
    ...start,
    path,
    target: plain(path.at(-1)),
    speed: spec.speed,
    endBehavior: kind === "slow" || kind === "bike" ? "continue" : "stop",
    trigger: kind === "pedestrian" ? "near" : "immediate",
    distance: 25,
  };
}
export function retargetActor(world, actor, p) {
  if (actor.kind === "pedestrian")
    return { ...actor, target: plain(p), path: [plain(actor), plain(p)] };
  for (const points of worldLanes(world)) {
    const a = nearestOnPath(actor, points),
      b = nearestOnPath(p, points);
    if (a.distance <= 0.5 && b.distance < 6 && b.s > a.s + 2) {
      const path = pathSlice(points, a.s, b.s);
      return { ...actor, path, target: path.at(-1) };
    }
  }
  throw Error("请在同一条行驶路径的前方选择终点。弯道路径会沿道路采样。");
}
export function moveActor(world, actor, p) {
  if (actor.kind === "pedestrian") {
    const dx = p.x - actor.x,
      dz = p.z - actor.z;
    return {
      ...actor,
      ...plain(p),
      target: plain({ x: actor.target.x + dx, z: actor.target.z + dz }),
      path: actor.path.map((q) => plain({ x: q.x + dx, z: q.z + dz })),
    };
  }
  return {
    ...makeActor(world, actor.kind, p, actor.id),
    speed: actor.speed,
    trigger: actor.trigger,
    distance: actor.distance,
    endBehavior: actor.endBehavior,
  };
}
export function validateChallenge(draft, world, ambient = []) {
  if (
    !draft ||
    draft.version !== 2 ||
    typeof draft.name !== "string" ||
    draft.name.length > 80 ||
    !Array.isArray(draft.actors) ||
    draft.actors.length > 24
  )
    return "关卡格式无效，最多支持 24 个对象。";
  if (
    !draft.world ||
    draft.world.seed !== world.seed ||
    draft.world.type !== world.type
  )
    return "关卡的地图或种子不匹配。";
  if (!Number.isFinite(draft.limit) || draft.limit < 30 || draft.limit > 1800)
    return "任务时限应为 30～1800 秒。";
  const validPoint = (p) =>
    p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.z) &&
    p.x >= world.bounds.minX &&
    p.x <= world.bounds.maxX &&
    p.z >= world.bounds.minZ &&
    p.z <= world.bounds.maxZ;
  const ids = new Set(),
    roads = roadGeometry(world);
  for (const a of draft.actors) {
    if (
      !a ||
      !Object.hasOwn(ACTORS, a.kind) ||
      typeof a.id !== "string" ||
      !/^challenge-[a-zA-Z0-9-]{1,80}$/.test(a.id) ||
      ids.has(a.id)
    )
      return "对象类型或编号无效。";
    ids.add(a.id);
    if (
      a.endBehavior !== undefined &&
      !["continue", "stop"].includes(a.endBehavior)
    )
      return "终点行为无效。";
    if (
      !validPoint(a) ||
      !validPoint(a.target) ||
      !Array.isArray(a.path) ||
      a.path.length < 2 ||
      a.path.length > 1000 ||
      !a.path.every(validPoint)
    )
      return "对象位置或路径超出地图范围。";
    if (dist(a, a.path[0]) > 0.05 || dist(a.target, a.path.at(-1)) > 0.05)
      return "路径起终点与对象位置不一致。";
    if (
      ["slow", "bike"].includes(a.kind) &&
      (a.endBehavior ?? "continue") === "continue" &&
      !continuingRoute(world, a)
    )
      return "此路径无法接入后续车道，请调整终点或选择终点停车。";
    if (
      !Number.isFinite(a.speed) ||
      a.speed < (a.kind === "parked" ? 0 : 1) ||
      a.speed > (a.kind === "pedestrian" ? 8 : 60) ||
      (a.kind === "parked" && a.speed !== 0)
    )
      return "对象速度无效。";
    if (
      !["near", "immediate"].includes(a.trigger) ||
      !Number.isFinite(a.distance) ||
      a.distance < 5 ||
      a.distance > 100
    )
      return "触发距离应为 5～100 米。";
    if (
      a.path.reduce((sum, p, i) => sum + (i ? dist(p, a.path[i - 1]) : 0), 0) >
      2000
    )
      return "路径不能超过 2000 米。";
    const samples = samplePolyline(a.path, 1);
    if (
      samples.at(-1).s > 2000 ||
      (a.kind !== "parked" && samples.at(-1).s < 2)
    )
      return "路径长度应为 2～2000 米。";
    const checked = a.kind === "parked" ? samples.slice(0, 1) : samples;
    for (let i = 0; i < checked.length; i++) {
      const p = checked[i],
        next = samples[Math.min(i + 1, samples.length - 1)],
        previous = samples[Math.max(0, i - 1)];
      if (
        world.objects.some((o) => {
          if (o.type !== "building") return false;
          const c = Math.cos(o.rotation || 0),
            s = Math.sin(o.rotation || 0),
            dx = p.x - o.x,
            dz = p.z - o.z,
            padding = ACTORS[a.kind].width / 2;
          return (
            Math.abs(dx * c - dz * s) < o.width / 2 + padding &&
            Math.abs(dx * s + dz * c) < o.depth / 2 + padding
          );
        })
      )
        return "对象或路径穿过建筑，请调整位置。";
      if (
        a.kind !== "pedestrian" &&
        roadOccupancy(
          {
            ...p,
            ...ACTORS[a.kind],
            heading: heading(i === samples.length - 1 ? previous : p, next),
          },
          roads,
        ).outside_fraction > 0.05
      )
        return "车辆路径需要保持在道路内。";
    }
    if (
      dist(a, world.route.points[0]) < 8 ||
      dist(a, world.route.points.at(-1)) < 7
    )
      return "请留出任务起点和终点的安全区域。";
    for (const b of [...draft.actors, ...ambient]) {
      if (b === a || b.id === a.id || b.scripted) continue;
      const depth = ACTORS[b.kind]?.depth ?? b.depth ?? 0.6;
      if (dist(a, b) < (ACTORS[a.kind].depth + depth) / 2 + 0.5)
        return "对象与其他车辆或行人重叠，请调整位置。";
    }
  }
  return null;
}
export function applyChallengeActors(sim, draft) {
  const ambient = [...sim.traffic, ...sim.pedestrians].filter(
    (a) => !a.scripted,
  );
  const error = validateChallenge(draft, sim.world, ambient);
  if (error) throw Error(error);
  sim.traffic = sim.traffic.filter((a) => !a.scripted);
  sim.pedestrians = sim.pedestrians.filter((a) => !a.scripted);
  for (const a of draft.actors) {
    const spec = ACTORS[a.kind],
      points = samplePolyline(a.path, 1);
    const continuation =
      ["slow", "bike"].includes(a.kind) &&
      (a.endBehavior ?? "continue") === "continue"
        ? continuingRoute(sim.world, a)
        : null;
    const actor = {
      ...a,
      ...spec,
      speed: 0,
      heading: heading(points[0], points[1]),
      s: 0,
      stops: {},
      walking: false,
      route: continuation ?? {
        ids: [],
        crossings: [],
        points,
        length: points.at(-1).s,
      },
      scripted: {
        traffic: !!continuation,
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
export class ChallengeScore {
  constructor(limit) {
    this.limit = limit;
    this.elapsed = 0;
    this.interventions = 0;
    this.braking = false;
    this.result = null;
  }
  update(sim, dt, cost) {
    if (this.result) return this.result;
    this.elapsed += dt;
    const braking = !!sim.brakeReason;
    if (braking && !this.braking) this.interventions++;
    this.braking = braking;
    const outcome = sim.crash
      ? "collision"
      : sim.complete
        ? "arrived"
        : this.elapsed >= this.limit
          ? "timeout"
          : null;
    if (outcome)
      this.result = {
        outcome,
        elapsed: this.elapsed,
        limit: this.limit,
        collisions: sim.collisions,
        violations: sim.violations,
        interventions: this.interventions,
        distance: sim.distance,
        cost,
      };
    return this.result;
  }
}
