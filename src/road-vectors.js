import * as THREE from "three";
import {
  projectVectors,
  VECTOR_AXES,
  VECTOR_STEPS,
  vectorWeights,
} from "./planning.js";

function ribbon() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array((VECTOR_STEPS + 1) * 6),
      3,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  const progress = [],
    indices = [];
  for (let i = 0; i <= VECTOR_STEPS; i++)
    progress.push(i / VECTOR_STEPS, i / VECTOR_STEPS);
  geometry.setAttribute(
    "progress",
    new THREE.Float32BufferAttribute(progress, 1),
  );
  for (let i = 0; i < VECTOR_STEPS; i++) {
    const n = i * 2;
    indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
  }
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color("#007aff") },
      alpha: { value: 0.27 },
      time: { value: 0 },
      pulse: { value: 0 },
    },
    vertexShader: `attribute float progress; varying float vProgress; void main() { vProgress = progress; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 tint; uniform float alpha; uniform float time; uniform float pulse; varying float vProgress; void main() { float fade = (1.0 - smoothstep(0.72,1.0,vProgress)) * smoothstep(0.015,0.08,vProgress); float scan = 1.0 - pulse * (0.5 + 0.5 * sin(vProgress * 18.0 - time * 6.0)); gl_FragColor = vec4(tint, alpha * fade * scan);
      #include <colorspace_fragment>
    }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}
function updateRibbon(mesh, points, width, y) {
  const a = mesh.geometry.attributes.position;
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 1)],
      dx = after.x - before.x,
      dz = after.z - before.z,
      len = Math.hypot(dx, dz) || 1;
    a.setXYZ(
      i * 2,
      points[i].x - (dz / len) * width,
      y,
      points[i].z + (dx / len) * width,
    );
    a.setXYZ(
      i * 2 + 1,
      points[i].x + (dz / len) * width,
      y,
      points[i].z - (dx / len) * width,
    );
  }
  a.needsUpdate = true;
}
export class RoadVectors {
  constructor(scene, layer) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.layer = layer;
    layer.hidden = true;
    layer.replaceChildren();
    this.items = new Map();
    this.answer = null;
    this.received = 0;
    this.enabled = true;
    this.elapsed = 0;
    for (const id of Object.keys(VECTOR_AXES)) {
      const glow = ribbon(),
        line = ribbon();
      glow.visible = line.visible = false;
      this.group.add(glow, line);
      const label = document.createElement("span");
      label.hidden = true;
      label.className = "vector-label";
      label.dataset.vector = id;
      layer.append(label);
      this.items.set(id, {
        glow,
        line,
        label,
        opacity: 0.27,
        width: 0.075,
        local: null,
      });
    }
  }
  setAnswer(answer) {
    this.answer = answer;
    this.received = performance.now();
  }
  clear() {
    this.answer = null;
    this.received = 0;
    this.proposals = null;
    for (const item of this.items.values()) item.local = null;
  }
  render(car, camera, width, height, dt, active, paused) {
    const age = paused ? 0 : performance.now() - this.received;
    const weights = active ? vectorWeights(this.answer, age) : null;
    const visible = this.enabled && active && !!weights;
    this.group.visible = visible;
    this.layer.hidden = !visible;
    if (!visible) return;
    if (!paused) this.elapsed += dt;
    const labels = [];
    const sin = Math.sin(car.heading),
      cos = Math.cos(car.heading);
    if (!this.proposals || this.elapsed - this.projectedAt >= 1 / 12) {
      this.projectedAt = this.elapsed;
      this.proposals = Object.fromEntries(
        Object.entries(projectVectors(car)).map(([id, vector]) => [
          id,
          vector.points.map((point) => {
            const dx = point.x - car.x,
              dz = point.z - car.z;
            return { x: dx * cos + dz * sin, z: dx * sin - dz * cos };
          }),
        ]),
      );
    }
    for (const [id, local] of Object.entries(this.proposals)) {
      const item = this.items.get(id),
        p = weights?.[id]?.probability ?? 0,
        selected = !!weights?.[id]?.selected;
      item.line.visible = item.glow.visible = selected;
      const blend = 1 - Math.exp(-dt * 14);
      item.opacity +=
        ((weights ? (selected ? 0.86 : 0.27 + 0.4 * Math.sqrt(p)) : 0.27) -
          item.opacity) *
        blend;
      item.width += ((selected ? 0.38 : 0.075) - item.width) * blend;
      // Smooth changing proposals in vehicle coordinates, keeping every line anchored to the car.
      if (!item.local) item.local = local.map((p) => ({ ...p }));
      item.local.forEach((point, i) => {
        point.x += (local[i].x - point.x) * blend;
        point.z += (local[i].z - point.z) * blend;
      });
      const points = item.local.map((point) => ({
        x: car.x + point.x * cos + point.z * sin,
        z: car.z + point.x * sin - point.z * cos,
      }));
      updateRibbon(item.line, points, item.width, selected ? 0.25 : 0.21);
      updateRibbon(item.glow, points, item.width * 2.5, 0.195);
      item.line.renderOrder = selected ? 5 : 3;
      item.line.material.uniforms.tint.value.set("#007aff");
      item.line.material.uniforms.alpha.value = item.opacity;
      item.line.material.uniforms.time.value = this.elapsed;
      item.line.material.uniforms.pulse.value = selected ? 0.05 : 0.18;
      item.glow.material.uniforms.alpha.value = selected
        ? item.opacity * 0.16
        : 0;
      const end = points[Math.floor(VECTOR_STEPS * 0.7)];
      const screen = new THREE.Vector3(end.x, 0.65, end.z).project(camera);
      item.label.hidden =
        !selected ||
        screen.z > 1 ||
        screen.z < 0 ||
        Math.abs(screen.x) > 1 ||
        Math.abs(screen.y) > 1;
      item.label.classList.toggle("selected", selected);
      item.label.style.opacity = String(
        selected ? 1 : 0.4 + 0.5 * Math.sqrt(p),
      );
      item.label.textContent = weights ? `${Math.round(p * 100)}%` : "";
      item.label.setAttribute(
        "aria-label",
        `${id}: ${weights ? Math.round(p * 100) + " percent" : "awaiting decision"}${selected ? ", selected" : ""}`,
      );
      if (!item.label.hidden)
        labels.push({
          item,
          x: (screen.x * 0.5 + 0.5) * width,
          y: (-0.5 * screen.y + 0.5) * height,
          selected,
          p,
        });
    }
    const placed = [];
    labels.sort((a, b) => Number(b.selected) - Number(a.selected) || b.p - a.p);
    for (const label of labels) {
      let y = label.y;
      for (
        let i = 0;
        i < 8 &&
        placed.some(
          (p) => Math.abs(p.x - label.x) < 55 && Math.abs(p.y - y) < 24,
        );
        i++
      )
        y = label.y - (i + 1) * 24;
      placed.push({ x: label.x, y });
      label.item.label.style.transform = `translate(${label.x}px,${y}px) translate(-50%,-50%)`;
    }
  }
}
