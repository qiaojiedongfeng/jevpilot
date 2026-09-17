import "./style.css";
import {
  createIcons,
  Route,
  Braces,
  Shuffle,
  Video,
  Pause,
  Play,
  SlidersHorizontal,
  Map,
  Maximize,
  Minimize,
  Sparkles,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  ArrowUpRight,
  X,
  Download,
  RotateCcw,
  Keyboard,
  CircleHelp,
  ShieldCheck,
} from "lucide";
import { Simulation } from "./simulation.js";
import { DriveScene } from "./scene.js";
import { THEMES } from "./world.js";
import { VECTOR_NAMES } from "./planning.js";
import { clamp } from "./math.js";
const icons = {
  Route,
  Braces,
  Shuffle,
  Video,
  Pause,
  Play,
  SlidersHorizontal,
  Map,
  Maximize,
  Minimize,
  Sparkles,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  ArrowUpRight,
  X,
  Download,
  RotateCcw,
  Keyboard,
  CircleHelp,
  ShieldCheck,
};
const icon = (name) => `<i data-lucide="${name}"></i>`,
  $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search),
  aliases = { suburb: "town", country: "highway" },
  requested = params.get("world") || "city",
  type = aliases[requested] || requested;
const sim = new Simulation(
  Number(params.get("seed")) || Math.floor(Math.random() * 999999),
  THEMES[type] ? type : "city",
);
let configured = false,
  busy = false,
  generation = 0,
  lastDecision = null,
  lastInput = null,
  lastApplied = 0,
  nextDecision = 0,
  errors = 0,
  inspectorTab = "request",
  inspectFrozen = false,
  manualThrottle = 0,
  manualSteering = 0,
  uiTime = 0,
  lastNow = performance.now(),
  toastTimer,
  crashHandled = false;
const keys = new Set(),
  tally = {
    cost: 0,
    calls: 0,
    input: 0,
    output: 0,
    latencies: [],
    intervals: [],
  };
$("app").innerHTML = `
<main class="drive-area" aria-label="3D driving simulator"><canvas id="world-canvas" aria-label="Interactive three-dimensional driving world"></canvas><div id="vector-labels" aria-label="Jev motion vector probabilities"></div></main>
<header class="topbar"><a href="/" class="brand"><span class="brand-mark">${icon("route")}</span><b>Jevpilot</b></a><div class="world-picker glass"><select id="world-select" aria-label="World environment"><option value="city">Skyline City</option><option value="town">Small town</option><option value="highway">Interstate 08</option></select><span class="seed" id="seed-label"></span><button id="new-world" title="Generate a new world" aria-label="Generate a new world">${icon("shuffle")}</button></div><div class="top-tools glass"><button id="camera" title="Change camera · C" aria-label="Change camera">${icon("video")}<span id="camera-name">Chase</span></button><span class="divider"></span><button id="scene-json" aria-label="Inspect live JSON" title="Inspect live JSON">${icon("braces")}<span>JSON</span></button><button id="fullscreen" aria-label="Enter fullscreen" title="Fullscreen">${icon("maximize")}</button></div></header>
<div class="navigation-card glass"><span id="turn-icon">${icon("arrow-up")}</span><div><strong id="next-maneuver">Continue straight</strong><span id="turn-distance"></span></div><span class="nav-divider"></span><span id="remaining"></span><button id="map-toggle" aria-label="Toggle route map" aria-pressed="true" title="Route map">${icon("map")}</button></div>
<div id="minimap" class="minimap glass"><canvas id="map-canvas" width="380" height="310" aria-label="Track-up road map with traffic and destination"></canvas></div>
<div id="paused-overlay" hidden><div class="glass"><span>${icon("pause")} Paused</span><button id="resume" class="primary">Resume driving</button></div></div>
<div id="arrival" class="arrival glass" hidden><span class="arrival-mark">${icon("flag")}</span><span class="eyebrow">DESTINATION REACHED</span><h1>You made it.</h1><p id="arrival-summary"></p><button id="next-trip" class="primary">Next drive ${icon("arrow-up-right")}</button><button id="keep-driving" class="subtle">Keep exploring</button></div>
<div class="bottom-hud"><div class="driver-dock glass"><div class="speed-cluster"><div><strong id="speed">0</strong><span>km/h</span></div><span class="speed-limit"><small>LIMIT</small><b id="speed-limit">50</b></span></div><span class="dock-divider"></span><button id="autopilot" class="pilot-button" role="switch" aria-checked="false" aria-label="Jev autopilot">${icon("sparkles")}<span id="pilot-label">Engage Jev</span><kbd>J</kbd></button><div id="decision-status"><span id="pilot-state">Free play</span><span id="context-message">WASD to drive · Space to brake</span></div><span class="dock-divider"></span><button id="controls-toggle" aria-label="Driving controls" title="Driving controls">${icon("sliders-horizontal")}</button><button id="pause" aria-label="Pause simulation" title="Pause · P">${icon("pause")}</button></div><div class="footer-line"><span id="connection"><i class="dot"></i>Connecting Jev</span><span id="vector-caption">3-second planning horizon</span><span class="cost-total" title="Estimate from reported input tokens × $0.042 per million; output free.">Session <strong id="cost">$0.000000</strong></span></div></div>
<aside id="controls-panel" class="controls-panel glass" hidden><div class="panel-heading"><span>DRIVING CONTROLS</span><button id="close-controls" aria-label="Close driving controls">${icon("x")}</button></div><label>Steering <output id="steering-output">0.00</output></label><input id="steering" type="range" min="-1" max="1" step=".01" value="0" aria-label="Steering axis"/><div class="range-labels"><span>LEFT</span><span>RIGHT</span></div><label><span id="pedal-label">Accelerator</span><output id="velocity-output">Released</output></label><input id="velocity" type="range" min="-1" max="1" step=".01" value="0" aria-label="Accelerator pedal"/><div class="range-labels"><span id="pedal-min">BRAKE / REVERSE</span><span id="pedal-max">ACCELERATE</span></div><label class="check-label"><span>${icon("shield-check")} Safety brake</span><input id="safety" type="checkbox" checked/></label><label class="check-label"><span>Show selected path</span><input id="show-vectors" type="checkbox" checked/></label><div class="control-actions"><button id="reset-car" class="secondary">${icon("rotate-ccw")} Restart trip</button><button id="help" aria-label="Keyboard shortcuts">${icon("keyboard")}</button></div><div class="session-stats"><span><b id="calls">0</b> calls</span><span><b id="tokens">0</b> tokens</span><span><b id="latency">—</b> ms</span></div></aside>
<dialog id="crash-dialog" aria-labelledby="crash-title" aria-describedby="crash-description"><span class="crash-symbol">${icon("x")}</span><span class="eyebrow">DRIVE ENDED</span><h1 id="crash-title">Game over.</h1><p id="crash-description"></p><div class="crash-stats"><div><strong id="crash-speed"></strong><span>km/h at impact</span></div><div><strong id="crash-distance"></strong><span>meters driven</span></div></div><button id="retry-drive" class="primary">${icon("rotate-ccw")} Restart drive</button><button id="crash-new-world" class="secondary">Try a new world ${icon("arrow-up-right")}</button></dialog>
<div id="toast" role="status" hidden></div>
<dialog id="json-dialog"><div class="json-header"><div>${icon("braces")}<strong>Under the hood</strong><span id="json-live">LIVE · 4 Hz</span></div><button id="close-json" aria-label="Close JSON inspector">${icon("x")}</button></div><div class="json-toolbar"><div class="json-tabs"><button data-tab="request" class="active">Jev input</button><button data-tab="sensor">Perception</button><button data-tab="world">Full world</button><button data-tab="decision">Response</button></div><div class="json-actions"><button id="freeze-json">Freeze</button><button id="download-json">${icon("download")} Download</button></div></div><p id="json-description">Compact control state sent to Jev. Full perception and world geometry stay in the simulator.</p><pre id="json-content"></pre></dialog>
<dialog id="help-dialog"><button id="close-help" class="dialog-close" aria-label="Close help">${icon("x")}</button><span class="eyebrow">YOUR NEXT DRIVE</span><h2>Take the wheel.</h2><div class="help-keys"><span><kbd>W / ↑</kbd> Hold accelerator</span><span><kbd>S / ↓</kbd> Brake / reverse</span><span><kbd>A / D</kbd> Steer</span><span><kbd>SPACE</kbd> Brake</span><span><kbd>J</kbd> Jev autopilot</span><span><kbd>C</kbd> Camera</span><span><kbd>P</kbd> Pause</span></div><p>Drag the scene to orbit in Chase or Bird’s eye; drag to look around in Driver view. Scroll to zoom outside; double-click to recenter. Tap A/D for small corrections; hold for a sharper turn and release to recenter. Hold W to accelerate; release to coast with drag. S brakes, then reverses once stopped. Space applies the brake. Autopilot sets target speed directly.</p><p>The bright blue line is Jev's selected three-second plan. All candidate probabilities are available in the JSON inspector. The optional safety brake can reduce speed for a missed hazard; interventions are shown beside the autopilot button.</p><p class="asset-credits">Vehicle: <a href="https://sketchfab.com/3d-models/tesla-model-y-2021-c0a86cac582d4b33aba0fb1b1912d970" target="_blank" rel="noreferrer">Tesla Model Y 2021</a> by 763468712, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Geometry adapted by Tina 3D Tesla; optimized, re-materialed, and wheel-rigged for Jevpilot. Tree, shrub, streetlight, surface textures and sky: <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a>, CC0.</p><p>Driving keys take back control. Use the JSON button for live inputs, full world state, probabilities, and session telemetry.</p></dialog>`;
createIcons({ icons });
const scene = new DriveScene($("world-canvas"), sim, $("vector-labels")),
  map = $("map-canvas").getContext("2d");
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4200);
}
function refreshWorld() {
  const w = sim.world;
  $("world-select").value = w.type;
  $("seed-label").textContent = `#${w.seed}`;
  $("speed-limit").textContent = Math.round(w.theme.limit * 3.6);
  $("arrival").hidden = true;
  $("safety").checked = sim.safety;
}
function syncPilot() {
  const on = sim.autopilot;
  $("autopilot").setAttribute("aria-checked", String(on));
  $("pilot-label").textContent = on ? "Jev engaged" : "Engage Jev";
  $("steering").disabled = on || !!sim.crash;
  $("velocity").disabled = on || !!sim.crash;
  $("autopilot").disabled = !!sim.crash;
  $("pedal-label").textContent = on
    ? "Target velocity"
    : "Accelerator · hold to apply";
  $("velocity").min = on ? -3 : -1;
  $("velocity").max = on ? 30 : 1;
  $("velocity").step = on ? 0.5 : 0.01;
  $("velocity").setAttribute(
    "aria-label",
    on ? "Velocity axis" : "Accelerator pedal",
  );
  $("pedal-min").textContent = on ? "REVERSE" : "BRAKE / REVERSE";
  $("pedal-max").textContent = on ? "108 KM/H" : "ACCELERATE";
  document.body.classList.toggle("piloting", on);
}
function setPilot(on) {
  if (on && !configured) {
    toast("Jev is not connected. Check the API key on the server.");
    return;
  }
  if (sim.crash || (on && sim.complete)) return;
  sim.autopilot = on;
  if (on) sim.freeExplore = false;
  generation++;
  lastApplied = 0;
  nextDecision = 0;
  errors = 0;
  manualThrottle = manualSteering = 0;
  sim.player.target = 0;
  sim.player.steering = 0;
  sim.player.steeringProgress = 0;
  scene.vectors.clear();
  syncPilot();
}
function resetWorld(seed = sim.world.seed, type = sim.world.type) {
  generation++;
  crashHandled = false;
  $("crash-dialog").close();
  document.body.classList.remove("crashed");
  keys.clear();
  sim.reset(seed, type);
  manualThrottle = manualSteering = 0;
  lastApplied = 0;
  lastDecision = null;
  lastInput = null;
  scene.build();
  scene.vectors.enabled = $("show-vectors").checked;
  refreshWorld();
  syncPilot();
  $("paused-overlay").hidden = true;
  $("pause").innerHTML = icon("pause");
  createIcons({ icons });
}
function changeCamera() {
  const modes = ["chase", "hood", "map"];
  scene.mode = modes[(modes.indexOf(scene.mode) + 1) % 3];
  scene.snap = true;
  $("camera-name").textContent = {
    chase: "Chase",
    hood: "Driver",
    map: "Bird’s eye",
  }[scene.mode];
}
function togglePause() {
  if (sim.crash) return;
  sim.paused = !sim.paused;
  generation++;
  lastApplied = 0;
  nextDecision = 0;
  $("paused-overlay").hidden = !sim.paused;
  $("pause").innerHTML = icon(sim.paused ? "play" : "pause");
  $("pause").setAttribute(
    "aria-label",
    sim.paused ? "Resume simulation" : "Pause simulation",
  );
  createIcons({ icons });
}
$("autopilot").onclick = () => setPilot(!sim.autopilot);
$("new-world").onclick = () => resetWorld(Math.floor(Math.random() * 999999));
$("world-select").onchange = (e) =>
  resetWorld(Math.floor(Math.random() * 999999), e.target.value);
$("reset-car").onclick = () => resetWorld();
$("retry-drive").onclick = () => {
  resetWorld();
  $("autopilot").focus();
};
$("crash-new-world").onclick = () =>
  resetWorld(Math.floor(Math.random() * 999999));
$("crash-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("camera").onclick = changeCamera;
$("pause").onclick = togglePause;
$("resume").onclick = togglePause;
$("next-trip").onclick = () => resetWorld(Math.floor(Math.random() * 999999));
$("keep-driving").onclick = () => {
  sim.complete = false;
  sim.freeExplore = true;
  $("arrival").hidden = true;
};
$("controls-toggle").onclick = () =>
  ($("controls-panel").hidden = !$("controls-panel").hidden);
$("close-controls").onclick = () => ($("controls-panel").hidden = true);
$("map-toggle").onclick = () => {
  $("minimap").hidden = !$("minimap").hidden;
  $("map-toggle").setAttribute("aria-pressed", String(!$("minimap").hidden));
  drawMap();
};
$("steering").oninput = (e) => (manualSteering = Number(e.target.value));
$("velocity").oninput = (e) => (manualThrottle = Number(e.target.value));
function releasePedal() {
  manualThrottle = 0;
  if (!sim.autopilot) {
    sim.pedals.throttle = 0;
    $("velocity").value = 0;
  }
}
$("velocity").addEventListener("pointerdown", (e) =>
  $("velocity").setPointerCapture(e.pointerId),
);
$("velocity").addEventListener("pointerup", releasePedal);
$("velocity").addEventListener("pointercancel", releasePedal);
$("velocity").addEventListener("keyup", releasePedal);
$("velocity").addEventListener("blur", releasePedal);
$("safety").onchange = (e) => (sim.safety = e.target.checked);
$("show-vectors").onchange = (e) => (scene.vectors.enabled = e.target.checked);
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("Use your browser’s fullscreen shortcut.");
  }
};
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").innerHTML = icon(
    document.fullscreenElement ? "minimize" : "maximize",
  );
  $("fullscreen").setAttribute(
    "aria-label",
    document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen",
  );
  createIcons({ icons });
});
window.addEventListener("keydown", (e) => {
  if (sim.crash) return;
  if ($("json-dialog").open || $("help-dialog").open) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  const driving = [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ];
  if (driving.includes(e.code)) {
    e.preventDefault();
    keys.add(e.code);
    if (sim.autopilot) setPilot(false);
  }
  if (e.repeat) return;
  if (e.code === "KeyJ") setPilot(!sim.autopilot);
  if (e.code === "KeyC") changeCamera();
  if (e.code === "KeyP") togglePause();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  manualThrottle = manualSteering = 0;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    generation++;
    keys.clear();
    sim.player.target = 0;
    lastApplied = 0;
    nextDecision = 0;
  }
});
$("help").onclick = () => $("help-dialog").showModal();
$("close-help").onclick = () => $("help-dialog").close();
$("scene-json").onclick = () => {
  $("json-dialog").showModal();
  renderJSON();
};
$("close-json").onclick = () => $("json-dialog").close();
document.querySelectorAll("[data-tab]").forEach(
  (button) =>
    (button.onclick = () => {
      inspectorTab = button.dataset.tab;
      inspectFrozen = false;
      syncFreeze();
      document
        .querySelectorAll("[data-tab]")
        .forEach((b) => b.classList.toggle("active", b === button));
      $("json-description").textContent = {
        request:
          "Compact control state sent to Jev. Full perception and world geometry stay in the simulator.",
        sensor:
          "Complete forward perception, route guidance, geometry predictions and vehicle telemetry.",
        world:
          "All roads, buildings, vehicles, pedestrians, controls, and the current route.",
        decision:
          "Actual Jev probabilities and token usage. Costs accumulate across every completed call.",
      }[inspectorTab];
      renderJSON();
    }),
);
function syncFreeze() {
  $("freeze-json").textContent = inspectFrozen ? "Resume" : "Freeze";
  $("json-live").textContent = inspectFrozen ? "FROZEN" : "LIVE · 4 Hz";
}
$("freeze-json").onclick = () => {
  inspectFrozen = !inspectFrozen;
  syncFreeze();
};
function inspectData() {
  if (inspectorTab === "request") return sim.decisionState();
  if (inspectorTab === "decision")
    return {
      response: lastDecision,
      last_submitted_input: lastInput,
      session: {
        ...tally,
        average_input_tokens: tally.calls
          ? Math.round(tally.input / tally.calls)
          : 0,
      },
    };
  return sim.observation(inspectorTab === "world");
}
$("download-json").onclick = () => {
  const text = inspectFrozen
      ? $("json-content").textContent
      : JSON.stringify(inspectData(), null, 2),
    a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = `jev-${inspectorTab}-${sim.world.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
function renderJSON() {
  if (inspectFrozen) return;
  const text = JSON.stringify(inspectData(), null, 2);
  $("json-content").innerHTML = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(?:\\.|[^"\\])*"\s*:?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
      (m) =>
        `<span class="${m.startsWith('"') ? (m.endsWith(":") ? "json-key" : "json-string") : /true|false|null/.test(m) ? "json-bool" : "json-number"}">${m}</span>`,
    );
}
async function decide() {
  if (
    busy ||
    !sim.autopilot ||
    sim.paused ||
    document.hidden ||
    sim.complete ||
    sim.crash ||
    performance.now() < nextDecision
  )
    return;
  busy = true;
  const token = generation,
    state = sim.decisionState(),
    started = performance.now();
  try {
    const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
        signal: AbortSignal.timeout(12000),
      }),
      data = await res.json();
    if (!res.ok) throw Error(data.error || "Jev request failed");
    tally.calls++;
    tally.cost += data.cost_usd;
    tally.input += data.usage.input_tokens;
    tally.output += data.usage.output_tokens;
    tally.latencies.push(data.latency_ms);
    if (tally.latencies.length > 25) tally.latencies.shift();
    if (token !== generation || !sim.autopilot || sim.paused || sim.crash)
      return;
    const now = performance.now();
    if (lastApplied) tally.intervals.push(now - lastApplied);
    if (tally.intervals.length > 20) tally.intervals.shift();
    lastDecision = { ...data, received_at_simulation_s: sim.time };
    lastInput = state;
    lastApplied = now;
    errors = 0;
    sim.player.steering = data.controls.steering;
    sim.player.target = data.controls.velocity;
    scene.vectors.setAnswer(data.answers.vector);
    nextDecision = started + 125; // Up to 8 Hz, one request in flight.
  } catch (error) {
    if (token === generation) {
      sim.player.target = 0;
      scene.vectors.clear();
      errors++;
      nextDecision = performance.now() + Math.min(15000, 1000 * 2 ** errors);
      toast(error.message);
      sim.event(error.message, "error");
      if (errors >= 3) {
        setPilot(false);
        toast(
          "Jev paused after three failed requests. Toggle autopilot to reconnect.",
        );
      }
    }
  } finally {
    busy = false;
  }
}
function drawMap() {
  const w = sim.world,
    v = sim.player,
    W = 380,
    H = 310;
  const scale = w.type === "highway" ? 0.85 : 1.35;
  const pt = (p) => [(p.x - v.x) * scale, (p.z - v.z) * scale];
  map.clearRect(0, 0, W, H);
  map.fillStyle = "#f3f4f6";
  map.fillRect(0, 0, W, H);
  map.save();
  map.translate(W / 2, H * 0.65);
  map.rotate(-v.heading);
  map.lineCap = "round";
  map.strokeStyle = "#d0d3d8";
  if (w.roadSamples) {
    map.lineWidth = 25 * scale;
    map.beginPath();
    w.roadSamples.forEach((p, i) =>
      i ? map.lineTo(...pt(p)) : map.moveTo(...pt(p)),
    );
    map.stroke();
  } else
    for (const e of w.edges) {
      map.lineWidth = e.width * scale;
      map.beginPath();
      map.moveTo(...pt(w.byId[e.a]));
      map.lineTo(...pt(w.byId[e.b]));
      map.stroke();
    }
  map.strokeStyle = "#3e6ae1";
  map.lineWidth = 4;
  map.beginPath();
  w.route.points.forEach((p, i) =>
    i ? map.lineTo(...pt(p)) : map.moveTo(...pt(p)),
  );
  map.stroke();
  for (const car of sim.traffic) {
    map.fillStyle = car.type === "motorcycle" ? "#e82127" : "#81858d";
    map.beginPath();
    map.arc(...pt(car), 4, 0, Math.PI * 2);
    map.fill();
  }
  const end = pt(w.route.points.at(-1));
  map.fillStyle = "#171a20";
  map.fillRect(end[0] - 3, end[1] - 6, 8, 7);
  map.fillRect(end[0] - 3, end[1] - 6, 1, 14);
  map.restore();
  // The map turns beneath an always-up vehicle marker, with more room ahead.
  map.save();
  map.translate(W / 2, H * 0.65);
  map.fillStyle = "#ffffff";
  map.beginPath();
  map.arc(0, 0, 13, 0, Math.PI * 2);
  map.fill();
  map.fillStyle = "#171a20";
  map.beginPath();
  map.moveTo(0, -10);
  map.lineTo(7, 7);
  map.lineTo(0, 4);
  map.lineTo(-7, 7);
  map.closePath();
  map.fill();
  map.restore();
}

function updateUI() {
  const v = sim.player,
    nav = sim.navigation();
  $("speed").textContent = Math.round(Math.abs(v.speed) * 3.6);
  $("remaining").textContent =
    nav.remaining_m >= 1000
      ? `${(nav.remaining_m / 1000).toFixed(1)} km`
      : `${Math.round(nav.remaining_m)} m`;
  $("next-maneuver").textContent =
    nav.next_turn === "arrive"
      ? sim.world.type === "highway"
        ? "Follow Interstate 08"
        : "Destination ahead"
      : nav.next_turn === "straight"
        ? "Continue straight"
        : `Turn ${nav.next_turn}`;
  $("turn-distance").textContent =
    nav.next_turn === "arrive"
      ? "to your destination"
      : `in ${Math.round(nav.turn_distance_m)} m`;
  const turnIcon = {
    left: "corner-up-left",
    right: "corner-up-right",
    straight: "arrow-up",
    arrive: "flag",
  }[nav.next_turn];
  if ($("turn-icon").dataset.icon !== turnIcon) {
    $("turn-icon").innerHTML = icon(turnIcon);
    $("turn-icon").dataset.icon = turnIcon;
    createIcons({ icons });
  }
  const answer = lastDecision?.answers.vector,
    stale = !lastApplied || performance.now() - lastApplied > 1800;
  $("pilot-state").textContent = sim.autopilot
    ? stale
      ? "Reading the road…"
      : `${VECTOR_NAMES[answer.choice]} · ${Math.round(answer.probabilities[answer.choice] * 100)}%`
    : sim.crash
      ? "Drive ended"
      : "Free play";
  $("context-message").textContent = sim.autopilot
    ? sim.brakeReason
      ? `Safety brake · ${sim.brakeReason}`
      : stale
        ? "Waiting for a fresh decision"
        : `${Math.round(v.target * 3.6)} km/h target · ${lastDecision.latency_ms} ms`
    : "WASD to drive · Space to brake";
  if (sim.autopilot && !stale && v.speed < 0.5 && v.target < 0.5) {
    const rule = sim.rule(v);
    $("context-message").textContent = rule.mustStop
      ? `${rule.reason}${rule.color === "green" ? " · light is green" : ""}`
      : nav.remaining_m < 4
        ? "Stopping at destination"
        : "Road clear · replanning";
  }
  if (nav.route_offset_m > 7)
    $("context-message").textContent =
      "Off route · return to the line or restart";
  const hz = tally.intervals.length
    ? 1000 /
      (tally.intervals.reduce((a, b) => a + b, 0) / tally.intervals.length)
    : 0;
  $("vector-caption").textContent =
    sim.autopilot && !stale
      ? `3s plans · ${hz.toFixed(1)} Hz`
      : "3-second planning horizon";
  $("cost").textContent = `$${tally.cost.toFixed(6)}`;
  $("calls").textContent = tally.calls;
  $("tokens").textContent = tally.input.toLocaleString();
  $("latency").textContent = tally.latencies.length
    ? Math.round(
        tally.latencies.reduce((a, b) => a + b, 0) / tally.latencies.length,
      )
    : "—";
  $("steering-output").textContent = v.steering.toFixed(2);
  $("velocity-output").textContent = sim.autopilot
    ? `${Math.round(v.target * 3.6)} km/h`
    : sim.pedals.brake
      ? "Braking"
      : sim.pedals.throttle
        ? `${Math.round(Math.abs(sim.pedals.throttle) * 100)}%${sim.pedals.throttle < 0 ? " brake / reverse" : " throttle"}`
        : "Released · coasting";
  $("steering").value = sim.autopilot ? v.steering : sim.steeringInput;
  $("velocity").value = sim.autopilot ? v.target : sim.pedals.throttle;
  if (sim.complete && !sim.freeExplore) {
    $("arrival").hidden = false;
    $("arrival-summary").textContent =
      `${Math.round(sim.distance)} m driven · ${sim.collisions} contacts · ${sim.violations} violations`;
    if ($("autopilot").getAttribute("aria-checked") === "true") {
      generation++;
      syncPilot();
    }
  }
  if ($("json-dialog").open) renderJSON();
}
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastNow) / 1000, 0.2);
  lastNow = now;
  if (document.hidden) return;
  if (!sim.paused && !sim.crash) {
    if (!sim.autopilot) {
      let steer = manualSteering;
      const left = keys.has("KeyA") || keys.has("ArrowLeft");
      const right = keys.has("KeyD") || keys.has("ArrowRight");
      if (left || right) steer = Number(right) - Number(left);
      let throttle = manualThrottle;
      if (keys.has("KeyW") || keys.has("ArrowUp")) throttle = 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) throttle = -1;
      sim.pedals.throttle = throttle;
      sim.pedals.brake = keys.has("Space") ? 1 : 0;
      sim.steeringInput = steer;
      sim.player.target = 0;
    } else if (!lastApplied || now - lastApplied > 1800) sim.player.target = 0;
    // Preserve real elapsed time on slower displays using bounded physics substeps.
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps; i++) sim.step(dt / steps);
  }
  if (sim.crash && !crashHandled) {
    crashHandled = true;
    generation++;
    manualThrottle = manualSteering = 0;
    keys.clear();
    scene.vectors.clear();
    syncPilot();
    $("controls-panel").hidden = true;
    $("arrival").hidden = true;
    $("paused-overlay").hidden = true;
    $("json-dialog").close();
    $("help-dialog").close();
    document.body.classList.add("crashed");
    $("crash-description").textContent = {
      building: "You collided with a building.",
      pedestrian: "You struck a pedestrian.",
      car: "You collided with another car.",
      motorcycle: "You collided with a motorcycle.",
    }[sim.crash.type];
    $("crash-speed").textContent = Math.round(sim.crash.impact_speed_mps * 3.6);
    $("crash-distance").textContent = Math.round(sim.distance);
    $("crash-dialog").showModal();
  }
  scene.render(dt);
  if (!$("minimap").hidden) drawMap();
  uiTime += dt;
  if (uiTime > 0.2) {
    uiTime = 0;
    updateUI();
  }
}
refreshWorld();
syncPilot();
updateUI();
requestAnimationFrame(animate);
setInterval(decide, 25);
fetch("/api/status")
  .then((r) => r.json())
  .then((data) => {
    configured = data.configured;
    $("connection").innerHTML =
      `<i class="dot ${configured ? "connected" : ""}"></i>${configured ? "Jev connected" : "API key needed"}`;
  })
  .catch(() => ($("connection").textContent = "Server unavailable"));

export { sim, scene };
