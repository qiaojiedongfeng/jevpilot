import { installTrafficInspector } from "./traffic-inspector.js";
import "./challenge.css";
import {
  ACTORS,
  newChallenge,
  makeActor,
  moveActor,
  retargetActor,
  validateChallenge,
  applyChallengeActors,
  ChallengeScore,
} from "./challenge-model.js";
import { ChallengeView } from "./challenge-view.js";
import { pointAt, dist } from "./math.js";
import { Simulation } from "./simulation.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clock = (s) =>
  `${Math.floor(Math.max(0, s) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, s) % 60)
    .toString()
    .padStart(2, "0")}`;
export class Challenge {
  constructor(sim, scene, api) {
    this.sim = sim;
    this.scene = scene;
    this.api = api;
    this.mode = "free";
    this.history = [];
    this.tool = "select";
    this.selected = null;
    this.targetMode = false;
    this.position = 5;
    this.draft = newChallenge(sim.world);
    this.score = null;
    this.startCost = 0;
    this.transition = false;
    this.view = new ChallengeView(scene, {
      pick: (...args) => this.pick(...args),
    });
    document
      .querySelector(".world-picker")
      .insertAdjacentHTML(
        "beforeend",
        '<button id="challenge-open" title="为当前导航任务布置障碍">出题模式</button>',
      );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<section id="challenge-editor" class="glass" hidden aria-label="挑战编辑器">
      <div class="challenge-heading"><span>DRIVING CHALLENGE</span><button id="challenge-close" title="退出挑战，恢复自由驾驶">×</button></div><h2>给这段旅程，加点难度。</h2>
      <input id="challenge-name" maxlength="80" aria-label="挑战名称"><div class="challenge-map"><span id="challenge-map-name"></span><span id="challenge-length"></span></div>
      <label class="challenge-limit">任务时限 <span><input id="challenge-limit" type="number" min="30" max="1800" step="30" aria-label="任务时限（秒）"> 秒</span></label>
      <p class="challenge-note">参考时限已预填，可按试跑调整。编辑和暂停不计时；保留原地图车流。</p>
      <div class="challenge-tools">${Object.entries(ACTORS)
        .map(
          ([kind, a], i) =>
            `<button data-challenge-tool="${kind}" aria-pressed="false"><i style="background:${a.color}"></i>${a.name}<kbd>${i + 1}</kbd></button>`,
        )
        .join("")}</div>
      <div class="challenge-select"><button id="challenge-select">↖ 选择 / 移动</button><button id="challenge-undo">↶ 撤销</button></div>
      <label class="challenge-route">沿导航路线定位 <input id="challenge-route" type="range" min="0" max="100" value="5" aria-label="沿导航路线定位"></label>
      <p id="challenge-hint" class="challenge-note"></p><div id="challenge-objects"></div><div id="challenge-properties"></div>
      <p id="challenge-notice" role="status" aria-live="polite"></p>
      <div class="challenge-files"><button id="challenge-save">导出</button><button id="challenge-load">导入</button><button id="challenge-restore">恢复草稿</button><input id="challenge-file" type="file" accept=".json" hidden></div>
      <button id="challenge-start" class="primary">开始限时挑战 →</button>
    </section>
    <section id="challenge-hud" class="glass" hidden aria-label="限时挑战状态"><span id="challenge-phase">限时挑战</span><strong id="challenge-clock">00:00</strong><span id="challenge-remaining"></span><button id="challenge-pause">暂停</button><button id="challenge-edit">修改考题</button><button id="challenge-inspect">路况诊断</button></section>
    <dialog id="challenge-result"><span class="challenge-eyebrow">CHALLENGE REPORT</span><h2 id="challenge-outcome"></h2><p id="challenge-summary"></p><div id="challenge-result-stats"></div><div class="challenge-result-actions"><button id="challenge-result-edit">修改考题</button><button id="challenge-snapshot">保存卡住现场</button><button id="challenge-retry" class="primary">原题重试</button></div></dialog>`,
    );
    this.inspector = installTrafficInspector(sim, scene, () => this.draft);
    $("challenge-inspect").onclick = () => this.inspector.open();
    $("challenge-snapshot").onclick = () => this.inspector.exportSnapshot();
    $("challenge-open").onclick = () => this.enter();
    $("challenge-close").onclick = () => this.leave();
    $("challenge-start").onclick = () => this.start();
    $("challenge-edit").onclick = () => this.enter();
    $("challenge-result-edit").onclick = () => this.enter();
    $("challenge-retry").onclick = () => this.start();
    $("challenge-result").addEventListener("cancel", (e) => {
      e.preventDefault();
      this.enter();
    });
    $("challenge-pause").onclick = () => {
      if (this.mode === "error") this.resume();
      else this.api.pause();
    };
    $("challenge-name").onchange = (e) =>
      this.change((d) => (d.name = e.target.value.trim() || "未命名挑战"));
    $("challenge-limit").onchange = (e) =>
      this.change((d) => (d.limit = Number(e.target.value)));
    document.querySelectorAll("[data-challenge-tool]").forEach(
      (b) =>
        (b.onclick = () => {
          this.tool = b.dataset.challengeTool;
          this.targetMode = false;
          this.render();
        }),
    );
    $("challenge-select").onclick = () => {
      this.tool = "select";
      this.targetMode = false;
      this.render();
    };
    $("challenge-undo").onclick = () => {
      if (!this.history.length || this.mode !== "edit") return;
      this.draft = this.history.pop();
      this.selected = null;
      this.apply();
      this.persist();
      this.render();
    };
    $("challenge-route").oninput = (e) => {
      this.position = Number(e.target.value);
      this.focus();
    };
    $("challenge-save").onclick = () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(this.draft, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "jev-challenge.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $("challenge-load").onclick = () => $("challenge-file").click();
    $("challenge-file").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 300000) return this.message("关卡文件不能超过 300 KB。");
      try {
        await this.load(JSON.parse(await file.text()));
      } catch (error) {
        this.message(error.message || "无法读取关卡。");
      }
    };
    $("challenge-restore").onclick = async () => {
      try {
        const saved = localStorage.getItem("jevpilot-world-challenge-v2");
        if (!saved) return this.message("还没有保存的草稿。");
        await this.load(JSON.parse(saved));
      } catch (error) {
        this.message(error.message || "草稿不可用。");
      }
    };
    window.addEventListener("keydown", (e) => {
      if (
        this.mode !== "edit" ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
      )
        return;
      if (e.key === "Escape") {
        this.tool = "select";
        this.targetMode = false;
        this.render();
      }
      if (["1", "2", "3", "4"].includes(e.key)) {
        this.tool = Object.keys(ACTORS)[Number(e.key) - 1];
        this.targetMode = false;
        this.render();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        $("challenge-undo").click();
      }
      if (e.key === "Delete") $("challenge-delete")?.click();
    });
  }
  get active() {
    return this.mode !== "free";
  }
  get running() {
    return this.mode === "run";
  }
  message(text) {
    $("challenge-notice").textContent = text;
    this.api.notify(text);
  }
  persist() {
    try {
      localStorage.setItem(
        "jevpilot-world-challenge-v2",
        JSON.stringify(this.draft),
      );
    } catch {
      this.message("本地存储不可用，请导出关卡保存。");
    }
  }
  async enter(useDraft = false) {
    if (!this.api.ready()) return this.message("场景仍在加载，请稍候。");
    if (this.transition) return;
    this.transition = true;
    this.api.pilot(false);
    this.api.invalidate();
    $("challenge-result").close();
    if (
      !useDraft &&
      (this.draft.world.seed !== this.sim.world.seed ||
        this.draft.world.type !== this.sim.world.type)
    ) {
      this.draft = newChallenge(this.sim.world);
      this.history = [];
    }
    this.mode = "edit";
    this.score = null;
    this.selected = null;
    this.targetMode = false;
    try {
      await this.api.reset(this.draft.world.seed, this.draft.world.type, true);
      this.focus();
    } catch (error) {
      this.message(error.message);
    } finally {
      this.transition = false;
      this.render();
    }
  }
  worldReset(preserve) {
    if (!this.active) return;
    if (!preserve) {
      this.draft = newChallenge(this.sim.world);
      this.history = [];
      this.mode = "edit";
      this.selected = null;
      this.score = null;
      $("challenge-result").close();
    }
    applyChallengeActors(this.sim, this.draft);
    this.sim.paused = true;
  }
  afterReset() {
    if (this.mode === "edit") {
      this.focus();
      this.render();
    }
  }
  focus() {
    if (this.mode !== "edit") return;
    this.view.enter(
      pointAt(
        this.sim.world.route.points,
        (this.sim.world.route.length * this.position) / 100,
      ),
    );
  }
  apply() {
    applyChallengeActors(this.sim, this.draft);
    this.view.update(this.draft, this.selected, this.mode === "edit");
  }
  change(edit) {
    if (this.mode !== "edit") return;
    const next = structuredClone(this.draft);
    try {
      edit(next);
      const error = validateChallenge(next, this.sim.world, [
        ...this.sim.traffic,
        ...this.sim.pedestrians,
      ]);
      if (error) throw Error(error);
      this.history.push(structuredClone(this.draft));
      if (this.history.length > 40) this.history.shift();
      this.draft = next;
      this.apply();
      this.persist();
      $("challenge-notice").textContent = "";
    } catch (error) {
      this.message(error.message);
    }
    this.render();
  }
  pick(p, start, dragged) {
    if (this.mode !== "edit" || this.transition) return;
    const nearby = (q) =>
      this.draft.actors
        .filter((a) => dist(a, q) < 4)
        .sort((a, b) => dist(a, q) - dist(b, q))[0];
    if (this.targetMode && this.selected) {
      this.change((d) => {
        const i = d.actors.findIndex((a) => a.id === this.selected);
        d.actors[i] = retargetActor(this.sim.world, d.actors[i], p);
      });
      this.targetMode = false;
      this.render();
      return;
    }
    if (dragged) {
      const a = nearby(start);
      if (!a) return;
      this.selected = a.id;
      this.change((d) => {
        const i = d.actors.findIndex((o) => o.id === a.id);
        d.actors[i] = moveActor(this.sim.world, d.actors[i], p);
      });
      return;
    }
    if (this.tool !== "select") {
      this.change((d) => {
        const a = makeActor(this.sim.world, this.tool, p);
        d.actors.push(a);
        this.selected = a.id;
      });
      this.tool = "select";
    } else this.selected = nearby(p)?.id || null;
    this.render();
  }
  async load(draft) {
    if (this.transition || this.mode !== "edit") return;
    if (
      !draft?.world ||
      !["city", "town", "highway"].includes(draft.world.type) ||
      !Number.isSafeInteger(draft.world.seed) ||
      draft.world.seed < 0 ||
      draft.world.seed > 999999
    )
      throw Error("地图设置无效。");
    const check = new Simulation(draft.world.seed, draft.world.type),
      error = validateChallenge(draft, check.world, [
        ...check.traffic,
        ...check.pedestrians,
      ]);
    if (error) throw Error(error);
    this.draft = structuredClone(draft);
    this.history = [];
    this.persist();
    await this.enter(true);
  }
  async start() {
    if (!this.api.ready()) return this.message("场景仍在加载，请稍候。");
    if (this.transition || this.mode === "run") return;
    if (!this.api.configured())
      return this.message("Jev 尚未连接，请先配置服务端 API Key。");
    // Commit the visible form even when its last field has not fired change yet.
    if (this.mode === "edit") {
      const next = {
        ...this.draft,
        limit: Number($("challenge-limit").value),
        name: $("challenge-name").value.trim() || "未命名挑战",
      };
      const error = validateChallenge(next, this.sim.world, [
        ...this.sim.traffic,
        ...this.sim.pedestrians,
      ]);
      if (error) return this.message(error);
      this.draft = next;
      this.persist();
    }
    this.transition = true;
    this.api.pilot(false);
    this.api.invalidate();
    $("challenge-result").close();
    this.mode = "starting";
    try {
      await this.api.reset(this.draft.world.seed, this.draft.world.type, true);
      this.score = new ChallengeScore(this.draft.limit);
      this.startCost = this.api.cost();
      this.mode = "run";
      this.view.exit();
      this.sim.paused = false;
      this.api.pilot(true);
      this.render();
    } catch (error) {
      this.mode = "edit";
      this.message(error.message);
      this.focus();
    } finally {
      this.transition = false;
      this.render();
    }
  }
  async leave() {
    if (this.transition) return;
    this.transition = true;
    this.api.pilot(false);
    this.api.invalidate();
    this.mode = "free";
    this.view.exit();
    this.render();
    try {
      await this.api.reset(this.sim.world.seed, this.sim.world.type, false);
    } finally {
      this.transition = false;
      this.render();
    }
  }
  step(dt) {
    if (!this.running) return;
    const result = this.score.update(
      this.sim,
      dt,
      Math.max(0, this.api.cost() - this.startCost),
    );
    if (result) this.finish(result);
  }
  finish(result) {
    this.mode = "result";
    this.sim.paused = true;
    this.api.pilot(false);
    this.api.invalidate();
    $("arrival").hidden = true;
    $("paused-overlay").hidden = true;
    $("crash-dialog").close();
    const title = {
      arrived: "挑战成功",
      collision: "碰撞 · 挑战失败",
      timeout: "超时 · 挑战失败",
    }[result.outcome];
    $("challenge-outcome").textContent = title;
    $("challenge-summary").textContent =
      result.outcome === "arrived"
        ? "在时限内到达了原定目的地。"
        : result.outcome === "timeout"
          ? "未能在规定时间内到达目的地。"
          : "车辆发生碰撞，本次挑战结束。";
    $("challenge-result-stats").innerHTML =
      `<div><strong>${result.elapsed.toFixed(1)} s</strong><span>用时 / ${result.limit} s</span></div><div><strong>${result.collisions}</strong><span>碰撞</span></div><div><strong>${result.interventions}</strong><span>安全介入</span></div><p>${Math.round(result.distance)} m · 违规 ${result.violations} · API $${result.cost.toFixed(6)}</p>`;
    $("challenge-result").showModal();
    this.render();
  }
  fail(message) {
    if (!this.running) return;
    this.mode = "error";
    this.sim.paused = true;
    this.api.pilot(false);
    this.api.invalidate();
    this.message(`AI 连接中断，计时已暂停：${message}`);
    this.render();
  }
  resume() {
    if (this.mode !== "error") return;
    this.mode = "run";
    this.sim.paused = false;
    this.api.pilot(true);
    this.render();
  }
  tick() {
    this.inspector?.update();
    if (!this.active) return;
    const elapsed = this.score?.elapsed || 0;
    $("challenge-clock").textContent = clock(this.draft.limit - elapsed);
    $("challenge-remaining").textContent =
      `剩余 ${Math.round(this.sim.navigation().remaining_m)} m`;
    $("challenge-phase").textContent =
      this.mode === "error"
        ? "连接中断 · 计时暂停"
        : this.mode === "result"
          ? "挑战结束"
          : this.sim.paused
            ? "计时暂停"
            : "限时挑战";
    $("challenge-pause").textContent =
      this.mode === "error" ? "恢复 AI" : this.sim.paused ? "继续" : "暂停";
  }
  render() {
    const editing = this.mode === "edit",
      a = this.draft.actors.find((a) => a.id === this.selected);
    document.body.classList.toggle("challenge-editing", editing);
    document.body.classList.toggle("challenge-active", this.active);
    $("challenge-editor").hidden = !editing;
    $("challenge-hud").hidden = !this.active || editing;
    $("challenge-open").disabled = this.transition || this.active;
    $("challenge-pause").hidden = ["result", "starting"].includes(this.mode);
    $("challenge-name").value = this.draft.name;
    $("challenge-limit").value = this.draft.limit;
    $("challenge-map-name").textContent = this.sim.world.theme.name;
    $("challenge-length").textContent =
      `${Math.round(this.sim.world.route.length)} m 导航任务`;
    $("challenge-undo").disabled = !this.history.length;
    $("challenge-start").disabled = this.transition;
    document
      .querySelectorAll("[data-challenge-tool]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.challengeTool === this.tool),
        ),
      );
    $("challenge-hint").textContent = this.targetMode
      ? "点击道路上的终点 · Esc 取消"
      : this.tool !== "select"
        ? `点击场景放置${ACTORS[this.tool].name}`
        : "左键选择 / 拖动对象 · 右键平移 · 滚轮缩放";
    $("challenge-objects").innerHTML = this.draft.actors.length
      ? this.draft.actors
          .map(
            (o, i) =>
              `<button data-challenge-object="${esc(o.id)}" class="${o.id === this.selected ? "selected" : ""}"><i style="background:${ACTORS[o.kind].color}"></i>${ACTORS[o.kind].name} ${i + 1}</button>`,
          )
          .join("")
      : '<p class="challenge-empty">选择一种对象，放进眼前的真实路况。<br>已有车流不会被移除。</p>';
    document.querySelectorAll("[data-challenge-object]").forEach(
      (b) =>
        (b.onclick = () => {
          this.selected = b.dataset.challengeObject;
          this.tool = "select";
          this.targetMode = false;
          const actor = this.draft.actors.find((a) => a.id === this.selected);
          this.scene.editorFocus = { x: actor.x, z: actor.z };
          this.scene.snap = true;
          this.render();
        }),
    );
    $("challenge-properties").innerHTML = !a
      ? ""
      : `<h3>${ACTORS[a.kind].name}设置</h3><p class="challenge-note">起点 ${a.x.toFixed(1)}, ${a.z.toFixed(1)} · 拖动调整</p>${a.kind === "parked" ? '<p class="challenge-note">保持静止，作为占道障碍。</p>' : `<label>速度 <span><input id="challenge-speed" type="number" min="1" max="${a.kind === "pedestrian" ? 8 : 60}" value="${a.speed}"> km/h</span></label><label>出发条件 <select id="challenge-trigger"><option value="immediate" ${a.trigger === "immediate" ? "selected" : ""}>立即出发</option><option value="near" ${a.trigger === "near" ? "selected" : ""}>AI 接近时</option></select></label>${a.trigger === "near" ? `<label>触发距离 <span><input id="challenge-distance" type="number" min="5" max="100" value="${a.distance}"> m</span></label>` : ""}${["slow", "bike"].includes(a.kind) ? `<label>终点行为 <select id="challenge-end"><option value="continue" ${(a.endBehavior ?? "continue") === "continue" ? "selected" : ""}>继续进入车流</option><option value="stop" ${a.endBehavior === "stop" ? "selected" : ""}>到终点停车</option></select></label>` : ""}<button id="challenge-target">↗ ${this.targetMode ? "正在选择终点" : "在地图上设置终点"}</button><p class="challenge-note">终点 ${a.target.x.toFixed(1)}, ${a.target.z.toFixed(1)}<br>${["slow", "bike"].includes(a.kind) && (a.endBehavior ?? "continue") === "continue" ? "沿虚线驶入后续车道，遵守信号和跟车规则。" : "到达终点后停止；作为脚本障碍，不会自行避让。"}</p>`}<button id="challenge-delete">删除对象</button>`;
    for (const [id, key] of [
      ["challenge-speed", "speed"],
      ["challenge-trigger", "trigger"],
      ["challenge-end", "endBehavior"],
      ["challenge-distance", "distance"],
    ])
      if ($(id))
        $(id).onchange = (e) =>
          this.change(
            (d) =>
              (d.actors.find((o) => o.id === this.selected)[key] = [
                "trigger",
                "endBehavior",
              ].includes(key)
                ? e.target.value
                : Number(e.target.value)),
          );
    if ($("challenge-target"))
      $("challenge-target").onclick = () => {
        this.targetMode = !this.targetMode;
        this.render();
      };
    if ($("challenge-delete"))
      $("challenge-delete").onclick = () =>
        this.change((d) => {
          d.actors = d.actors.filter((o) => o.id !== this.selected);
          this.selected = null;
        });
    this.view.update(this.draft, this.selected, editing);
    this.tick();
  }
}
