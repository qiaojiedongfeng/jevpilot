import { makeRoute } from "./world.js";
import { angle, heading, nearestOnPath, samplePolyline } from "./math.js";

// Keep the authored path verbatim; join a graph route at its endpoint.
export function continuingRoute(world, actor) {
  const end = actor.path.at(-1),
    before = actor.path.at(-2);
  const direction = heading(before, end);
  const starts = [
    world.route.ids,
    ...world.edges.flatMap((e) => [
      [e.a, e.b],
      ...(!e.oneWay ? [[e.b, e.a]] : []),
    ]),
  ];
  for (const initial of starts) {
    const ids = [...initial];
    for (let i = 0; i < 6; i++) {
      const node = world.byId[ids.at(-1)];
      const exits = node.neighbors.filter((id) => id !== ids.at(-2)).sort();
      if (!exits.length) break;
      ids.push(exits[0]);
    }
    let route;
    try {
      route = makeRoute(world, ids);
    } catch {
      continue;
    }
    const near = nearestOnPath(end, route.points);
    if (
      near.distance > 0.5 ||
      Math.abs(angle(near.heading - direction)) > 0.25 ||
      route.length - near.s < 10
    )
      continue;
    // Metadata before the join comes from the matching graph path too, so
    // a scripted vehicle respects signals while approaching its waypoint.
    const start = nearestOnPath(actor, route.points);
    if (
      start.distance > 0.5 ||
      start.s >= near.s ||
      actor.path.some((p) => nearestOnPath(p, route.points).distance > 0.6)
    )
      continue;
    const authored = samplePolyline(actor.path, 1);
    const shift = authored.at(-1).s - near.s;
    return {
      ...route,
      points: [
        ...authored,
        ...route.points
          .filter((p) => p.s > near.s + 0.01)
          .map((p) => ({ ...p, s: p.s + shift })),
      ],
      crossings: route.crossings
        .filter((c) => c.stopS >= start.s - 19)
        .map((c) => ({ ...c, stopS: c.stopS + shift })),
      sections: route.sections
        ?.filter((s) => s.endS > start.s)
        .map((s) => ({
          ...s,
          startS: Math.max(0, s.startS + shift),
          endS: s.endS + shift,
        })),
      length: route.length + shift,
    };
  }
  return null;
}
