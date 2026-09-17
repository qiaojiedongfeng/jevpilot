import {
  rng,
  choose,
  dist,
  heading,
  move,
  nearestOnPath,
  pointAt,
  samplePolyline,
} from "./math.js";

function smoothRoad(nodes) {
  const raw = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)],
      p1 = nodes[i];
    const p2 = nodes[i + 1],
      p3 = nodes[Math.min(nodes.length - 1, i + 2)];
    for (let k = 0; k < 40; k++) {
      const t = k / 40,
        p = {};
      for (const axis of ["x", "z"])
        p[axis] =
          0.5 *
          (2 * p1[axis] +
            (-p0[axis] + p2[axis]) * t +
            (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t +
            (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t * t * t);
      raw.push(p);
    }
  }
  raw.push(nodes.at(-1));
  return samplePolyline(raw, 2);
}

function offsetPath(points, offset) {
  return points.map((p, i) =>
    move(
      p,
      heading(
        points[Math.max(0, i - 1)],
        points[Math.min(points.length - 1, i + 1)],
      ) +
        Math.PI / 2,
      offset,
    ),
  );
}

function cubic(a, b, c, d) {
  return samplePolyline(
    Array.from({ length: 81 }, (_, i) => {
      const t = i / 80,
        u = 1 - t;
      return {
        x:
          u ** 3 * a.x +
          3 * u ** 2 * t * b.x +
          3 * u * t ** 2 * c.x +
          t ** 3 * d.x,
        z:
          u ** 3 * a.z +
          3 * u ** 2 * t * b.z +
          3 * u * t ** 2 * c.z +
          t ** 3 * d.z,
      };
    }),
    1.5,
  );
}

// All interstate routes follow the same sampled road. Re-smoothing a subset of
// junctions produces a different curve and moves traffic away from its lane.
export function makeHighwayRoute(world, ids, laneOffset = 9) {
  const points = [],
    sections = [];
  const append = (path) => {
    for (const p of path) {
      const last = points.at(-1);
      if (last && dist(last, p) < 0.001) continue;
      points.push({ x: p.x, z: p.z, s: last ? last.s + dist(last, p) : 0 });
    }
  };
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i],
      b = ids[i + 1];
    const edge = world.edges.find(
      (e) => (e.a === a && e.b === b) || (!e.oneWay && e.b === a && e.a === b),
    );
    if (!edge) throw Error(`No drivable connection from ${a} to ${b}`);
    let path;
    if (edge.path) path = edge.a === a ? edge.path : [...edge.path].reverse();
    else {
      const start = nearestOnPath(world.byId[a], world.roadSamples).s;
      const end = nearestOnPath(world.byId[b], world.roadSamples).s;
      const low = Math.min(start, end),
        high = Math.max(start, end);
      const center = [
        pointAt(world.roadSamples, low),
        ...world.roadSamples.filter((p) => p.s > low && p.s < high),
        pointAt(world.roadSamples, high),
      ];
      if (end < start) center.reverse();
      path = offsetPath(center, laneOffset);
    }
    const startS = points.at(-1)?.s ?? 0;
    append(path);
    const previous = sections.at(-1);
    if (previous?.kind === edge.kind && previous.speedLimit === edge.speedLimit)
      previous.endS = points.at(-1).s;
    else
      sections.push({
        kind: edge.kind,
        name: edge.name,
        startS,
        endS: points.at(-1).s,
        speedLimit: edge.speedLimit,
        laneHalfWidth: edge.kind === "interstate" ? 2.25 : 3,
      });
  }
  return { ids, points, sections, crossings: [], length: points.at(-1).s };
}

export function generateHighway(seed, theme) {
  const random = rng(seed),
    nodes = [],
    edges = [],
    objects = [];
  const phase = random() * 2;
  for (let i = 0; i < 9; i++)
    nodes.push({
      id: `h${i}`,
      x: Math.sin(i * 0.65 + phase) * 48,
      z: 680 - i * 170,
      control: "none",
      offset: 0,
      neighbors: [],
    });
  const roadSamples = smoothRoad(nodes);
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i],
      b = nodes[i + 1];
    a.neighbors.push(b.id);
    b.neighbors.push(a.id);
    edges.push({
      id: `interstate-${i}`,
      a: a.id,
      b: b.id,
      width: 25,
      length: dist(a, b),
      speedLimit: 28,
      kind: "interstate",
      name: "Interstate 08",
    });
  }
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const station = (id) => nearestOnPath(byId[id], roadSamples).s;
  const lanePoint = (s, offset) => {
    const p = pointAt(roadSamples, s);
    return move(p, p.heading + Math.PI / 2, offset);
  };
  const startX = Math.max(byId.h0.x, byId.h1.x, byId.h2.x) + 145;
  const townX = Math.max(byId.h6.x, byId.h7.x, byId.h8.x) + 155;
  const addNode = (id, p) => {
    const node = {
      id,
      x: p.x,
      z: p.z,
      control: "none",
      offset: 0,
      neighbors: [],
    };
    nodes.push(node);
    byId[id] = node;
    return node;
  };
  const start = addNode("local-start", { x: startX, z: 660 });
  const ramp = addNode("onramp", { x: startX, z: 565 });
  const mergeStart = station("h2"),
    mergeEnd = station("h3");
  const merge = addNode("merge-lane", lanePoint(mergeStart, 15));
  const exitStart = station("h6"),
    exitSplit = exitStart + 80;
  const exit = addNode("exit-cedar", lanePoint(exitSplit, 17));
  const town = addNode("cedar-town", { x: townX, z: -580 });
  const destination = addNode("cedar-stop", { x: townX, z: -755 });
  const connectorRoads = [];
  const link = (
    a,
    b,
    surface,
    width,
    speed,
    kind,
    name,
    offset = 0,
    endInset = 0,
  ) => {
    const sampled = samplePolyline(surface, 1.5);
    const path = samplePolyline(offsetPath(sampled, offset), 1.5);
    if (endInset) {
      const end = path.at(-1).s - endInset;
      const last = pointAt(path, end);
      while (path.at(-1).s > end) path.pop();
      path.push(last);
    }
    a.neighbors.push(b.id);
    edges.push({
      id: `${a.id}-${b.id}`,
      a: a.id,
      b: b.id,
      oneWay: true,
      width,
      speedLimit: speed,
      kind,
      name,
      length: path.at(-1).s,
      path,
    });
    connectorRoads.push({
      id: kind,
      // Overlap asphalt at joins: independently sampled end tangents otherwise
      // leave a thin wedge that rejects every forward trajectory as off-road.
      // Rendering and occupancy share these points; the route stays unchanged.
      // The local street also extends behind the entire spawned car.
      points: samplePolyline(
        [
          move(
            sampled[0],
            heading(sampled[0], sampled[1]),
            kind === "local" ? -18 : -0.25,
          ),
          ...sampled,
          move(sampled.at(-1), heading(sampled.at(-2), sampled.at(-1)), 0.25),
        ],
        1.5,
      ),
      width,
      kind,
      twoWay: offset !== 0,
    });
  };
  link(start, ramp, [start, ramp], 12, 10, "local", "Mill Road", 3);
  const rampStart = { x: ramp.x + 3, z: ramp.z };
  const mergeHeading = pointAt(roadSamples, mergeStart).heading;
  link(
    ramp,
    merge,
    cubic(
      rampStart,
      move(rampStart, 0, 90),
      move(merge, mergeHeading, -85),
      merge,
    ),
    6,
    26,
    "onramp",
    "Interstate 08 on-ramp",
  );
  const merging = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100,
      blend = t * t * (3 - 2 * t);
    return lanePoint(mergeStart + (mergeEnd - mergeStart) * t, 15 - 6 * blend);
  });
  link(merge, byId.h3, merging, 6, 26, "merge", "Merge onto Interstate 08");
  const exiting = Array.from({ length: 61 }, (_, i) => {
    const t = i / 60,
      blend = t * t * (3 - 2 * t);
    return lanePoint(exitStart + (exitSplit - exitStart) * t, 9 + 8 * blend);
  });
  link(byId.h6, exit, exiting, 6, 22, "exit", "Cedar Town exit");
  const townEntry = { x: town.x + 3, z: town.z };
  const exitHeading = pointAt(roadSamples, exitSplit).heading;
  link(
    exit,
    town,
    cubic(
      exit,
      move(exit, exitHeading, 80),
      move(townEntry, 0, -80),
      townEntry,
    ),
    6,
    16,
    "offramp",
    "Cedar Town off-ramp",
  );
  link(
    town,
    destination,
    [town, destination],
    12,
    10,
    "town",
    "Cedar Town · Station Street",
    3,
    15,
  );

  // A few connected side streets and low buildings make the destination a town.
  for (const z of [-620, -695])
    connectorRoads.push({
      id: `cedar-cross-${z}`,
      kind: "town",
      twoWay: true,
      width: 12,
      points: samplePolyline(
        [
          { x: townX - 55, z },
          { x: townX + 80, z },
        ],
        2,
      ),
    });
  for (const [x, z, style] of [
    [townX - 22, -594, "shop"],
    [townX + 24, -594, "shop"],
    [townX - 22, -649, "cottage"],
    [townX + 24, -649, "townhouse"],
    [townX - 23, -672, "modern"],
    [townX + 25, -672, "cottage"],
    [townX - 23, -724, "shop"],
    [townX + 25, -728, "townhouse"],
    [startX - 23, 630, "cottage"],
    [startX + 23, 600, "shop"],
  ])
    objects.push({
      id: `building-${objects.length}`,
      type: "building",
      x,
      z,
      width: 12,
      depth: 14,
      height: style === "townhouse" ? 8 : 5,
      style,
      rotation: 0,
      color: choose(random, ["#eadbc9", "#d4d9cb", "#c6b4a2", "#ddd4c0"]),
    });
  for (const z of [-598, -645, -673, -723])
    objects.push({
      id: `lamp-${z}`,
      type: "streetlight",
      x: townX + 7.8,
      z,
      height: 6,
    });
  for (let i = 0; i < 210; i++) {
    const p = {
      x: (random() > 0.5 ? 1 : -1) * (65 + random() * 200),
      z: -760 + random() * 1480,
    };
    const nearConnector = connectorRoads.some(
      (road) => nearestOnPath(p, road.points).distance < road.width / 2 + 8,
    );
    if (
      nearConnector ||
      objects.some((o) => o.type === "building" && dist(p, o) < 18)
    )
      continue;
    objects.push({
      id: `tree-${i}`,
      type: "tree",
      ...p,
      height: 5 + random() * 9,
      kind: random() > 0.25 ? "pine" : "round",
    });
  }
  for (let i = 0; i < 10; i++)
    objects.push({
      id: `hill-${i}`,
      type: "hill",
      x: (i % 2 ? 1 : -1) * (270 + random() * 70),
      z: -700 + random() * 1400,
      height: 20 + random() * 35,
      width: 70 + random() * 60,
      depth: 80,
    });
  for (const i of [2, 5])
    objects.push({
      id: `overpass-${i}`,
      type: "overpass",
      x: byId[`h${i}`].x,
      z: byId[`h${i}`].z - 45,
      width: 230,
      depth: 13,
      height: 9,
    });
  for (const [i, text] of [
    [3, "INTERSTATE 08"],
    [5, "CEDAR TOWN · EXIT →"],
  ])
    objects.push({
      id: `highway-sign-${i}`,
      type: "highway_sign",
      x: byId[`h${i}`].x,
      z: byId[`h${i}`].z + 60,
      width: 18,
      height: 8,
      text,
    });
  objects.push({
    id: "cedar-welcome",
    type: "town_sign",
    x: townX + 9,
    z: -588,
    text: "CEDAR TOWN",
    height: 3,
  });
  const world = {
    seed,
    type: "highway",
    theme,
    nodes,
    byId,
    edges,
    objects,
    roadSamples,
    connectorRoads,
    shoulderOpenings: [
      [mergeStart - 5, mergeEnd + 8],
      [exitStart - 8, exitSplit + 15],
    ],
    xs: [-350, 350],
    zs: [-800, 720],
    bounds: { minX: -370, maxX: 370, minZ: -805, maxZ: 740 },
    startNode: start.id,
    nextNode: ramp.id,
    destination: destination.id,
  };
  world.route = makeHighwayRoute(world, [
    start.id,
    ramp.id,
    merge.id,
    "h3",
    "h4",
    "h5",
    "h6",
    exit.id,
    town.id,
    destination.id,
  ]);
  world.destinationStopLine = {
    ...move(world.route.points.at(-1), 0, 1.4),
    heading: 0,
  };
  return world;
}
