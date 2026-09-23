export function arenaWorld(seed) {
  const nodes = [
    { id: "start", x: 0, z: 120, neighbors: ["cross"] },
    { id: "cross", x: 0, z: 0, neighbors: ["start", "finish", "west", "east"] },
    { id: "finish", x: 0, z: -120, neighbors: ["cross"] },
    { id: "west", x: -42, z: 0, neighbors: ["cross"] },
    { id: "east", x: 42, z: 0, neighbors: ["cross"] },
  ].map(n => ({ ...n, control: "none", offset: 0 }));
  return {
    seed, type: "arena", theme: { name: "试车场 01", limit: 11.11, traffic: 0 },
    nodes, byId: Object.fromEntries(nodes.map(n => [n.id, n])),
    edges: [["start", "cross"], ["cross", "finish"], ["west", "cross"], ["cross", "east"]].map(([a, b], i) => ({
      id: `arena-road-${i}`, a, b, width: 12, speedLimit: 11.11, name: "试车场道路",
      length: i < 2 ? 120 : 42,
    })),
    objects: [], xs: [-42, 0, 42], zs: [-120, 0, 120],
    bounds: { minX: -55, maxX: 55, minZ: -130, maxZ: 130 },
    startNode: "start", nextNode: "cross", destination: "finish",
  };
}
