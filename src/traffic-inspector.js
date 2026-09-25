import * as THREE from 'three';
import { vehicleDiagnostic, diagnosticSnapshot } from './traffic-diagnostics.js';

export function installTrafficInspector(sim, scene, draft) {
  const panel = document.createElement('section');
  panel.className = 'glass traffic-inspector';
  panel.hidden = true;
  panel.setAttribute('aria-label', '车辆等待诊断');
  panel.innerHTML = '<button class="traffic-close" aria-label="关闭路况诊断">×</button><h3>车辆为什么在等？</h3><p>双击场景中的车辆，或从下方选择。</p><select aria-label="诊断车辆"></select><pre></pre><button class="traffic-export">保存卡住现场</button><p>现场包含地图、考题、车辆状态和等待原因，不含 API 密钥。</p>';
  document.body.append(panel);
  const select = panel.querySelector('select'), output = panel.querySelector('pre');
  let selected = sim.player.id, last = 0;
  const exportSnapshot = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosticSnapshot(sim, draft()), null, 2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'jev-traffic-snapshot.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  panel.querySelector('.traffic-close').onclick = () => panel.hidden = true;
  panel.querySelector('.traffic-export').onclick = exportSnapshot;
  select.onchange = () => { selected = select.value; last = 0; update(); };
  function update() {
    if (panel.hidden || performance.now() - last < 500) return;
    last = performance.now();
    const cars = [sim.player, ...sim.traffic];
    const ids = cars.map(v => v.id).join('|');
    if (select.dataset.ids !== ids) {
      select.replaceChildren(...cars.map(v => {
        const option = document.createElement('option'); option.value = v.id;
        option.textContent = `${v === sim.player ? 'AI 小车' : v.type === 'motorcycle' ? '摩托车' : '车辆'} · ${v.id}`;
        return option;
      })); select.dataset.ids = ids;
    }
    const car = cars.find(v => v.id === selected) ?? sim.player;
    select.value = car.id;
    const d = vehicleDiagnostic(sim, car);
    output.textContent = `${d.reason}\n已停留 ${d.waiting_s} 秒 · ${d.speed_kmh} km/h\n信号：${({red:'红灯',green:'绿灯',amber:'黄灯',stop:'停车标志'})[d.signal] ?? '无'}${d.blocker ? `\n阻挡车辆：${d.blocker}` : ''}`;
  }
  function open(id) { selected = id ?? sim.speedEnvelope(sim.player).lead?.other.id ?? sim.player.id; panel.hidden = false; last = 0; update(); }
  const ray = new THREE.Raycaster();
  scene.canvas.addEventListener('dblclick', e => {
    if (scene.editorFocus) return;
    const r = scene.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1, -(e.clientY-r.top)/r.height*2+1), scene.camera);
    const hit = ray.intersectObjects([...scene.vehicles.values()], true)[0];
    if (!hit) return;
    for (const [id, mesh] of scene.vehicles) {
      for (let o = hit.object; o; o = o.parent) if (o === mesh) { open(id); return; }
    }
  });
  return {open, update, exportSnapshot};
}
