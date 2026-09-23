import "./arena.css";
import { Simulation } from "./simulation.js";
import { BackgroundPlanner } from "./background-planner.js";
import { decisionControls } from "./planning.js";
import { ArenaScene } from "./arena-scene.js";
import { ACTORS, emptyDraft, newActor, snapPosition, validateDraft, installActors, TrialScore } from "./arena-model.js";

const $ = id => document.getElementById(id);
const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icons = { slow: "▰", parked: "▥", bike: "♧", pedestrian: "♟" };
const descriptions = { slow: "测试跟车与通行", parked: "制造道路障碍", bike: "沿路骑行或横穿", pedestrian: "设置过街考题" };
let draft = emptyDraft(), selected = null, tool = "select", targetMode = false, mode = "edit", configured = false;
let history = [], score = new TrialScore(), cost = 0, token = 0, pending = false, controller = null, budget = 0, accumulator = 0;
let statusMessage = "正在检查 Jev 连接…", noticeTimer;
let restoreMessage = "";
try {
  const saved = localStorage.getItem("jevpilot-arena-v1");
  if (saved) { const candidate = JSON.parse(saved); if (!validateDraft(candidate)) draft = candidate; else restoreMessage = "保存的关卡格式已失效，已打开空白考场。"; }
} catch { restoreMessage = "无法读取本地草稿，可以通过导入关卡继续。"; }
const sim = new Simulation(42, "arena");
sim.backgroundPlanning = true; sim.paused = true;
installActors(sim, draft);
const planner = new BackgroundPlanner();

$("app").innerHTML = `
<div class="arena-shell">
  <header class="arena-header">
    <a class="arena-brand" href="/">JEV<span> / </span>驾驶考场<small>DRIVING LAB · 01</small></a>
    <div class="arena-tabs"><span id="mode-edit" class="active">01 布置考题</span><span id="mode-run">02 AI 应考</span><span id="mode-result">03 看成绩</span></div>
    <a class="original-link" href="/?mode=drive">自由驾驶 ↗</a>
  </header>
  <div class="arena-workspace">
    <aside class="tool-panel">
      <div class="eyebrow">BUILD A CHALLENGE</div><h1>这一次，<br>你来出题。</h1><p class="panel-intro">放下一个意外，看看 AI 如何应对。</p>
      <div class="section-label">出题工具 <span>点击后放到道路上</span></div>
      <div class="tool-list">${Object.entries(ACTORS).map(([kind, a], i) => `<button class="actor-tool" data-tool="${kind}" aria-pressed="false"><span class="tool-icon" style="--actor:${a.color}">${icons[kind]}</span><span><b>${a.name}</b><small>${descriptions[kind]}</small></span><kbd>${i + 1}</kbd></button>`).join("")}</div>
      <button id="select-tool" class="select-tool active">↖ 选择 / 移动 <kbd>Esc</kbd></button>
      <div class="objects-heading"><span>考场对象</span><b id="actor-count">0 / 24</b></div><div id="object-list" class="object-list"></div>
      <div class="tool-bottom"><button id="demo">载入示例考题</button><button id="clear">清空考场</button></div>
    </aside>
    <main class="arena-main">
      <div class="level-bar"><div><span class="eyebrow">TEST GROUND 01 / 固定考场</span><input id="level-name" aria-label="关卡名称" maxlength="80" value="${escape(draft.name)}"></div><span class="ground-spec">211 m 路线 · 无信号路口 · 限速 40</span></div>
      <div class="canvas-wrap"><canvas id="arena-canvas" aria-label="三维驾驶考场，选择对象工具后点击放置" tabindex="0"></canvas>
        <div class="map-caption"><span class="live-dot"></span><span id="map-mode">编辑视角 · 时间静止</span></div>
        <div class="map-actions"><button id="view-home" title="俯视全场">⊞ 全场</button><button id="view-follow" title="跟随 AI 车辆">◎ 跟车</button></div>
        <div class="map-hint" id="map-hint">左键选择 / 拖动对象 · 右键拖动地图 · 滚轮缩放</div>
        <div id="result-card" class="result-card" hidden></div>
        <div id="notice" role="status" aria-live="polite" hidden></div>
      </div>
      <footer class="arena-footer"><div class="edit-actions"><button id="undo" title="撤销 Ctrl+Z">↶ 撤销</button><button id="export">导出关卡</button><button id="import">导入</button><input type="file" id="import-file" accept=".json,application/json" hidden></div><div class="run-actions"><button id="back-edit" hidden>返回编辑</button><button id="pause-run" hidden>暂停</button><button id="start-run" class="primary" disabled>开始挑战 →</button></div></footer>
    </main>
    <aside class="inspector-panel"><div id="inspector"></div><div class="telemetry"><div class="section-label">试跑状态 <span id="connection">连接中</span></div><div class="telemetry-main"><strong id="speed">0</strong><span>km/h</span><small id="run-clock">00.0 / 90 s</small></div><div class="progress-track"><div id="progress-fill"></div></div><div class="stats-row"><span>安全介入 <b id="brakes">0</b></span><span>碰撞 <b id="collisions">0</b></span></div><p id="drive-status">${statusMessage}</p><span class="cost-label">本次调用费用 <b id="run-cost">$0.000000</b></span><p class="time-note">按模拟时间计分；等待 AI 决策时，考场时间冻结。安全制动始终开启。</p></div></aside>
  </div>
</div>`;
document.title = "Jev 驾驶考场 — 你出题，AI 应考";
document.body.classList.remove("loading"); $("scene-loader")?.remove();
$("app").inert = false; $("app").setAttribute("aria-busy", "false");
const scene = new ArenaScene($("arena-canvas"), sim, pick);

function notify(message) { $("notice").textContent = message; $("notice").hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $("notice").hidden = true, 4500); }
function save() { try { localStorage.setItem("jevpilot-arena-v1", JSON.stringify(draft)); } catch { notify("本地存储不可用，请导出关卡保存。 "); } }
function resetSim() { sim.reset(42, "arena"); sim.backgroundPlanning = true; sim.paused = true; installActors(sim, draft); planner.reset(); budget = accumulator = 0; }
function commit(next) {
  const error = validateDraft(next); if (error) { notify(error); return false; }
  history.push(structuredClone(draft)); if (history.length > 40) history.shift();
  draft = next; save(); resetSim(); renderEditor(); return true;
}
function selectTool(next) { if (mode !== "edit") return; tool = next; targetMode = false; renderEditor(); }
function pick(p, start, dragged) {
  if (mode !== "edit" || !p) return;
  if (targetMode && selected) {
    const next = structuredClone(draft), a = next.actors.find(a => a.id === selected);
    a.target = a.kind === "pedestrian" ? { x: Math.round(p.x), z: Math.round(p.z) } : snapPosition(a.kind, p);
    if (commit(next)) { targetMode = false; renderEditor(); } return;
  }
  const nearest = point => point && draft.actors.filter(a => Math.hypot(a.x - point.x, a.z - point.z) < 4).sort((a,b) => Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(b.x-point.x,b.z-point.z))[0];
  if (dragged) {
    const found = nearest(start); if (!found) return;
    const next = structuredClone(draft), a = next.actors.find(a => a.id === found.id), pos = snapPosition(a.kind, p);
    if (a.kind === "pedestrian") a.target = { x: a.target.x + pos.x - a.x, z: a.target.z + pos.z - a.z };
    else if (Math.abs(a.x - a.target.x) < .01) a.target.x = pos.x;
    else if (Math.abs(a.z - a.target.z) < .01) a.target.z = pos.z;
    Object.assign(a, pos); selected = a.id; commit(next); return;
  }
  if (tool !== "select") {
    const actor = newActor(tool, p); const next = structuredClone(draft); next.actors.push(actor);
    if (commit(next)) { selected = actor.id; tool = "select"; renderEditor(); }
  } else { selected = nearest(p)?.id || null; renderEditor(); }
}
function renderEditor() {
  const editing = mode === "edit", a = draft.actors.find(a => a.id === selected);
  $("level-name").value = draft.name; $("level-name").disabled = !editing;
  $("actor-count").textContent = `${draft.actors.length} / 24`;
  document.querySelectorAll("[data-tool]").forEach(b => { b.disabled = !editing; b.setAttribute("aria-pressed", String(b.dataset.tool === tool)); });
  $("select-tool").disabled = !editing; $("select-tool").classList.toggle("active", tool === "select");
  $("undo").disabled = !editing || !history.length;
  for (const id of ["demo", "clear", "import"]) $(id).disabled = !editing;
  $("object-list").innerHTML = draft.actors.length ? draft.actors.map((o, i) => `<button class="object-row ${o.id === selected ? "selected" : ""}" data-object="${escape(o.id)}" ${editing ? "" : "disabled"}><i style="background:${ACTORS[o.kind].color}"></i>${ACTORS[o.kind].name}<span>${String(i + 1).padStart(2, "0")}</span></button>`).join("") : `<p class="empty-list">考场还是空的。<br>先放一辆慢车，或载入示例。</p>`;
  $("object-list").querySelectorAll("[data-object]").forEach(b => b.onclick = () => { selected = b.dataset.object; tool = "select"; targetMode = false; renderEditor(); });
  $("map-hint").textContent = targetMode ? "点击地图设置路径终点 · Esc 取消" : tool !== "select" ? `点击道路放置${ACTORS[tool].name} · Esc 取消` : editing ? "左键选择 / 拖动对象 · 右键拖动地图 · 滚轮缩放" : "AI 正在应考 · 可以切换全场 / 跟车视角";
  $("arena-canvas").style.cursor = tool !== "select" || targetMode ? "crosshair" : "default";
  if (a && editing) {
    const spec = ACTORS[a.kind], stationary = a.kind === "parked";
    $("inspector").innerHTML = `<div class="eyebrow">OBJECT SETTINGS</div><div class="inspector-title"><h2>${spec.name}</h2><span style="background:${spec.color}">${icons[a.kind]}</span></div><p class="muted">拖动对象调整位置。虚线表示行驶路径。</p><div class="coordinates">位置 <b>${a.x} / ${a.z} m</b></div>${stationary ? `<div class="stationary-note">保持静止<br><small>用来测试 AI 面对占道车辆的反应。</small></div>` : `<label class="field">速度 <span><input id="actor-speed" type="number" min="1" max="${a.kind === "pedestrian" ? 8 : a.kind === "bike" ? 30 : 35}" step="1" value="${a.speed}"> km/h</span></label><label class="field stacked">出发条件<select id="actor-trigger"><option value="immediate" ${a.trigger === "immediate" ? "selected" : ""}>开始考试后立即出发</option><option value="near" ${a.trigger === "near" ? "selected" : ""}>AI 接近时出发</option></select></label>${a.trigger === "near" ? `<label class="field">触发距离 <span><input id="actor-distance" type="number" min="5" max="60" value="${a.distance}"> m</span></label><p class="field-note">AI 进入圆圈后，对象开始移动，仅触发一次。</p>` : ""}<button id="set-target" class="target-button">${targetMode ? "正在选择终点…" : "↗ 在地图上设置终点"}</button><p class="field-note">直线移动到终点后停下。车辆路径须保持在道路内。</p>`}<button id="delete-actor" class="delete-button">删除这个对象</button>`;
    for (const [id, key] of [["actor-speed", "speed"], ["actor-distance", "distance"], ["actor-trigger", "trigger"]]) if ($(id)) $(id).onchange = e => {
      const next = structuredClone(draft); next.actors.find(o => o.id === selected)[key] = key === "trigger" ? e.target.value : Number(e.target.value);
      if (!commit(next)) renderEditor();
    };
    if ($("set-target")) $("set-target").onclick = () => { targetMode = !targetMode; renderEditor(); };
    $("delete-actor").onclick = () => { const next = structuredClone(draft); next.actors = next.actors.filter(o => o.id !== selected); selected = null; commit(next); };
  } else $("inspector").innerHTML = `<div class="eyebrow">${editing ? "YOUR EXPERIMENT" : "EXAM IN PROGRESS"}</div><h2>${editing ? "让难题，有迹可循。" : "看看 AI 如何作答。"}</h2><p class="muted">${editing ? "选择一个对象，设置速度、移动终点和出发条件。" : "考题布置已锁定。结束后可以修改关卡，再试一次。"}</p><ol class="instruction-list"><li><b>布置</b><span>四类对象，自由组合</span></li><li><b>触发</b><span>立即出发，或等待 AI 接近</span></li><li><b>观察</b><span>90 秒内，安全到达终点</span></li></ol><div class="exam-note">安全制动介入也会计入成绩。<br>这是考场，不保证每道题都有解。</div>`;
  scene.setDraft(draft, selected, editing);
  $("start-run").disabled = !configured || mode === "running" || mode === "paused";
  $("start-run").textContent = mode === "result" || mode === "error" ? "再次挑战 ↻" : "开始挑战 →";
  $("back-edit").hidden = editing; $("pause-run").hidden = !["running", "paused"].includes(mode);
  $("pause-run").textContent = mode === "paused" ? "继续" : "暂停";
  $("mode-edit").classList.toggle("active", editing); $("mode-run").classList.toggle("active", ["running", "paused"].includes(mode)); $("mode-result").classList.toggle("active", mode === "result");
  $("map-mode").textContent = editing ? "编辑视角 · 时间静止" : mode === "paused" ? "考试已暂停" : mode === "result" ? "考试结束" : mode === "error" ? "连接中断" : "AI 正在应考";
}
function cancelRun() { token++; controller?.abort(); controller = null; pending = false; sim.paused = true; sim.autopilot = false; budget = 0; }
function edit() { cancelRun(); mode = "edit"; targetMode = false; resetSim(); scene.home(); $("result-card").hidden = true; renderEditor(); statusMessage = "编辑考题，准备下一次挑战。"; }
function start() {
  if (!configured || ["running", "paused"].includes(mode)) return;
  cancelRun(); resetSim(); score = new TrialScore(); cost = 0;
  mode = "running"; sim.paused = false; sim.autopilot = true; statusMessage = "等待 AI 的第一步决策…";
  targetMode = false; $("result-card").hidden = true; scene.follow = true; renderEditor();
}
function finish(result) {
  cancelRun(); mode = "result"; scene.home();
  const labels = { arrived: ["成功到达", "AI 完成了你的考题。再加一点难度？"], collision: ["发生碰撞", "这道考题让 AI 遇到了麻烦。"], timeout: ["挑战超时", "90 秒内未到达终点，可以调整关卡后再试。"] };
  const [title, detail] = labels[result.outcome];
  $("result-card").innerHTML = `<span class="eyebrow">EXAM REPORT / 本次成绩</span><h2>${title}</h2><p>${detail}</p><div class="result-grid"><div><strong>${result.time.toFixed(1)}<small>s</small></strong><span>模拟用时</span></div><div><strong>${result.collisions}</strong><span>碰撞次数</span></div><div><strong>${result.interventions}</strong><span>安全介入</span></div></div><p class="result-cost">行驶 ${result.distance.toFixed(0)} m · API $${result.cost.toFixed(6)}</p><div><button id="result-edit">修改考题</button><button id="result-retry" class="primary">原题重试 ↻</button></div>`;
  $("result-card").hidden = false; $("result-edit").onclick = edit; $("result-retry").onclick = start;
  statusMessage = title; renderEditor();
}
async function decide() {
  const epoch = token; pending = true; controller = new AbortController();
  const activeController = controller;
  const timeout = setTimeout(() => activeController.abort(), 12000);
  try {
    statusMessage = "AI 正在观察路况…"; sim.scanScene();
    const planned = await planner.run("plan", sim);
    if (epoch !== token) return;
    sim.lastPlan = planned.plan; sim.lastDecisionState = planned.state;
    const res = await fetch("/api/decide", { method: "POST", headers: { "Content-Type": "application/json" }, signal: activeController.signal, body: JSON.stringify({ state: planned.state }) });
    const response = await res.json();
    if (epoch !== token) return;
    if (!res.ok) throw new Error(response.error || `服务返回 ${res.status}`);
    const controls = decisionControls(planned.state, response);
    if (!controls) throw new Error("AI 返回了无法使用的驾驶决策。");
    cost += response.cost_usd || 0;
    sim.player.maneuver = planned.state.vectors[response.selection.choice];
    sim.player.target = controls.velocity; sim.player.steering = controls.steering;
    budget = .5; statusMessage = `目标 ${(controls.velocity * 3.6).toFixed(0)} km/h · 决策 ${response.latency_ms} ms`;
  } catch (e) {
    if (epoch !== token) return;
    cancelRun(); mode = "error"; statusMessage = e.name === "AbortError" ? "决策超时，请重试。" : e.message;
    notify(`服务中断：${statusMessage} 本次不判定为闯关失败。`); renderEditor();
  } finally { clearTimeout(timeout); if (epoch === token) pending = false; }
}

document.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => selectTool(b.dataset.tool));
$("select-tool").onclick = () => selectTool("select");
$("level-name").onchange = e => { const next = structuredClone(draft); next.name = e.target.value.trim() || "未命名考题"; commit(next); };
$("undo").onclick = () => { if (mode !== "edit" || !history.length) return; draft = history.pop(); selected = null; targetMode = false; save(); resetSim(); renderEditor(); };
$("clear").onclick = () => { selected = null; commit({ ...draft, actors: [] }); };
$("demo").onclick = () => {
  const next = emptyDraft(); next.name = "慢车之后，路口有意外";
  next.actors = [newActor("slow", { x: 3, z: 60 }), newActor("parked", { x: -3, z: -44 }), newActor("bike", { x: -30, z: 3 }), newActor("pedestrian", { x: 9, z: 15 })];
  next.actors[2].trigger = "near"; next.actors[2].distance = 40;
  selected = null; commit(next); scene.home();
};
$("start-run").onclick = start; $("back-edit").onclick = edit;
$("pause-run").onclick = () => { mode = mode === "running" ? "paused" : "running"; sim.paused = mode === "paused"; renderEditor(); };
$("view-home").onclick = () => scene.home();
$("view-follow").onclick = () => { scene.follow = true; if (mode === "edit") notify("编辑对象时建议切回全场视角。"); };
$("export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "jev-driving-challenge.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").onclick = () => $("import-file").click();
$("import-file").onchange = async e => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  if (file.size > 50000) return notify("关卡文件过大，最多 50 KB。");
  try { const next = JSON.parse(await file.text()); if (mode !== "edit") return; selected = null; if (commit(next)) scene.home(); } catch { notify("无法读取关卡，请选择有效的 JSON 文件。"); }
};
document.addEventListener("keydown", e => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || mode !== "edit") return;
  if (e.key === "Escape") selectTool("select");
  if (["1", "2", "3", "4"].includes(e.key)) selectTool(Object.keys(ACTORS)[Number(e.key) - 1]);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("undo").click(); }
  if (e.key === "Delete") $("delete-actor")?.click();
});
document.addEventListener("visibilitychange", () => { if (document.hidden && mode === "running") { mode = "paused"; sim.paused = true; renderEditor(); } });
window.addEventListener("pagehide", () => { cancelRun(); planner.dispose(); });
fetch("/api/status").then(r => r.json()).then(data => {
  configured = !!data.configured && !data.auth_required;
  $("connection").textContent = configured ? "● Jev 已连接" : "○ 未连接";
  statusMessage = configured ? "准备就绪，设计你的第一道考题。" : "请配置服务端 API Key；本版考场需本地运行。";
  renderEditor();
}).catch(() => { $("connection").textContent = "○ 服务不可用"; statusMessage = "无法连接本地服务，仍可编辑和导出关卡。"; });
renderEditor(); if (restoreMessage) notify(restoreMessage);
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, .05); last = now;
  if (mode === "running") {
    if (budget > 0) {
      accumulator += dt;
      while (accumulator >= 1 / 60 && budget > 0 && mode === "running") {
        const step = Math.min(1 / 60, budget); sim.step(step); budget -= step; accumulator -= 1 / 60;
        const result = score.update(sim, cost); if (result) finish(result);
      }
    } else { accumulator = 0; if (!pending) void decide(); }
  }
  $("speed").textContent = Math.round(Math.abs(sim.player.speed) * 3.6);
  $("run-clock").textContent = `${sim.time.toFixed(1).padStart(4, "0")} / 90 s`;
  $("brakes").textContent = score.interventions; $("collisions").textContent = sim.collisions;
  $("run-cost").textContent = `$${cost.toFixed(6)}`; $("drive-status").textContent = statusMessage;
  $("progress-fill").style.width = `${Math.min(100, Math.max(0, sim.player.s / sim.player.route.length * 100))}%`;
  scene.render(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
