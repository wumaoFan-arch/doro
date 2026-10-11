// Live layer: everything that turns, slides or follows a thread is redrawn from stateOf(A).
// Runs after the kit, the model and `P` / `GEO`.
const RAD = Math.PI / 180;
const stage = document.querySelector(".iso-stage");
const svgEl = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const slots = {};
svgEl.querySelectorAll("[data-slot]").forEach((node) => (slots[node.dataset.slot] = node));
const parts = {};
svgEl.querySelectorAll("[data-part]").forEach((node) => (parts[node.dataset.part] = node));
const { SHAFT, WHEEL, C } = GEO;
const N = M.needle;
const smooth01 = (lo, hi, v) => ease((v - lo) / (hi - lo));
const facing2 = (a) => Math.cos(a) * towardViewer(P)[0] + Math.sin(a) * towardViewer(P)[1];
const onX = (x, a, r) => [x, SHAFT.y + r * Math.cos(a), SHAFT.z + r * Math.sin(a)];
const pts = (list) => pathOf(list.map((p) => iso(p, P)));
const red = (d) => lineSvg(d, { tone: "red", className: "sw-thread" });
const blue = (d) => lineSvg(d, { tone: "blue", className: "sw-thread" });
const around = (c, r, deg, z) => [c[0] + r * Math.cos(deg * RAD), c[1] + r * Math.sin(deg * RAD), z];
const EXIT = around(C, M.caseR, M.exitAt, M.caseTop + 0.3);

// Teeth and knurls fade toward the limb instead of stopping.
function ribs(list, tone = "lo") {
  return fadedSvg(list.filter((r) => r.alpha > 0.02), { tone });
}

function lowerGear(shaft) {
  const list = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 - shaft;
    const f = depthOf([0, Math.cos(a), Math.sin(a)], P);
    list.push({ d: pts([onX(C[0] - 2.5, a, 8), onX(C[0] + 2.5, a, 8)]), alpha: smooth01(0.02, 0.35, f) });
  }
  return ribs(list);
}
function hookGear(turn) {
  const list = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + turn;
    const f = facing2(a);
    const x = C[0] + 4 * Math.cos(a), y = C[1] + 4 * Math.sin(a);
    list.push({ d: pts([[x, y, -26.4], [x, y, -21.6]]), alpha: smooth01(0.02, 0.35, f) });
  }
  return ribs(list);
}
function wheel(shaft) {
  const out = [];
  const list = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - shaft;
    const f = depthOf([0, Math.cos(a), Math.sin(a)], P);
    list.push({ d: pts([onX(WHEEL.x0, a, WHEEL.r), onX(WHEEL.x1, a, WHEEL.r)]), alpha: smooth01(0.02, 0.3, f) });
  }
  out.push(ribs(list));
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3 - shaft;
    const c = onX(WHEEL.x1, a, 9.2);
    const d = sideRing(c, 2.7, "x", P, 28);
    out.push(`<path class="iso-shade" data-shade="0" d="${d}"/>`, lineSvg(d, { tone: "lo" }));
  }
  const a = Math.PI / 2 + Math.PI / 3 - shaft;
  out.push(lineSvg(pts([onX(WHEEL.x1, a, 4.6), onX(WHEEL.x1, a, 13.6)]), { tone: "hi" }));
  return out.join("");
}
function hookTop(psi) {
  const dots = [120, 240].map((d) => iso(around(C, 11.8, psi + d, -6.6), P));
  return dotsSvg(dots, { size: 0.45 });
}
function beak(psi) {
  const ring = [around(C, 11.05, psi, 0)];
  for (let d = 9; d <= 42; d += 3) ring.push(around(C, 13.1, psi + d, 0));
  for (let d = 42; d >= 7; d -= 5) ring.push(around(C, 11.35, psi + d, 0));
  const flat = ring.map(([x, y]) => [x, y]);
  return solidSvg(extrude(flat, -6.6, 0.8, P, { convex: false }), { tone: "hi", lit: true, crease: "lo" });
}
function weave(fabric) {
  const gap = 1.3;
  const off = ((fabric % gap) + gap) % gap;
  const d = [];
  for (let y = -34 + off; y < 12; y += gap) d.push(lineOnTop([-14, y], [0, y], M.clothTop, P));
  return lineSvg(d.join(""), { tone: "faint" });
}

// The stitch chain as it shows on the cut face of the cloth (plane x = 0).
function chains(st) {
  const L = M.stitch;
  const holeY = (j) => L * (j + 1) + st.fabric;
  const top = [[0, -34, M.clothTop]];
  const bottom = [[0, -34, 0]];
  for (let j = st.c - 17; j <= st.c - 1; j++) {
    const y = holeY(j);
    if (y < -33.4) continue;
    top.push([0, y - 0.38, M.clothTop], [0, y, 0.85], [0, y + 0.38, M.clothTop]);
    bottom.push([0, y - 0.38, 0], [0, y, 1.15], [0, y + 0.38, 0]);
  }
  if (st.entered) top.push([0, 0, M.clothTop]);
  bottom.push([0, 0.9, 0]);
  return { top, bottom, end: top[top.length - 1] };
}

function loopOf(st) {
  const th = st.theta;
  const z0 = M.caseTop + 0.15;
  if (th >= M.catchAt && th < M.castOff) {
    const span = 2 * (th - M.catchAt);
    return { centre: C, radius: M.loopR, z: z0, from: M.needleAt, to: M.needleAt - span };
  }
  if (th >= M.castOff && th < M.setAt) {
    const t = (th - M.castOff) / (M.setAt - M.castOff);
    const close = ease(t / 0.3);
    const shrink = ease((t - 0.2) / 0.8);
    const span = 2 * (M.castOff - M.catchAt) + (360 - 2 * (M.castOff - M.catchAt)) * close;
    return {
      centre: [C[0] + (N[0] - C[0]) * shrink, C[1] + (N[1] - C[1]) * shrink],
      radius: Math.max(0.05, M.loopR * (1 - shrink)),
      z: z0 + (1 - z0) * shrink,
      from: M.needleAt,
      to: M.needleAt - span,
    };
  }
  return null;
}
function arcPoints(loop) {
  const list = [];
  const steps = Math.max(2, Math.ceil(Math.abs(loop.to - loop.from) / 6));
  for (let i = 0; i <= steps; i++) list.push(around(loop.centre, loop.radius, loop.from + ((loop.to - loop.from) * i) / steps, loop.z));
  return list;
}

let A = 0, target = 0;
let lastKey = "";
function draw() {
  const st = stateOf(A);
  const shaft = A * RAD;
  const psi = st.hook;
  parts.needle.setAttribute("transform", translateAlong(P, [0, 0, st.eye]));
  const dog = translateAlong(P, [0, st.dog.y, st.dog.top]);
  for (const name of ["dogLeft", "dogBack", "dogRight"]) parts[name].setAttribute("transform", dog);
  slots.lowerGear.innerHTML = lowerGear(shaft);
  slots.hookGear.innerHTML = hookGear(-2 * shaft);
  slots.wheel.innerHTML = wheel(shaft);
  slots.hookTop.innerHTML = hookTop(psi);
  const tip = around(C, 12, psi + 20, 0);
  const behind = depthOf(tip, P) < depthOf([C[0], C[1], 0], P);
  slots.beakBack.innerHTML = behind ? beak(psi) : "";
  slots.beakFront.innerHTML = behind ? "" : beak(psi);
  slots.weave.innerHTML = weave(st.fabric);

  const chain = chains(st);
  const loop = loopOf(st);
  let threads = red(pts(chain.top)) + blue(pts(chain.bottom));
  let near = "";
  if (loop) {
    const arc = arcPoints(loop);
    if (st.phase === "hook") arc.push(around(C, 11.05, psi, -5.8)); // the loop's bight rides on the hook point
    threads += red(pts(arc));
    near += red(pts([[0, 0, M.clothTop], arc[0]]));
  }
  near += red(pts([chain.end, [0.5, 0, st.eye]]));
  near += blue(pts([[0, 0.9, 0], [0, 0.9, M.plateBottom], EXIT]));
  slots.threads.innerHTML = threads;
  slots.needleThread.innerHTML = near;
  slots.headThread.innerHTML = red(pts([[3.4, 2, 31.6 + st.eye], [9.7, 2, 62.3]]));

  const text = `主轴 ${Math.round(st.theta)}° · 旋梭 ${Math.round(wrap(2 * A))}° · ${PHASES[st.phase]}`;
  if (text !== lastKey) {
    readout.textContent = text;
    stage.setAttribute("aria-valuenow", String(Math.round(st.theta)));
    stage.setAttribute("aria-valuetext", text);
    lastKey = text;
  }
}

// ── motion: an idle run, the handwheel drag, keys ──────────────────────
const SPEED = 40; // degrees of shaft per second when nobody is turning it: one stitch in 9 s
let frame = 0, last = 0, visible = false, touring = !still.matches, idle = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  if (touring) target += SPEED * dt;
  A = still.matches ? target : A + (target - A) * (1 - Math.exp(-dt / 0.09));
  if (Math.abs(target - A) < 0.02) A = target;
  draw();
  frame = visible && (touring || A !== target) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const hold = () => {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; run(); }, 5000);
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);

const hub = iso([WHEEL.x1, SHAFT.y, SHAFT.z], P);
const toSvg = (event) => {
  const point = svgEl.createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  const m = svgEl.getScreenCTM();
  return m ? point.matrixTransform(m.inverse()) : point;
};
let grab = null;
stage.addEventListener("pointerdown", (event) => {
  const p = toSvg(event);
  grab = Math.atan2(p.y - hub[1], p.x - hub[0]);
  stage.setPointerCapture(event.pointerId);
  stage.setAttribute("data-dragging", "");
  hold();
});
stage.addEventListener("pointermove", (event) => {
  if (grab === null) return;
  const p = toSvg(event);
  const now = Math.atan2(p.y - hub[1], p.x - hub[0]);
  let delta = now - grab;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  grab = now;
  target -= delta / RAD;
  hold();
  run();
});
const release = () => { grab = null; stage.removeAttribute("data-dragging"); };
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);
stage.addEventListener("keydown", (event) => {
  const step = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 90, PageDown: -90 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  target += step;
  hold();
  run();
});
draw();
// For checks and screenshots: put the shaft at an angle and hold it there.
window.__setAngle = (angle) => { hold(); clearTimeout(idle); touring = false; A = target = angle; draw(); };
