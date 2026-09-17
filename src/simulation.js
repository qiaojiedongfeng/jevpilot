import {
  generateWorld,
  makeRoute,
  shortestPath,
  signalState,
} from "./world.js";
import {
  clamp,
  dist,
  heading,
  move,
  angle,
  pointAt,
  nearestOnPath,
  rng,
  choose,
  round,
  blockedByBuilding,
} from "./math.js";
import {
  VECTOR_AXES,
  VELOCITY,
  projectVectors,
  physics,
  pedalPhysics,
} from "./planning.js";
import {
  brakingSpeed,
  leadVehicle,
  predictTrafficConflict,
} from "./traffic-safety.js";
import { collisionPose, firstCollision } from "./collisions.js";
export { VELOCITY, physics } from "./planning.js";
export const STEERING = VECTOR_AXES;
export class Simulation {
  constructor(seed = Math.floor(Math.random() * 999999), type = "town") {
    this.reset(seed, type);
  }
  reset(seed, type) {
    this.world = generateWorld(seed, type);
    this.time = 0;
    this.paused = false;
    this.autopilot = false;
    this.safety = true;
    this.pedals = { throttle: 0, brake: 0 };
    this.steeringInput = 0;
    this.brakeReason = null;
    this.complete = false;
    this.collisions = 0;
    this.crash = null;
    this.violations = 0;
    this.distance = 0;
    this.freeExplore = false;
    this.events = [];
    this.locks = new Map();
    this.r = rng(seed + 51);
    this.contacts = new Set();
    this.discovered = new Map();
    this.perception = [];
    this.nextScan = 0;
    const p = this.world.route.points[0],
      h = heading(p, this.world.route.points[1]);
    this.player = {
      id: "ego",
      type: "car",
      x: p.x,
      z: p.z,
      heading: h,
      speed: 0,
      steering: 0,
      steeringProgress: 0,
      target: 0,
      route: this.world.route,
      s: 0,
      stops: {},
      width: 1.9,
      depth: 4.75,
    };
    this.traffic = [];
    for (let i = 0; i < this.world.theme.traffic; i++) this.spawnTraffic(i);
    this.pedestrians = [];
    for (
      let i = 0;
      i < (type === "highway" ? 0 : 14 + (type === "city" ? 12 : 0));
      i++
    ) {
      const node = choose(this.r, this.world.nodes),
        crossing = i % 3 === 0 && node.control === "signal";
      const other = this.world.byId[choose(this.r, node.neighbors)];
      const walkHeading = heading(node, other),
        side = this.r() < 0.5 ? -1 : 1;
      const pathStart = move(
        move(node, walkHeading, 14),
        walkHeading + Math.PI / 2,
        7.05 * side,
      );
      const pathLength = dist(node, other) - 28;
      const progress = crossing ? 0 : this.r() * pathLength;
      const position = crossing
        ? { x: node.x - 8, z: node.z - 7.8 }
        : move(pathStart, walkHeading, progress);
      this.pedestrians.push({
        id: `pedestrian-${i}`,
        type: "pedestrian",
        nodeId: node.id,
        x: position.x,
        z: position.z,
        progress,
        walkPath: {
          start: pathStart,
          heading: walkHeading,
          length: pathLength,
        },
        direction: this.r() > 0.5 ? 1 : -1,
        crossing,
        walking: false,
        speed: 0,
        width: 0.6,
        depth: 0.6,
        height: 1.7,
      });
    }
  }
  spawnTraffic(i, distant = false) {
    const nodes = this.world.nodes;
    let a = choose(this.r, nodes),
      b = choose(
        this.r,
        nodes.filter((n) => dist(n, a) > 100),
      ),
      ids = shortestPath(this.world, a.id, b.id);
    if (ids.length < 3) return this.spawnTraffic(i, distant);
    const route = makeRoute(
        this.world,
        ids,
        this.world.type === "highway" && i % 2 === 0 ? 4.5 : undefined,
      ),
      s = this.r() * route.length,
      p = pointAt(route.points, s),
      next = pointAt(route.points, s + 1);
    if (dist(p, this.player) < (distant ? 600 : 15))
      return this.spawnTraffic(i, distant);
    const existing = this.traffic.find((v) => v.id === `vehicle-${i}`);
    if (this.traffic.some((v) => v !== existing && dist(v, p) < 10)) return;
    const v = {
      id: `vehicle-${i}`,
      type: i % 5 === 0 ? "motorcycle" : "car",
      x: p.x,
      z: p.z,
      heading: heading(p, next),
      speed: 0,
      s,
      route,
      stops: {},
      width: i % 5 === 0 ? 0.8 : 1.9,
      depth: i % 5 === 0 ? 2.3 : 4.2,
      color: choose(this.r, [
        "#de8e69",
        "#e9be57",
        "#97b6b9",
        "#efefe2",
        "#658f82",
        "#a294bf",
      ]),
    };
    if (existing) Object.assign(existing, v);
    else this.traffic.push(v);
  }
  continueTraffic(v) {
    if (this.world.type === "highway") return;
    // Rebuild from the current final road segment, before its junction enters
    // braking range. The shared segment preserves lane position and heading.
    const ids = v.route.ids.slice(-2);
    for (let i = 0; i < 5; i++) {
      const node = this.world.byId[ids.at(-1)];
      const forward = node.neighbors.filter((id) => id !== ids.at(-2));
      ids.push(choose(this.r, forward.length ? forward : node.neighbors));
    }
    const route = makeRoute(this.world, ids);
    const near = nearestOnPath(v, route.points);
    if (near.distance > 0.5) return;
    v.route = route;
    v.s = near.s;
    v.stops = {};
    v.amber = null;
  }
  event(text, type = "info") {
    if (this.events[0]?.text === text && this.time - this.events[0].time < 3)
      return;
    this.events.unshift({ time: round(this.time, 1), text, type });
    this.events = this.events.slice(0, 30);
  }
  crossingFor(v) {
    return v.route.crossings.find((c) => c.stopS - v.s > -19);
  }
  rule(v, update = false) {
    const c = this.crossingFor(v);
    if (!c)
      return {
        mustStop: false,
        distance: Infinity,
        reason: "Clear road",
        color: null,
      };
    const node = this.world.byId[c.nodeId],
      delta = c.stopS - v.s,
      signal =
        node.control === "signal"
          ? signalState(node, this.time, c.approach)
          : { color: "stop", walk: false };
    const amberKey = `${node.id}:${Math.floor((this.time + node.offset) / 24)}`;
    if (update && signal.color === "amber" && v.amber?.key !== amberKey)
      v.amber = {
        key: amberKey,
        proceed:
          (v.speed * v.speed) / 16 > Math.max(0, delta - v.depth / 2 - 0.2),
      };
    const proceedOnAmber =
      v.amber?.key === amberKey
        ? v.amber.proceed
        : (v.speed * v.speed) / 16 > Math.max(0, delta - v.depth / 2 - 0.2);
    const inside = delta < -0.7;
    let stop = v.stops[c.nodeId];
    if (update && delta < 5.5 && delta > -0.7 && v.speed < 0.2) {
      if (!stop)
        v.stops[c.nodeId] = stop = { arrived: this.time, served: false };
      if (this.time - stop.arrived >= 1.2) stop.served = true;
    }
    let reason = "Clear road",
      mustStop = false;
    if (!inside) {
      if (
        node.control === "signal" &&
        (signal.color === "red" ||
          (signal.color === "amber" && !proceedOnAmber))
      ) {
        mustStop = true;
        reason = signal.walk
          ? "Pedestrian crossing"
          : `${signal.color === "amber" ? "Amber" : "Red"} light`;
      }
      if (node.control === "stop" && !stop?.served) {
        mustStop = true;
        reason = "Stop sign";
      }
      const lock = this.locks.get(node.id);
      if (lock && lock.id !== v.id) {
        mustStop = true;
        reason = "Yield to crossing traffic";
      }
      if (node.control === "stop" && stop?.served) {
        const waiting = [this.player, ...this.traffic].filter(
          (o) =>
            o.id !== v.id &&
            o.stops[node.id] &&
            !o.stops[node.id].passed &&
            this.crossingFor(o)?.nodeId === node.id &&
            o.stops[node.id].arrived < stop.arrived,
        );
        if (waiting.length) {
          mustStop = true;
          reason = "Yield to first arrival";
        }
      }
      const pedestrians = this.pedestrians.filter(
        (p) => p.crossing && p.walking && p.nodeId === node.id,
      );
      if (pedestrians.length) {
        mustStop = true;
        reason = "Yield to pedestrian";
      }
      if (update && !mustStop && delta < 3)
        this.locks.set(node.id, { id: v.id, at: this.time });
    } else if (update) {
      this.locks.set(node.id, { id: v.id, at: this.time });
      if (stop) stop.passed = true;
    }
    return {
      mustStop,
      distance: delta,
      reason,
      color: signal.color,
      nodeId: node.id,
      stopCompleted: !!stop?.served,
      walk: signal.walk,
    };
  }
  leadGap(v) {
    return leadVehicle(v, [...this.traffic, this.player])?.gap ?? Infinity;
  }
  speedEnvelope(v) {
    const rule = this.rule(v),
      lead = leadVehicle(v, [...this.traffic, this.player]),
      gap = lead?.gap ?? Infinity;
    let max = this.world.theme.limit,
      reason = null;
    if (rule.mustStop && rule.distance > -0.7) {
      const cap = Math.sqrt(
        2 * 5 * Math.max(0, rule.distance - v.depth / 2 - 0.2),
      );
      if (cap < max) {
        max = cap;
        reason = rule.reason;
      }
    }
    if (v === this.player && !this.freeExplore) {
      const distance = Math.max(0, v.route.length - v.s);
      const destinationCap = Math.sqrt(2 * 5 * Math.max(0, distance - 1.5));
      if (destinationCap < max) {
        max = destinationCap;
        reason = "Destination ahead";
      }
    }
    const cap = brakingSpeed(gap - (lead?.other.type === "motorcycle" ? 4 : 3));
    if (cap < max) {
      max = cap;
      reason =
        lead?.other.type === "motorcycle"
          ? "Motorcycle ahead"
          : "Vehicle ahead";
    }
    const conflict =
      v === this.player
        ? predictTrafficConflict(v, [...this.traffic, ...this.pedestrians])
        : null;
    if (conflict && conflict.max_speed_mps < max) {
      max = conflict.max_speed_mps;
      reason = conflict.reason;
    }
    return { max, reason, rule, gap, conflict, lead };
  }
  step(dt) {
    if (this.paused || this.crash) return;
    const previous = new Map(
      [...this.traffic, ...this.pedestrians].map((o) => [
        o.id,
        {
          pose: collisionPose(o),
          route: o.route,
        },
      ]),
    );
    const firstStep = this.time === 0;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    for (const [id, lock] of this.locks) {
      const car = [this.player, ...this.traffic].find((c) => c.id === lock.id),
        node = this.world.byId[id];
      if (!car || dist(car, node) > 17 || this.time - lock.at > 7)
        this.locks.delete(id);
    }
    for (const p of this.pedestrians) {
      const node = this.world.byId[p.nodeId],
        walk = signalState(node, this.time, 0).walk;
      if (p.crossing) {
        if (walk && !p.walking && p.progress === 0) {
          const anyCar = [this.player, ...this.traffic].some(
            (v) => dist(v, node) < 13,
          );
          if (!anyCar) p.walking = true;
        }
        if (p.walking) {
          p.progress += dt * 3.8;
          if (p.progress >= 16) {
            p.progress = 0;
            p.walking = false;
            p.direction *= -1;
          }
        } else if (p.progress > 0) {
          p.progress = 0;
        }
        p.x = node.x + (p.direction > 0 ? -8 + p.progress : 8 - p.progress);
        p.z = node.z - 7.8;
        p.speed = p.walking ? 3.8 : 0;
        p.heading = p.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        p.progress += dt * 0.9 * p.direction;
        if (p.progress > p.walkPath.length || p.progress < 0) {
          p.progress = clamp(p.progress, 0, p.walkPath.length);
          p.direction *= -1;
        }
        const position = move(p.walkPath.start, p.walkPath.heading, p.progress);
        p.x = position.x;
        p.z = position.z;
        p.walking = true;
        p.speed = 0.9;
        p.heading = angle(p.walkPath.heading + (p.direction < 0 ? Math.PI : 0));
      }
    }
    for (const v of this.traffic) {
      if (v.route.length - v.s < 75) this.continueTraffic(v);
      const rule = this.rule(v, true);
      let target = this.speedEnvelope(v).max;
      const next = pointAt(v.route.points, v.s + 9),
        h = heading(v, next);
      if (Math.abs(angle(h - v.heading)) > 0.2) target = Math.min(target, 4);
      v.speed += clamp(target - v.speed, -7 * dt, 2.8 * dt);
      if (
        rule.mustStop &&
        rule.distance >= 0 &&
        v.speed * dt > Math.max(0, rule.distance - v.depth / 2 - 0.2)
      )
        v.speed = Math.max(0, rule.distance - v.depth / 2 - 0.2) / dt;
      v.s += v.speed * dt;
      if (v.s >= v.route.length - 1) {
        // Interstate vehicles continue beyond the map and recycle only after
        // leaving the view. No visible route-end teleport.
        if (dist(v, this.player) > 1300)
          this.spawnTraffic(Number(v.id.split("-")[1]), true);
        else {
          v.x += Math.sin(v.heading) * v.speed * dt;
          v.z -= Math.cos(v.heading) * v.speed * dt;
        }
        continue;
      }
      const p = pointAt(v.route.points, v.s),
        ahead = pointAt(v.route.points, v.s + 0.5);
      v.x = p.x;
      v.z = p.z;
      v.heading = heading(p, ahead);
    }
    if (this.time >= this.nextScan) {
      this.scanScene();
      this.nextScan = this.time + 0.2;
    }
    const v = this.player,
      old = { ...collisionPose(v), s: v.s };
    this.rule(v, true);
    let target = v.target;
    this.brakeReason = null;
    if (this.autopilot && this.safety) {
      const env = this.speedEnvelope(v);
      if (target > env.max) {
        target = env.max;
        this.brakeReason = env.reason;
      }
    }
    if (this.complete) target = 0;
    if (this.autopilot || this.complete) physics(v, v.steering, target, dt);
    else
      pedalPhysics(
        v,
        this.steeringInput,
        this.pedals.throttle,
        this.pedals.brake,
        dt,
      );
    v.x = clamp(v.x, this.world.bounds.minX, this.world.bounds.maxX);
    v.z = clamp(v.z, this.world.bounds.minZ, this.world.bounds.maxZ);
    const hit = firstCollision(old, collisionPose(v), [
      ...this.world.objects
        .filter((o) => o.type === "building")
        .map((object) => ({ object })),
      ...[...this.traffic, ...this.pedestrians].map((object) => ({
        object,
        // Newly spawned traffic and initial pedestrian placement are teleports.
        previous:
          !firstStep && previous.get(object.id)?.route === object.route
            ? previous.get(object.id).pose
            : null,
      })),
    ]);
    if (hit) {
      Object.assign(v, {
        x: hit.player.x,
        z: hit.player.z,
        heading: hit.player.heading,
      });
      if (hit.object.type !== "building") {
        Object.assign(hit.object, {
          x: hit.target.x,
          z: hit.target.z,
          heading: hit.target.heading,
          speed: 0,
          walking: false,
        });
      }
      this.distance += dist(old, v);
      v.s = nearestOnPath(v, v.route.points).s;
      this.crash = {
        object_id: hit.object.id,
        type: hit.object.type,
        time_s: round(this.time, 2),
        impact_speed_mps: round(hit.relativeSpeed, 2),
        player_speed_mps: round(Math.abs(v.speed), 2),
        point: hit.point,
        normal: hit.normal,
      };
      v.speed = v.target = v.steering = 0;
      this.autopilot = false;
      this.complete = false;
      this.collisions++;
      this.contacts = new Set([hit.object.id]);
      this.event(`Collision with ${hit.object.type} — drive ended`, "error");
      return;
    }
    this.contacts.clear();
    this.distance += dist(old, v);
    const near = nearestOnPath(v, v.route.points);
    v.s = near.s;
    for (const c of v.route.crossings) {
      if (old.s < c.stopS && v.s >= c.stopS && near.distance < 4) {
        const node = this.world.byId[c.nodeId];
        if (
          node.control === "signal"
            ? signalState(node, this.time, c.approach).color === "red"
            : !v.stops[node.id]?.served
        ) {
          this.violations++;
          this.event(
            node.control === "stop" ? "Missed stop sign" : "Crossed on red",
            "error",
          );
        }
      }
    }
    if (
      !this.complete &&
      !this.freeExplore &&
      dist(v, v.route.points.at(-1)) < 3 &&
      v.speed < 1
    ) {
      this.complete = true;
      v.target = 0;
      this.autopilot = false;
      this.event("Destination reached. Nicely driven.", "success");
    }
  }
  navigation() {
    const v = this.player,
      near = nearestOnPath(v, v.route.points),
      look = pointAt(
        v.route.points,
        v.s + Math.max(5, Math.abs(v.speed) * 1.1),
      ),
      c = this.crossingFor(v);
    const turn = c ? angle(c.exit - c.approach) : 0;
    return {
      remaining_m: round(Math.max(0, v.route.length - v.s)),
      route_offset_m: round(near.distance),
      heading_error_deg: round(
        (angle(heading(v, look) - v.heading) * 180) / Math.PI,
      ),
      lookahead: { x: round(look.x), z: round(look.z) },
      next_turn: c
        ? Math.abs(turn) < 0.3
          ? "straight"
          : turn > 0
            ? "right"
            : "left"
        : "arrive",
      turn_distance_m: round(
        c ? Math.max(0, c.stopS - v.s + 10) : v.route.length - v.s,
      ),
      destination: { id: this.world.destination, ...v.route.points.at(-1) },
    };
  }
  steeringCandidates(vectors = projectVectors(this.player, false)) {
    const v = this.player,
      near = nearestOnPath(v, v.route.points);
    return Object.fromEntries(
      Object.entries(vectors).map(([id, vector]) => {
        const end = vector.evaluation,
          projected = nearestOnPath(end, v.route.points, near.index);
        const error = angle(
          heading(end, pointAt(v.route.points, projected.s + 4)) -
            vector.evaluation.heading,
        );
        return [
          id,
          {
            axis: vector.axis,
            projected_lane_error_m: round(projected.distance),
            projected_heading_error_deg: round(
              (Math.abs(error) * 180) / Math.PI,
            ),
            tracking_error: round(projected.distance + Math.abs(error) * 3),
          },
        ];
      }),
    );
  }
  scanScene() {
    const v = this.player;
    const range = Math.max(80, Math.abs(v.speed) * 6);
    const buildings = this.world.objects.filter((o) => o.type === "building");
    const found = [];
    for (const o of [
      ...this.traffic,
      ...this.pedestrians,
      ...this.world.objects,
    ]) {
      if (
        ![
          "car",
          "motorcycle",
          "pedestrian",
          "building",
          "stop_sign",
          "traffic_light",
        ].includes(o.type)
      )
        continue;
      const dx = o.x - v.x,
        dz = o.z - v.z;
      const forward = dx * Math.sin(v.heading) - dz * Math.cos(v.heading);
      const right = dx * Math.cos(v.heading) + dz * Math.sin(v.heading);
      const distance = Math.hypot(dx, dz);
      if (
        distance > range ||
        Math.abs(Math.atan2(right, forward)) > (65 * Math.PI) / 180
      )
        continue;
      if (blockedByBuilding(v, o, buildings, o.id)) continue;
      const previous = this.discovered.get(o.id);
      this.discovered.set(o.id, {
        first_seen_s: previous?.first_seen_s ?? round(this.time, 1),
        last_seen_s: round(this.time, 1),
        type: o.type,
      });
      found.push({
        id: o.id,
        type: o.type,
        ahead_m: round(forward, 1),
        right_m: round(right, 1),
        speed_mps: round(o.speed || 0, 1),
        ...(["car", "motorcycle", "pedestrian"].includes(o.type)
          ? {
              heading_relative_deg: round(
                (angle((o.heading || 0) - v.heading) * 180) / Math.PI,
              ),
            }
          : {}),
        ...(o.type === "traffic_light"
          ? {
              signal: signalState(
                this.world.byId[o.nodeId],
                this.time,
                o.approach,
              ).color,
            }
          : {}),
        ...(o.type === "pedestrian"
          ? { crossing: o.crossing && o.walking }
          : {}),
      });
    }
    this.perception = found.sort(
      (a, b) =>
        Math.hypot(a.ahead_m, a.right_m) - Math.hypot(b.ahead_m, b.right_m),
    );
    this.sensorRange = range;
  }
  decisionState(vectors = projectVectors(this.player, false)) {
    if (!this.perception.length) this.scanScene();
    const nav = this.navigation(),
      env = this.speedEnvelope(this.player),
      candidates = this.steeringCandidates(vectors);
    const dynamic = this.perception
      .filter((o) => ["car", "motorcycle", "pedestrian"].includes(o.type))
      .sort(
        (a, b) =>
          Number(
            b.id === env.conflict?.object_id || b.id === env.lead?.other.id,
          ) -
          Number(
            a.id === env.conflict?.object_id || a.id === env.lead?.other.id,
          ),
      )
      .slice(0, 5);
    const control = this.crossingFor(this.player);
    const seenControl =
      control &&
      this.perception.some(
        (o) =>
          this.world.objects.find((w) => w.id === o.id)?.nodeId ===
          control.nodeId,
      );
    return {
      speed_mps: round(this.player.speed, 1),
      limit_mps: this.world.theme.limit,
      speed_ceiling_mps: round(
        Math.min(
          env.max,
          Math.abs(nav.heading_error_deg) > 15 ||
            (["left", "right"].includes(nav.next_turn) &&
              nav.turn_distance_m < 24)
            ? 5
            : ["left", "right"].includes(nav.next_turn) &&
                nav.turn_distance_m < 48
              ? 10
              : this.world.theme.limit,
        ),
        1,
      ),
      bend_deg: round(Math.abs(nav.heading_error_deg), 1),
      destination_m: round(nav.remaining_m, 1),
      turn: { direction: nav.next_turn, in_m: round(nav.turn_distance_m, 1) },
      scene: {
        range_m: Math.round(this.sensorRange),
        intersection:
          control && seenControl
            ? {
                signal: env.rule.color,
                visible: !!seenControl,
                in_m: round(env.rule.distance, 1),
                must_yield: env.rule.mustStop,
                reason: env.rule.reason,
                stop_completed: env.rule.stopCompleted,
              }
            : null,
        nearby: dynamic,
        ...(env.lead && env.gap < this.sensorRange
          ? {
              following: {
                id: env.lead.other.id,
                gap_m: round(env.gap, 1),
                minimum_gap_m: env.lead.other.type === "motorcycle" ? 4 : 3,
              },
            }
          : {}),
        ...(env.conflict
          ? {
              hazard: {
                id: env.conflict.object_id,
                type: env.conflict.type,
                in_s: round(env.conflict.time_s, 1),
                ahead_m: round(env.conflict.distance_m, 1),
              },
            }
          : {}),
      },
      vectors: Object.fromEntries(
        Object.entries(candidates).map(([id, c]) => [id, c.tracking_error]),
      ),
    };
  }
  observation(full = false) {
    const v = this.player,
      buildings = this.world.objects.filter((o) => o.type === "building"),
      all = [
        ...this.traffic,
        ...this.pedestrians,
        ...this.world.objects.filter((o) => o.type !== "parcel"),
      ];
    const visible = [],
      occluded = [];
    for (const o of all) {
      const dx = o.x - v.x,
        dz = o.z - v.z,
        d = dist(v, o),
        f = dx * Math.sin(v.heading) - dz * Math.cos(v.heading),
        l = dx * Math.cos(v.heading) + dz * Math.sin(v.heading),
        bearing = (Math.atan2(l, f) * 180) / Math.PI;
      if (d > 80 || Math.abs(bearing) > 65) continue;
      if (blockedByBuilding(v, o, buildings, o.id)) {
        occluded.push(o.id);
        continue;
      }
      visible.push({
        id: o.id,
        type: o.type,
        position: { x: round(o.x), z: round(o.z) },
        distance_m: round(d),
        forward_m: round(f),
        right_m: round(l),
        bearing_deg: round(bearing),
        speed_mps: round(o.speed || 0),
        heading_deg:
          o.heading === undefined
            ? undefined
            : round((o.heading * 180) / Math.PI),
        dimensions: { width: o.width, depth: o.depth, height: o.height },
        style: o.style,
        signal:
          o.type === "traffic_light"
            ? signalState(this.world.byId[o.nodeId], this.time, o.approach)
                .color
            : undefined,
        walking: o.walking,
      });
    }
    visible.sort((a, b) => a.distance_m - b.distance_m);
    const env = this.speedEnvelope(v);
    const obs = {
      schema_version: "1.0",
      frame: {
        time_s: round(this.time),
        seed: this.world.seed,
        environment: this.world.type,
        coordinates:
          "meters; +x east, +z south; heading 0 north; positive steering right",
      },
      ego: {
        position: { x: round(v.x), y: 0.4, z: round(v.z) },
        heading_deg: round((v.heading * 180) / Math.PI),
        speed_mps: round(v.speed),
        steering_axis: round(v.steering),
        velocity_axis_mps: round(v.target),
        dimensions: { width: v.width, length: v.depth },
        control: this.autopilot ? "jev" : "manual",
        pedals: this.autopilot ? null : { ...this.pedals },
      },
      navigation: this.navigation(),
      road_rules: {
        drive_on: "right",
        speed_limit_mps: this.world.theme.limit,
        next_control: {
          ...env.rule,
          distance: round(
            Number.isFinite(env.rule.distance) ? env.rule.distance : 999,
          ),
        },
        lead_vehicle_gap_m: Number.isFinite(env.gap) ? round(env.gap) : null,
        stop_dwell_s: 1.2,
        amber_rule:
          "Stop if there is sufficient braking distance; otherwise clear the intersection",
      },
      sensor: {
        horizontal_fov_deg: 130,
        range_m: 80,
        occlusion: "line of sight blocked by building footprints",
        visible_count: visible.length,
        occluded_count: occluded.length,
        visible_objects: visible,
        discovered_objects: Object.fromEntries(this.discovered),
        live_nearby: this.perception,
      },
      steering_candidates: this.steeringCandidates(),
      telemetry: {
        collisions: this.collisions,
        crash: this.crash,
        traffic_violations: this.violations,
        distance_driven_m: round(this.distance),
        arrived: this.complete,
        brake_intervention: this.brakeReason,
        predicted_conflict: env.conflict,
      },
    };
    if (full)
      obs.world = {
        bounds: this.world.bounds,
        start: this.world.route.points[0],
        destination: this.world.route.points.at(-1),
        junctions: this.world.nodes.map((n) => ({
          ...n,
          signal: signalState(n, this.time, 0),
        })),
        roads: this.world.edges,
        static_objects: this.world.objects,
        traffic_controls: this.world.objects
          .filter((o) => o.type === "traffic_light" || o.type === "stop_sign")
          .map((o) => ({
            id: o.id,
            node_id: o.nodeId,
            approach_heading_deg: round((o.approach * 180) / Math.PI),
            state:
              o.type === "stop_sign"
                ? { color: "stop" }
                : signalState(this.world.byId[o.nodeId], this.time, o.approach),
          })),
        vehicles: this.traffic.map(({ route, stops, ...o }) => ({
          ...o,
          route_node_ids: route.ids,
        })),
        pedestrians: this.pedestrians,
        planned_route: this.world.route,
        sensor_occluded_ids: occluded,
      };
    return obs;
  }
}
