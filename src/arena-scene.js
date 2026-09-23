import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { ACTORS } from "./arena-model.js";

export class ArenaScene {
  constructor(canvas, sim, onPick) {
    this.canvas = canvas; this.sim = sim; this.onPick = onPick; this.meshes = new Map();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color("#dce3d5");
    this.camera = new THREE.OrthographicCamera(-150, 150, 80, -80, 0.1, 1000);
    this.camera.up.set(1, 0, 0); this.camera.position.set(0, 250, 0); this.camera.lookAt(0, 0, 0);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableRotate = false; this.controls.minZoom = 0.7; this.controls.maxZoom = 6;
    this.controls.mouseButtons.LEFT = null; this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d987e, 2.6));
    const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(-80, 150, 50);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, far: 400 });
    this.scene.add(sun);
    this.box(this.scene, 112, .6, 266, 0, -.5, 0, "#c7d1bd");
    this.box(this.scene, 17, .3, 242, 0, -.1, 0, "#f1eee2");
    this.box(this.scene, 86, .3, 17, 0, -.09, 0, "#f1eee2");
    this.box(this.scene, 12, .1, 240, 0, .1, 0, "#586467");
    this.box(this.scene, 84, .1, 12, 0, .11, 0, "#586467");
    for (let z = -117; z < 120; z += 7) if (Math.abs(z) > 10) {
      this.box(this.scene, .15, .02, 3, 0, .18, z, "#ead9a7");
      for (const x of [-5.7, 5.7]) this.box(this.scene, .13, .02, 5.5, x, .18, z, "#e9e9dd");
    }
    for (let x = -38; x < 40; x += 7) if (Math.abs(x) > 10) this.box(this.scene, 3, .02, .15, x, .19, 0, "#ead9a7");
    for (let x = -5; x <= 5; x += 1.5) this.box(this.scene, .8, .02, 3.2, x, .2, 12, "#ececda");
    for (let z = -105; z <= 106; z += 4) this.box(this.scene, .2, .03, 1.2, 3, .23, z, "#a9d6ba");
    this.box(this.scene, 5.4, .03, 1, 3, .24, 102, "#b7e1bd");
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) this.box(this.scene, .9, .04, .9, .75 + i * .9, .25, -103 + j * .9, (i + j) % 2 ? "#edf1dd" : "#293c3e");
    this.label("START / 起点", 17, 103); this.label("FINISH / 终点", 17, -103);
    this.label("01 / CROSSING", -20, 0);
    for (const z of [-92, -64, -36, 42, 70, 98]) for (const x of [-23, 28]) {
      this.box(this.scene, .7, 3, .7, x, 1.5, z, "#918575");
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), new THREE.MeshStandardMaterial({ color: x < 0 ? "#849c77" : "#9eaf82", flatShading: true }));
      crown.position.set(x, 5, z); crown.castShadow = true; this.scene.add(crown);
    }
    this.hero = this.actorMesh("slow", "#f7f5e9"); this.scene.add(this.hero);
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener("pointerdown", e => { if (e.button === 0) this.down = { x: e.clientX, y: e.clientY, point: this.point(e) }; });
    canvas.addEventListener("pointerup", e => {
      if (!this.down || e.button !== 0) return;
      const start = this.down; this.down = null;
      this.onPick(this.point(e), start.point, Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6);
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    this.resize();
  }
  box(parent, w, h, d, x, y, z, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .85 }));
    mesh.position.set(x, y, z); mesh.castShadow = h > .5; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  label(text, x, z) {
    const c = document.createElement("canvas"); c.width = 768; c.height = 128;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#53654e"; ctx.font = "600 40px sans-serif"; ctx.textAlign = "center"; ctx.fillText(text, 384, 75);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.PI / 2; mesh.position.set(x, .3, z); this.scene.add(mesh);
  }
  actorMesh(kind, color = ACTORS[kind].color) {
    const group = new THREE.Group();
    if (kind === "pedestrian") {
      this.box(group, .55, 1, .5, 0, 1, 0, color);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 10, 8), new THREE.MeshStandardMaterial({ color: "#efd0af" }));
      head.position.y = 1.8; group.add(head);
      for (const x of [-.16, .16]) this.box(group, .18, .5, .2, x, .3, 0, "#36434e");
    } else if (kind === "bike") {
      this.box(group, .55, .6, 1.5, 0, .7, 0, color);
      this.box(group, .55, .7, .5, 0, 1.3, 0, "#2f4b53");
      for (const z of [-.7, .7]) this.box(group, .15, .55, .55, 0, .3, z, "#26353a");
      this.box(group, .8, .1, .1, 0, 1.05, -.6, "#e8e0c9");
    } else {
      this.box(group, 1.9, .8, 4.2, 0, .65, 0, color);
      this.box(group, 1.65, .55, 2.1, 0, 1.3, .2, "#30464e");
      this.box(group, 1.6, .12, 1.3, 0, 1.62, .3, color);
      for (const x of [-.98, .98]) for (const z of [-1.3, 1.3]) this.box(group, .25, .55, .75, x, .4, z, "#243338");
      for (const x of [-.65, .65]) this.box(group, .4, .2, .06, x, .75, -2.13, "#fff4bf");
    }
    return group;
  }
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.camera);
    const p = new THREE.Vector3(); return this.ray.ray.intersectPlane(this.plane, p) ? { x: p.x, z: p.z } : null;
  }
  disposeGroup(group) {
    group.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
    group.clear();
  }
  setDraft(draft, selected, editing = true) {
    this.disposeGroup(this.overlay);
    const wanted = new Set(draft.actors.map(a => a.id));
    for (const [id, mesh] of this.meshes) if (!wanted.has(id)) { this.scene.remove(mesh); this.disposeGroup(mesh); this.meshes.delete(id); }
    for (const a of draft.actors) {
      if (!this.meshes.has(a.id)) { const mesh = this.actorMesh(a.kind); this.scene.add(mesh); this.meshes.set(a.id, mesh); }
      if (!editing) continue;
      const selectedActor = a.id === selected;
      const ring = new THREE.Mesh(new THREE.RingGeometry(selectedActor ? 2.8 : 2, selectedActor ? 3.2 : 2.25, 40), new THREE.MeshBasicMaterial({ color: selectedActor ? "#173f36" : ACTORS[a.kind].color, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(a.x, .35, a.z); this.overlay.add(ring);
      if (a.kind !== "parked") {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, .4, a.z), new THREE.Vector3(a.target.x, .4, a.target.z)]);
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: ACTORS[a.kind].color, dashSize: 2, gapSize: 1, transparent: true, opacity: selectedActor ? 1 : .45 }));
        line.computeLineDistances(); this.overlay.add(line);
        if (selectedActor) {
          this.box(this.overlay, 1.4, .1, 1.4, a.target.x, .4, a.target.z, ACTORS[a.kind].color);
          if (a.trigger === "near") {
            const circle = new THREE.Mesh(new THREE.RingGeometry(a.distance - .15, a.distance, 96), new THREE.MeshBasicMaterial({ color: ACTORS[a.kind].color, transparent: true, opacity: .6, side: THREE.DoubleSide }));
            circle.rotation.x = -Math.PI / 2; circle.position.set(a.x, .32, a.z); this.overlay.add(circle);
          }
        }
      }
    }
  }
  home() { this.follow = false; this.camera.up.set(1, 0, 0); this.camera.position.set(0, 250, 0); this.controls.target.set(0, 0, 0); this.camera.zoom = 1; this.camera.lookAt(0, 0, 0); this.controls.enabled = true; this.resize(); }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    const aspect = r.width / Math.max(1, r.height), half = Math.max(142 / aspect, 60);
    this.camera.left = -half * aspect; this.camera.right = half * aspect; this.camera.top = half; this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }
  render() {
    const p = this.sim.player;
    this.hero.position.set(p.x, .1, p.z); this.hero.rotation.y = -p.heading;
    for (const actor of [...this.sim.traffic, ...this.sim.pedestrians]) {
      const mesh = this.meshes.get(actor.id); if (mesh) { mesh.position.set(actor.x, .1, actor.z); mesh.rotation.y = -actor.heading; }
    }
    if (this.follow) {
      this.controls.enabled = false; this.camera.up.set(0, 1, 0);
      this.camera.position.set(p.x - 24, 32, p.z + 34); this.camera.zoom = 3;
      this.camera.lookAt(p.x, 0, p.z - 8); this.camera.updateProjectionMatrix();
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
