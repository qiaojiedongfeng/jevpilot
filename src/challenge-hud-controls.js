import { clamp } from "./math.js";

export class ChallengeHudControls {
  constructor(panel) {
    this.panel = panel;
    this.position = null;
    this.events = new AbortController();
    const on = (target, type, handler) =>
      target.addEventListener(type, handler, { signal: this.events.signal });
    const handle = panel.querySelector("#challenge-drag");
    let drag = null;
    on(handle, "pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      const { left, top } = panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("is-moving");
    });
    on(handle, "pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      this.move(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    });
    const finish = (event) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      panel.classList.remove("is-moving");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(handle, type, finish);
    on(handle, "keydown", (event) => {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect(), step = event.shiftKey ? 1 : 10;
      this.move(rect.left + direction[0] * step, rect.top + direction[1] * step);
    });
    on(panel.querySelector("#challenge-position-reset"), "click", () => {
      this.position = null;
      this.layout();
    });
    on(window, "resize", () => this.layout());
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(panel);
    this.observer.observe(document.querySelector(".navigation-hud"));
  }

  move(left, top) {
    this.position = { left, top };
    this.layout();
  }

  layout() {
    if (this.panel.hidden) return;
    const rect = this.panel.getBoundingClientRect();
    const navigation = document.querySelector(".navigation-hud").getBoundingClientRect();
    let left = this.position?.left ?? innerWidth - rect.width - (innerWidth <= 800 ? 10 : 22);
    let top = this.position?.top ?? navigation.bottom + 12;
    // On short screens, use the space beside navigation instead of covering it.
    if (!this.position && top + rect.height > innerHeight - 8) {
      left = navigation.left - rect.width - 12;
      top = navigation.top;
    }
    left = clamp(left, 8, Math.max(8, innerWidth - rect.width - 8));
    top = clamp(top, 8, Math.max(8, innerHeight - rect.height - 8));
    if (this.position) this.position = { left, top };
    Object.assign(this.panel.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
  }

  dispose() {
    this.events.abort();
    this.observer.disconnect();
  }
}
