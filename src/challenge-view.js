import * as THREE from "three";
import { ACTORS } from "./challenge-model.js";

// An editor overlay on the original renderer. All actors are native DriveScene models.
export class ChallengeView {
  constructor(scene, handlers) {
    this.scene = scene;
    this.handlers = handlers;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const canvas = scene.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (!scene.editorFocus || ![0, 2].includes(e.button)) return;
      const p = this.point(e);
      if (!p) return;
      this.down = {
        camera: scene.camera.clone(),
        x: e.clientX,
        y: e.clientY,
        p,
        button: e.button,
        focus: { ...scene.editorFocus },
      };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!scene.editorFocus || !this.down || this.down.button !== 2) return;
      const p = this.point(e, this.down.camera);
      if (!p) return;
      scene.editorFocus.x = this.down.focus.x + this.down.p.x - p.x;
      scene.editorFocus.z = this.down.focus.z + this.down.p.z - p.z;
      scene.snap = true;
    });
    canvas.addEventListener("pointerup", (e) => {
      const down = this.down;
      this.down = null;
      if (!down || !scene.editorFocus || down.button !== 0) return;
      const p = this.point(e);
      if (p)
        handlers.pick(
          p,
          down.p,
          Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5,
        );
    });
    canvas.addEventListener("pointercancel", () => (this.down = null));
  }
  point(e, camera = this.scene.camera) {
    const r = this.scene.canvas.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, p)
      ? { x: p.x, z: p.z }
      : null;
  }
  enter(focus) {
    this.scene.editorFocus = { x: focus.x, z: focus.z };
    this.scene.mode = "map";
    this.scene.snap = true;
    this.scene.cameraInput.editing = true;
    Object.assign(this.scene.cameraInput.states.map, {
      pitch: 1.15,
      distance: 120,
    });
  }
  exit() {
    this.clear();
    this.scene.editorFocus = null;
    this.scene.cameraInput.editing = false;
    this.scene.mode = "chase";
    this.scene.snap = true;
    this.down = null;
  }
  clear() {
    if (this.overlay) {
      this.overlay.removeFromParent();
      this.overlay.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this.overlay = null;
  }
  update(draft, selected, editing) {
    this.clear();
    this.scene.syncActors();
    if (!editing) return;
    this.overlay = new THREE.Group();
    this.scene.scene.add(this.overlay);
    const route = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        this.scene.sim.world.route.points.map(
          (p) => new THREE.Vector3(p.x, 0.22, p.z),
        ),
      ),
      new THREE.LineBasicMaterial({
        color: "#3e6ae1",
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.overlay.add(route);
    for (const a of draft.actors) {
      const active = a.id === selected,
        color = active ? "#3e6ae1" : ACTORS[a.kind].color;
      this.ring(a, Math.max(1.2, ACTORS[a.kind].depth / 2 + 0.4), color, 0.15);
      if (!active || a.kind === "parked") continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          a.path.map((p) => new THREE.Vector3(p.x, 0.3, p.z)),
        ),
        new THREE.LineDashedMaterial({ color, dashSize: 1.5, gapSize: 0.8 }),
      );
      line.computeLineDistances();
      this.overlay.add(line);
      this.ring(a.target, 1, color, 0.25);
      if (a.trigger === "near") this.ring(a, a.distance, color, 0.08);
    }
  }
  ring(p, r, color, width) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + width, 96),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.25, p.z);
    this.overlay.add(ring);
  }
}
