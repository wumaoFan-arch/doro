// Feline rheometer: a test bench that measures whether a cat is a solid or a liquid.
// Runs after the inlined anatomy kit (iso-kit + lathe), whose exports are globals here.

const W = 720, H = 470;
const AZ = 58;
const TAU2 = Math.PI * 2;

// ---------- world layout (units ~ 1 px, z up) ----------
const PLATE = { x: -190, y: -80, w: 380, d: 172, r: 9 };
const PLATE_H = 12, FOOT_H = 5;
const RAILS = [-48, 8];
const SLED = { x: -104, y: -55, w: 208, d: 72, r: 4 };
const SLED_Z = 3, SLED_TOP = 9, PAD_H = 1.5, Z0 = SLED_TOP + PAD_H;
const CY = -14;
const REL = [-72, 0, 72];
const SW = [-126, 50];   // stopwatch
const DE = [128, 50];    // Deborah gauge
const DIAL_R = 22, DIAL_H = 9;
const LAMPS = { x: -78, y: 44, w: 38, d: 15, r: 2 };
const TOGGLE = [-20, 51];
const NAMEPLATE = { x: 8, y: 40, w: 84, d: 18, r: 1.5 };

// ---------- containers: inner radius Rc(h, angle) above the container floor ----------
const vaseKnots = [[0, 13], [8, 18.5], [18, 20.5], [30, 15.5], [40, 8.6], [48, 8.8], [54, 11]];
function catmull(knots) {
  return (h) => {
    const n = knots.length;
    if (h <= knots[0][0]) return knots[0][1];
    if (h >= knots[n - 1][0]) return knots[n - 1][1];
    let i = 0;
    while (knots[i + 1][0] < h) i++;
    const p0 = knots[Math.max(0, i - 1)], p1 = knots[i], p2 = knots[i + 1], p3 = knots[Math.min(n - 1, i + 2)];
    const t = (h - p1[0]) / (p2[0] - p1[0]);
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}
const vaseR = catmull(vaseKnots);
const CONTAINERS = [
  { key: "box", name: "方箱", tau: 5, H: 34, floor: 2, wall: 1.6, fill: 25, dome: 7, headOff: 5, headUp: 4,
    Rc: (h, t) => 20 * Math.pow(Math.abs(Math.cos(t)) ** 8 + Math.abs(Math.sin(t)) ** 8, -1 / 8) },
  { key: "sink", name: "洗手盆", tau: 30, H: 22, floor: 2, wall: 1.6, fill: 16, dome: 9, headOff: 4, headUp: 4.5, lip: 31,
    Rc: (h) => 13 + 14 * (1 - (1 - Math.max(0, Math.min(h, 22)) / 22) ** 2) },
  { key: "vase", name: "细颈花瓶", tau: 120, H: 54, floor: 3, wall: 1.6, fill: 51, dome: 3, headOff: 0, headUp: 7.5,
    Rc: (h) => vaseR(h) },
];
const Ro = (def, h, t) => (def.lip && h > def.H - 1.6 ? def.lip : def.Rc(h, t) + def.wall);

// ---------- the cat ----------
const LOAF_A = 25, LOAF_B = 16, LOAF_H = 20, N = 22, NT = 48, HEAD_R = 9.5;
const FACE = (() => { const l = Math.hypot(0.8, 0.6); return [0.8 / l, 0.6 / l]; })();
const PERP = [-FACE[1], FACE[0]];
const TAIL_T = Math.atan2(1, -0.42);
const loafR = (t) => (LOAF_A * LOAF_B) / Math.hypot(LOAF_B * Math.cos(t), LOAF_A * Math.sin(t));
const loafS = (u) => (u < 0.12 ? 0.84 + 0.16 * (u / 0.12) : u < 0.45 ? 1 : Math.sqrt(Math.max(0.02, 1 - ((u - 0.45) / 0.55) ** 2)));
const HOP = Math.max(...CONTAINERS.map((c) => c.H)) + 3;
for (const def of CONTAINERS) {
  // The solid cat rests as low as it can go without changing shape.
  def.hb = def.H + 0.3;
  search: for (let h = def.floor; h <= def.H; h += 0.5) {
    for (let i = 0; i <= N; i++) {
      const u = i / N, z = h + u * LOAF_H;
      if (z >= def.H) break;
      for (let j = 0; j < 24; j++) {
        const t = (j / 24) * TAU2;
        if (loafR(t) * loafS(u) > def.Rc(z, t) - 0.6) continue search;
      }
    }
    def.hb = h;
    break;
  }
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- camera ----------
const P = fitProjection(
  [...boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [0, CY, Z0 + HOP + LOAF_H + 14], [REL[2] + 72, CY, Z0 + 56], [REL[0] - 72, CY - 30, Z0 + 40]],
  W, H, { pad: 22, azimuth: AZ },
);
const K = cameraOf(P).k;
const at = (p) => iso(p, P);
const S = (paths, style) => solidSvg(paths, style);
const Lx = (d, style) => lineSvg(d, style);
const Dx = (points, style) => dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => depthOf([a[0], a[1], 0], P) - depthOf([b[0], b[1], 0], P));
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const pathPts = (pts, closed) => pathOf(pts, closed);
const smoothPath = (pts) => {
  if (pts.length < 2) return "";
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
};
const dialPoint = (cx, cy, r, a) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];

// ---------- static: plate, rails, station index ----------
function plate() {
  const out = [`<path class="iso-halo" d="${haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(corners(PLATE, 24))) {
    out.push(S(cylinder(x, y, 7.5, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(cylinder(x, y, 5.8, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Lx(sideSeam(PLATE, -5, P, 8), { tone: "faint" }) }));
  out.push(Lx(planOutline(insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = corners(PLATE, 10);
  out.push(Lx(screws.map(([x, y]) => ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(Dx(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  const strip = { x: -176, y: PLATE.y + PLATE.d - 15, w: 352, d: 7, r: 1 };
  out.push(S(slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(Lx(ticks.minor, { tone: "lo" }), Lx(ticks.major, { tone: "mid" }));
  out.push(Dx([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  return out.join("");
}

function rails() {
  const out = [];
  for (const y of RAILS) {
    out.push(S(slabOf({ x: -180, y, w: 360, d: 5, r: 1 }, 0, 3, P, 3, 0.4), { tone: "mid" }));
    out.push(Dx([-172, -60, 60, 172].map((x) => at([x, y + 2.5, 3])), { size: 0.4 }));
  }
  for (const x of [-187, 181]) {
    out.push(S(slabOf({ x, y: RAILS[0] - 4, w: 6, d: RAILS[1] - RAILS[0] + 13, r: 1.2 }, 0, 8, P, 3, 0.5), { tone: "mid" }));
    out.push(Dx([at([x + 3, RAILS[0] + 2.5, 8]), at([x + 3, RAILS[1] + 2.5, 8])], { size: 0.45 }));
  }
  // station index: the cat always sits over this pointer
  const idx = { x: -6, y: 20, w: 12, d: 8, r: 1.4 };
  out.push(S(slabOf(idx, 0, 5, P, 3, 0.5), { tone: "mid" }));
  out.push(`<path class="iso-line pointer" data-tone="lit" d="${onTop([[-3, 26.5], [0, 21.5], [3, 26.5]], 5, P, true)}"/>`);
  out.push(Dx([at([-3.6, 23, 5]), at([3.6, 23, 5])].slice(0, 0), { size: 0.4 }));
  return out.join("");
}

// ---------- sled (built at offset 0, moved with translateAlong) ----------
function sled() {
  const out = [`<path class="iso-halo" d="${haloOf(insetPlan(SLED, 4), SLED_Z, 0.1, P)}" style="filter:blur(5px)"/>`];
  for (const y of RAILS) {
    for (const x of [SLED.x + 10, SLED.x + SLED.w - 22]) {
      out.push(S(slabOf({ x, y: y - 2, w: 12, d: 9, r: 1 }, 3, 1.2, P, 2), { tone: "lo", crease: "none" }));
    }
  }
  out.push(S(slabOf(SLED, SLED_Z, SLED_TOP - SLED_Z, P, 6, 0.6), { tone: "mid", inner: Lx(sideSeam(SLED, 6, P, 6), { tone: "faint" }) }));
  out.push(Lx(planOutline(insetPlan(SLED, 3.5), SLED_TOP, P, 6), { tone: "faint" }));
  out.push(Dx([-96, -60, -36, 36, 60, 96].map((x) => at([x, SLED.y + SLED.d - 2, SLED_TOP])), { size: 0.4, tone: "lo" }));
  CONTAINERS.forEach((def, i) => {
    const cx = REL[i];
    const reach = Math.max(...Array.from({ length: 24 }, (_, j) => Ro(def, 0, (j / 24) * TAU2)));
    out.push(S(cylinder(cx, CY, reach + 3, SLED_TOP, PAD_H, P, 56), { tone: "lo" }));
    out.push(Lx(ring(cx, CY, reach + 1.4, Z0, P, 56), { tone: "faint" }));
    out.push(Dx([0, 1, 2].map((j) => at([cx + Math.cos(j * 2.1 + 0.4) * (reach + 2.2), CY + Math.sin(j * 2.1 + 0.4) * (reach + 2.2), Z0])), { size: 0.4 }));
    out.push(Lx(lineOnTop([cx, SLED.y + SLED.d - 6], [cx, SLED.y + SLED.d], SLED_TOP, P), { tone: "mid", free: "start" }));
  });
  const knob = [SLED.x + SLED.w - 10, SLED.y + SLED.d - 12];
  out.push(S(cylinder(knob[0], knob[1], 4.6, SLED_TOP, 5, P, 28), { tone: "mid" }));
  out.push(Lx(knurl(knob[0], knob[1], 4.6, SLED_TOP, SLED_TOP + 5, 26, P), { tone: "lo" }));
  out.push(Lx(lineOnTop(knob, [knob[0] + 4.6, knob[1]], SLED_TOP + 5, P), { tone: "hi" }));
  return out.join("");
}

// ---------- glass containers ----------
function glassOf(def, cx, cy) {
  const NZ = 34, NA = 72;
  const levels = Array.from({ length: NZ + 1 }, (_, i) => (i / NZ) * def.H);
  const ringAt = (h, rf) => Array.from({ length: NA }, (_, j) => {
    const t = (j / NA) * TAU2;
    const r = rf(h, t);
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r, Z0 + h];
  });
  const left = [], right = [];
  for (const h of levels) {
    const pts = ringAt(h, (hh, t) => Ro(def, hh, t)).map(at);
    let l = pts[0], r = pts[0];
    for (const p of pts) { if (p[0] < l[0]) l = p; if (p[0] > r[0]) r = p; }
    left.push(l); right.push(r);
  }
  const halfArc = (pts, front) => {
    let il = 0, ir = 0;
    pts.forEach((p, i) => { if (p[0] < pts[il][0]) il = i; if (p[0] > pts[ir][0]) ir = i; });
    const walk = (a, b) => { const out = []; for (let i = a; ; i = (i + 1) % pts.length) { out.push(pts[i]); if (i === b) break; } return out; };
    const one = walk(il, ir), two = walk(ir, il).reverse();
    const avg = (list) => list.reduce((s, p) => s + p[1], 0) / list.length;
    return (avg(one) > avg(two)) === front ? one : two;
  };
  const bottom = ringAt(0, (hh, t) => Ro(def, hh, t)).map(at);
  const rimOut = ringAt(def.H, (hh, t) => Ro(def, hh, t)).map(at);
  const rimIn = ringAt(def.H, (hh, t) => def.Rc(hh, t)).map(at);
  const floorIn = ringAt(def.floor, (hh, t) => def.Rc(hh, t)).map(at);
  const bottomFront = halfArc(bottom, true);
  const rimBack = halfArc(rimOut, false);
  const sil = [...left.slice().reverse(), ...bottomFront, ...right, ...rimBack.slice().reverse()];
  const silD = pathPts(sil, true);
  const back = [];
  const front = [];
  // what sits behind the glass
  if (def.key === "sink") back.push(faucet(cx, cy));
  back.push(`<path class="glass-back" d="${silD}"/>`);
  back.push(Lx(pathPts(floorIn, true), { tone: "faint" }));
  back.push(Lx(pathPts(halfArc(rimIn, false), false), { tone: "lo" }));
  if (def.key === "sink") {
    back.push(Lx(ring(cx, cy, 3, Z0 + def.floor, P, 24), { tone: "lo" }));
    back.push(Lx(lineOnTop([cx - 3, cy], [cx + 3, cy], Z0 + def.floor, P) + lineOnTop([cx, cy - 3], [cx, cy + 3], Z0 + def.floor, P), { tone: "faint" }));
  }
  // the glass in front of the cat: tinted, with the opening left clear
  front.push(`<path class="glass-front" fill-rule="evenodd" d="${silD}${pathPts(rimIn, true)}"/>`);
  front.push(Lx(pathPts(left, false) + pathPts(right, false) + pathPts(bottomFront, false), { tone: "mid" }));
  front.push(Lx(pathPts(rimOut, true), { tone: "mid" }));
  front.push(Lx(pathPts(rimIn, true), { tone: "lo" }));
  if (def.floor > 0) front.push(Lx(pathPts(halfArc(ringAt(def.floor, (hh, t) => Ro(def, hh, t)).map(at), true), false), { tone: "faint" }));
  if (def.key === "box") {
    for (const t of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const facing = Math.cos(t) * Math.cos((AZ * Math.PI) / 180) + Math.sin(t) * Math.sin((AZ * Math.PI) / 180);
      if (facing < 0.05) continue;
      const r = Ro(def, 0, t);
      front.push(Lx(segment([cx + Math.cos(t) * r, cy + Math.sin(t) * r, Z0], [cx + Math.cos(t) * r, cy + Math.sin(t) * r, Z0 + def.H], P), { tone: "lo" }));
    }
  }
  if (def.key === "vase") {
    for (const h of [36, 44]) front.push(Lx(pathPts(halfArc(ringAt(h, (hh, t) => Ro(def, hh, t)).map(at), true), false), { tone: "faint" }));
  }
  if (def.key === "sink") {
    const lipLow = ringAt(def.H - 1.6, () => def.lip).map(at);
    front.push(Lx(pathPts(halfArc(lipLow, true), false), { tone: "lo" }));
  }
  // highlight streaks on the glass, fading at both ends
  const a0 = (AZ * Math.PI) / 180;
  for (const [dt, from, to] of [[-0.62, 0.12, 0.8], [-0.48, 0.22, 0.6]]) {
    const t = a0 + dt;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const h = mix(from, to, i / 16) * def.H;
      const r = Ro(def, h, t) + 0.1;
      pts.push(at([cx + Math.cos(t) * r, cy + Math.sin(t) * r, Z0 + h]));
    }
    front.push(`<g class="glint">${fadeLineSvg(pts, { fade: [10, 10], tone: "lit" })}</g>`);
  }
  return { back: back.join(""), front: front.join("") };
}

function faucet(cx, cy) {
  const out = [];
  const bx = cx - 4, by = cy - 37;
  out.push(S(cylinder(bx, by, 4, SLED_TOP, 3, P, 24), { tone: "mid" }));
  out.push(S(cylinder(bx, by, 2.1, SLED_TOP + 3, 32, P, 20), { tone: "mid", crease: "none", inner: Lx(sideArc(bx, by, 2.1, SLED_TOP + 20, P, 12), { tone: "faint" }) }));
  out.push(S(cylinder(bx, by, 3, SLED_TOP + 35, 4, P, 20), { tone: "mid" }));
  out.push(S(slabOf({ x: bx - 6, y: by - 1, w: 12, d: 2, r: 0.8 }, SLED_TOP + 39, 1.4, P, 2), { tone: "mid" }));
  const F = G.frameAlong([bx, by, SLED_TOP + 37], [0, 1, 0]);
  out.push(S(G.disc(1.5, 17, 1.6, F, P), { tone: "mid" }));
  const Fn = G.frameAlong([bx, by + 16, SLED_TOP + 37], [0, 0, -1]);
  out.push(S(G.disc(0, 3.4, 2, Fn, P), { tone: "mid" }));
  return out.join("");
}

// ---------- instruments ----------
function logTicks(cx, cy, r, z, lo, hi, a0, span, majors) {
  const angle = (v) => a0 + (Math.log10(v / lo) / Math.log10(hi / lo)) * span;
  let minor = "", major = "";
  for (let dec = lo; dec < hi * 1.0001; dec *= 10) {
    for (let m = 1; m <= 9; m++) {
      const v = dec * m;
      if (v > hi * 1.0001) break;
      const big = m === 1 || majors.includes(v);
      const a = angle(v);
      const d = lineOnTop(dialPoint(cx, cy, r, a), dialPoint(cx, cy, r - (big ? 3 : 1.6), a), z, P);
      if (big) major += d; else minor += d;
    }
  }
  return { minor, major, angle };
}
function arcOnTop(cx, cy, r, z, from, to) {
  const n = Math.max(4, Math.ceil(Math.abs(to - from) / 0.06));
  return onTop(Array.from({ length: n + 1 }, (_, i) => dialPoint(cx, cy, r, mix(from, to, i / n))), z, P);
}
const SW_A0 = (-150 * Math.PI) / 180, SW_SPAN = (300 * Math.PI) / 180;
const DE_A0 = (-135 * Math.PI) / 180, DE_SPAN = (270 * Math.PI) / 180;
const T_MIN = 0.1, T_MAX = 600;
const swAngle = (T) => SW_A0 + (Math.log10(clamp(T, T_MIN, T_MAX) / T_MIN) / Math.log10(T_MAX / T_MIN)) * SW_SPAN;
const deAngle = (De) => DE_A0 + ((Math.log10(clamp(De, 0.01, 100)) + 2) / 4) * DE_SPAN;
const SUB = [SW[0], SW[1] + 10];
const TOP = DIAL_H;

function dialBody(cx, cy) {
  const out = [`<path class="iso-halo" d="${haloOf({ x: cx - DIAL_R, y: cy - DIAL_R, w: DIAL_R * 2, d: DIAL_R * 2, r: DIAL_R }, 0, DIAL_H, P)}"/>`];
  out.push(S(cylinder(cx, cy, DIAL_R + 1.6, 0, 1.4, P, 64), { tone: "lo" }));
  out.push(S(cylinder(cx, cy, DIAL_R, 1.4, DIAL_H - 1.4, P, 72, 0.8), { tone: "hi", crease: "lo", inner: Lx(sideArc(cx, cy, DIAL_R, TOP - 3.2, P, 48), { tone: "faint" }) }));
  out.push(Lx(knurl(cx, cy, DIAL_R, TOP - 3.2, TOP, 90, P, 0.3), { tone: "lo" }));
  out.push(Lx(ring(cx, cy, DIAL_R - 2, TOP, P, 72), { tone: "lo" }));
  return out.join("");
}

function stopwatch() {
  const [x, y] = SW;
  const out = [];
  // crown and pusher sit on the far side of the case
  const Fc = G.frameAlong([x, y - DIAL_R + 0.5, 5.2], [0, -1, 0]);
  out.push(S(G.disc(0, 3.2, 1.8, Fc, P), { tone: "mid" }));
  out.push(S(G.disc(3.2, 8, 3.6, Fc, P), { tone: "mid", inner: fadedSvg(G.ribsOf(Fc, 3.2, 8, 3.6, 22, P, { fade: [0.05, 0.4] }), { tone: "lo" }) }));
  out.push(S(G.disc(8, 9.6, 2, Fc, P), { tone: "hi" }));
  const Fp = G.frameAlong([x + Math.sin(0.75) * (DIAL_R - 0.5), y - Math.cos(0.75) * (DIAL_R - 0.5), 5.2], [Math.sin(0.75), -Math.cos(0.75), 0]);
  out.push(S(G.disc(0, 3.6, 1.6, Fp, P), { tone: "mid" }));
  out.push(dialBody(x, y));
  const t = logTicks(x, y, DIAL_R - 3, TOP, T_MIN, 600, SW_A0, SW_SPAN, [60, 600]);
  out.push(Lx(t.minor, { tone: "lo" }), Lx(t.major, { tone: "mid" }));
  out.push(Lx(arcOnTop(x, y, DIAL_R - 3, TOP, SW_A0, SW_A0 + SW_SPAN), { tone: "faint" }));
  // seconds sub-dial
  out.push(Lx(ring(SUB[0], SUB[1], 5.6, TOP, P, 40), { tone: "lo" }));
  const st = radialTicks(SUB[0], SUB[1], 5.6, 12, 3, TOP, [0.9, 1.6], P);
  out.push(Lx(st.minor, { tone: "faint" }), Lx(st.major, { tone: "lo" }));
  out.push(`<path data-part="sub-hand" class="iso-line" data-tone="hi" data-free="end" d=""/>`);
  out.push(`<path data-part="sw-hand" class="iso-line hand" data-tone="lit" data-free="end" d=""/>`);
  out.push(Lx(ring(x, y, 1.7, TOP, P, 16), { tone: "mid" }));
  out.push(Dx([at([x, y, TOP])], { size: 0.7, tone: "hi" }));
  return out.join("");
}

function deGauge() {
  const [x, y] = DE;
  const out = [];
  const Fc = G.frameAlong([x, y - DIAL_R + 0.5, 5.2], [0, -1, 0]);
  out.push(S(G.disc(0, 4, 2.6, Fc, P), { tone: "mid" }));
  out.push(dialBody(x, y));
  const zones = [["liquid", 0.01, 0.3], ["visco", 0.3, 3], ["solid", 3, 100]];
  for (const [z, a, b] of zones) {
    out.push(`<path class="zone" data-zone="${z}" d="${arcOnTop(x, y, DIAL_R - 7.4, TOP, deAngle(a) + 0.03, deAngle(b) - 0.03)}"/>`);
  }
  const t = logTicks(x, y, DIAL_R - 3, TOP, 0.01, 100, DE_A0, DE_SPAN, []);
  out.push(Lx(t.minor, { tone: "lo" }), Lx(t.major, { tone: "mid" }));
  out.push(Lx(arcOnTop(x, y, DIAL_R - 3, TOP, DE_A0, DE_A0 + DE_SPAN), { tone: "faint" }));
  out.push(`<path data-part="de-hand" class="iso-line hand" data-tone="lit" data-free="end" d=""/>`);
  out.push(Lx(ring(x, y, 1.7, TOP, P, 16), { tone: "mid" }));
  out.push(Dx([at([x, y, TOP])], { size: 0.7, tone: "hi" }));
  return out.join("");
}

const LAMP_X = [-69, -59, -49];
const LAMP_ZONES = ["solid", "visco", "liquid"];
function lamps() {
  const out = [`<path class="iso-halo" d="${haloOf(LAMPS, 0, 8, P)}"/>`];
  out.push(S(slabOf(LAMPS, 0, 8, P, 3, 0.5), { tone: "mid", inner: Lx(sideSeam(LAMPS, 2, P, 3), { tone: "faint" }) }));
  out.push(Dx([at([LAMPS.x + 3, LAMPS.y + 3, 8]), at([LAMPS.x + LAMPS.w - 3, LAMPS.y + LAMPS.d - 3, 8]), at([LAMPS.x + 3, LAMPS.y + LAMPS.d - 3, 8]), at([LAMPS.x + LAMPS.w - 3, LAMPS.y + 3, 8])], { size: 0.45 }));
  LAMP_X.forEach((lx, i) => {
    const ly = LAMPS.y + 7.5;
    out.push(S(cylinder(lx, ly, 4.2, 8, 1.4, P, 28), { tone: "mid" }));
    out.push(`<g class="lamp" data-zone="${LAMP_ZONES[i]}"><path class="lamp-glow" d="${cylinder(lx, ly, 6.5, 11, 0.01, P, 28).fill}"/>${S(cylinder(lx, ly, 3.1, 9.4, 1.8, P, 28), { tone: "hi" })}</g>`);
  });
  return out.join("");
}

function toggleBase() {
  const [x, y] = TOGGLE;
  const base = { x: x - 11, y: y - 7, w: 22, d: 14, r: 2 };
  const out = [S(slabOf(base, 0, 3, P, 3, 0.4), { tone: "mid" })];
  out.push(Lx(planOutline(insetPlan(base, 1.6), 3, P, 3), { tone: "faint" }));
  out.push(Dx([at([x - 7.5, y + 4, 3]), at([x + 7.5, y + 4, 3])], { size: 0.45 }));
  out.push(S(cylinder(x, y, 3.8, 3, 1.4, P, 6), { tone: "mid" }));
  out.push(S(cylinder(x, y, 2.6, 4.4, 2.2, P, 20), { tone: "mid" }));
  return out.join("");
}
function lever(tilt) {
  const [x, y] = TOGGLE;
  const a = tilt * 0.5;
  const dir = [Math.sin(a), 0, Math.cos(a)];
  const F = G.frameAlong([x, y, 6.2], dir);
  const tip = [x + dir[0] * 11, y, 6.2 + dir[2] * 11];
  return S(G.solidOf([[0, 1.15], [10, 0.85]], F, P), { tone: "hi" }) + S(G.sphereOf(tip, 2.1, P), { tone: "hi" });
}

function nameplate() {
  const n = NAMEPLATE;
  const out = [S(slabOf(n, 0, 1, P, 4), { tone: "lo" })];
  out.push(Lx(planOutline(insetPlan(n, 1.6), 1, P, 4), { tone: "faint" }));
  out.push(faceTextSvg(topMatrix([n.x + 6, n.y + 7.5], 1, P, "x"), "FELINE RHEOMETER  MK·II", { size: 3.6, tone: "mid" }));
  out.push(Lx(lineOnTop([n.x + 6, n.y + 11.5], [n.x + 56, n.y + 11.5], 1, P), { tone: "lo", free: true }));
  out.push(Lx(lineOnTop([n.x + 6, n.y + 14], [n.x + 40, n.y + 14], 1, P), { tone: "lo", free: true }));
  out.push(Dx(corners(n, 2.6).map(([px, py]) => at([px, py, 1])), { size: 0.45 }));
  return out.join("");
}

function wires() {
  const w = (pts) => wireSvg(at(pts[0]), at(pts[pts.length - 1]), { via: pts.slice(1, -1).map(at), tone: "lo", size: 1.1 });
  const z = 0.3;
  return (
    w([[DE[0] - DIAL_R * 0.72, DE[1] + DIAL_R * 0.72, z], [DE[0] - DIAL_R * 0.72, 74, z], [-59, 74, z], [-59, LAMPS.y + LAMPS.d + 0.4, z]]) +
    w([[SW[0] + DIAL_R + 1.4, SW[1] + 2, z], [LAMPS.x - 0.4, SW[1] + 2, z]])
  );
}

// ---------- the cat, built for a container at (cx, cy) ----------
function catSvg(def, cx, cy, phi, lift, alert, time) {
  const baseRel = mix(def.hb, HOP, lift);
  const top = def.fill + def.dome;
  const rim = Z0 + def.H;
  const low = [], high = [];
  const zAt = (u) => Z0 + mix(baseRel + u * LOAF_H, def.floor + u * (top - def.floor), phi);
  const liquidR = (h, t) => (h <= def.fill ? def.Rc(h, t) - 0.6 : (def.Rc(def.fill, t) - 0.6) * Math.sqrt(Math.max(0.03, 1 - ((h - def.fill) / def.dome) ** 2)));
  const ringAtU = (u, z0, z1) => {
    const hL = def.floor + u * (top - def.floor);
    return Array.from({ length: NT }, (_, j) => {
      const t = (j / NT) * TAU2;
      let r = mix(loafR(t) * loafS(u), liquidR(hL, t), phi);
      for (const z of [z0, z1]) {
        const h = z - Z0;
        if (h < def.H) r = Math.min(r, def.Rc(Math.max(0, h), t) - 0.6);
      }
      r = Math.max(1.2, r);
      return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
    });
  };
  for (let i = 0; i < N; i++) {
    const z0 = zAt(i / N), z1 = zAt((i + 1) / N);
    const paths = extrude(ringAtU((i + 0.5) / N, z0, z1), z0, Math.max(0.05, z1 - z0), P);
    const svg = S(paths, { tone: "hi", crease: "none", className: i % 4 === 2 ? "slice stripe" : "slice" });
    (z0 >= rim - 0.01 ? high : low).push(svg);
  }
  // tail: from the body, over the near rim, hanging down the outside
  const sway = Math.sin(time * 1.3) * 0.05;
  const tt = TAIL_T + sway;
  const uT = mix(0.22, 0.8, phi), zT = zAt(uT);
  const rT = ringAtU(uT, zT, zT)[Math.round((((tt % TAU2) + TAU2) % TAU2) / TAU2 * NT) % NT];
  const rr = Math.hypot(rT[0] - cx, rT[1] - cy) * 0.85;
  const radial = (h, extra, dt = 0) => {
    const t = tt + dt;
    const r = Ro(def, clamp(h, 0, def.H), t) + extra;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r, Z0 + clamp(h, 2, 999)];
  };
  const tail = [
    [cx + Math.cos(tt) * rr, cy + Math.sin(tt) * rr, zT],
    radial(def.H + 2.2, 0.6),
    radial(def.H - 7, 3.2, 0.03),
    radial(def.H - 15, 3.4, 0.1 + sway),
    radial(def.H - 20, 5.5, 0.22 + sway * 2),
    radial(def.H - 17.5, 8, 0.3 + sway * 2),
  ];
  if (tail[0][2] > tail[1][2] - 1) tail[1][2] = Math.max(tail[1][2], tail[0][2] - 2);
  const td = smoothPath(tail.map(at));
  const tailSvg = `<g class="tail"><path class="tail-edge" d="${td}" style="stroke-width:${f1(K * 4.6)}"/><path class="tail-body" d="${td}" style="stroke-width:${f1(K * 3.2)}"/></g>`;
  // head
  const zTop = Z0 + top;
  const headS = [cx + FACE[0] * 13, cy + FACE[1] * 13, Z0 + baseRel + LOAF_H * 0.82];
  const headL = [cx + FACE[0] * def.headOff, cy + FACE[1] * def.headOff, zTop + def.headUp];
  const head = [0, 1, 2].map((i) => mix(headS[i], headL[i], phi));
  const earH = alert ? 8.2 : 6.2;
  const ears = [-1, 1].map((side) => {
    const base = [head[0] + PERP[0] * side * 5.6 - FACE[0] * 1.6, head[1] + PERP[1] * side * 5.6 - FACE[1] * 1.6, head[2] + HEAD_R * 0.6];
    const ax = [PERP[0] * side * 0.38, PERP[1] * side * 0.38, 1];
    const l = Math.hypot(...ax);
    const F = G.frameAlong(base, ax.map((v) => v / l));
    return { depth: depthOf(base, P), svg: S(G.solidOf([[0, 3.8], [earH, 0.5]], F, P), { tone: "hi" }) };
  }).sort((a, b) => a.depth - b.depth);
  const face = faceSvg(head, alert);
  const headSvg = ears[0].svg + S(G.sphereOf(head, HEAD_R, P), { tone: "hi" }) + ears[1].svg + face;
  const tailFirst = depthOf([tail[2][0], tail[2][1], 0], P) < depthOf([cx, cy, 0], P);
  return {
    low: low.join(""),
    high: (tailFirst ? tailSvg : "") + high.join("") + headSvg + (tailFirst ? "" : tailSvg),
  };
}

function faceSvg(head, alert) {
  const c = at(head);
  const fp = at([head[0] + FACE[0] * HEAD_R * 0.72, head[1] + FACE[1] * HEAD_R * 0.72, head[2] - 1]);
  const pr = at([head[0] + PERP[0], head[1] + PERP[1], head[2]]);
  const ps = [(pr[0] - c[0]), (pr[1] - c[1])];
  const pl = Math.hypot(...ps) || 1;
  const px = [ps[0] / pl * K, ps[1] / pl * K];
  const up = [0, -K];
  const pt = (base, a, b) => [base[0] + px[0] * a + up[0] * b, base[1] + px[1] * a + up[1] * b];
  const out = [];
  for (const side of [-1, 1]) {
    const e = pt(fp, side * 3.4, 2.2);
    if (alert) {
      out.push(`<circle class="eye" cx="${f1(e[0])}" cy="${f1(e[1])}" r="${f1(K * 1.45)}"/>`);
      out.push(`<circle class="eye-glint" cx="${f1(e[0] - K * 0.4)}" cy="${f1(e[1] - K * 0.45)}" r="${f1(K * 0.45)}"/>`);
    } else {
      const a = pt(e, -1.5, 0), b = pt(e, 1.5, 0), m = pt(e, 0, -1.5);
      out.push(`<path class="eye-closed" d="M${f1(a[0])} ${f1(a[1])}Q${f1(m[0])} ${f1(m[1])} ${f1(b[0])} ${f1(b[1])}" style="stroke-width:${f1(K * 0.55)}"/>`);
    }
    for (const [dy, len] of [[0.2, 6.5], [-0.9, 6], [-2, 5.4]]) {
      const s = pt(fp, side * 2.6, dy - 0.6);
      const t = pt(fp, side * (2.6 + len), dy * 1.8 - 0.4);
      out.push(Lx(`M${f1(s[0])} ${f1(s[1])}L${f1(t[0])} ${f1(t[1])}`, { tone: "mid", free: true }));
    }
  }
  const n = pt(fp, 0, 0.2);
  out.push(`<path class="nose" d="M${f1(n[0] - K * 0.9)} ${f1(n[1] - K * 0.5)}L${f1(n[0] + K * 0.9)} ${f1(n[1] - K * 0.5)}L${f1(n[0])} ${f1(n[1] + K * 0.5)}Z"/>`);
  const m0 = pt(fp, 0, -0.3), m1 = pt(fp, -1.1, -1.1), m2 = pt(fp, 1.1, -1.1);
  out.push(`<path class="mouth" d="M${f1(m1[0])} ${f1(m1[1])}Q${f1((m1[0] + m0[0]) / 2)} ${f1(m0[1] + K * 0.9)} ${f1(m0[0])} ${f1(m0[1])}Q${f1((m2[0] + m0[0]) / 2)} ${f1(m0[1] + K * 0.9)} ${f1(m2[0])} ${f1(m2[1])}" style="stroke-width:${f1(K * 0.4)}"/>`);
  return `<g class="face">${out.join("")}</g>`;
}

// ---------- assemble the figure ----------
const glass = CONTAINERS.map((def, i) => glassOf(def, REL[i], CY));
const figureBody = [
  plate(),
  wires(),
  rails(),
  `<g data-part="sled">${sled()}</g>`,
  ...CONTAINERS.map((_, i) => `<g data-part="back-${i}">${glass[i].back}</g><g class="cat" data-part="low-${i}"></g><g data-part="front-${i}">${glass[i].front}</g><g class="cat" data-part="high-${i}"></g>`),
  lamps(),
  toggleBase(),
  `<g data-part="lever"></g>`,
  nameplate(),
  stopwatch(),
  deGauge(),
].join("");

const svgHtml = figureSvg({
  width: W,
  height: H,
  label: "猫流变仪：一块带滑轨的测试台，滑台上放着方箱、洗手盆和细颈花瓶三个玻璃容器。一只橘猫在测试工位上，观察时间越长，它就越贴合容器的形状。左前方的秒表显示观察时间 T，右前方的表盘显示底波拉数 De，三盏指示灯给出固体、粘弹或液体的判定。",
  body: figureBody,
});
document.querySelector("[data-figure]").innerHTML = svgHtml;

// ---------- live behaviour ----------
const svg = document.querySelector("[data-figure] svg");
const part = (name) => svg.querySelector(`[data-part="${name}"]`);
const sledEl = part("sled");
const backs = CONTAINERS.map((_, i) => part(`back-${i}`));
const fronts = CONTAINERS.map((_, i) => part(`front-${i}`));
const lows = CONTAINERS.map((_, i) => part(`low-${i}`));
const highs = CONTAINERS.map((_, i) => part(`high-${i}`));
const swHand = part("sw-hand"), subHand = part("sub-hand"), deHand = part("de-hand"), leverEl = part("lever");
const lampEls = [...svg.querySelectorAll(".lamp")];
const readout = document.querySelector("[data-readout]");
const ui = {
  slider: document.getElementById("obs-time"),
  tLabel: document.querySelector("[data-t]"),
  boxes: [...document.querySelectorAll("[data-container]")],
  moods: [...document.querySelectorAll("[data-mood]")],
  play: document.getElementById("tour"),
  formula: document.querySelector("[data-formula]"),
  state: document.querySelector("[data-state]"),
  stateText: document.querySelector("[data-state-text]"),
  phiBar: document.querySelector("[data-phi]"),
  phiText: document.querySelector("[data-phi-text]"),
};
const still = matchMedia("(prefers-reduced-motion: reduce)");
const SL_MAX = 1000;
const tFromSlider = (v) => T_MIN * Math.pow(T_MAX / T_MIN, v / SL_MAX);
const sliderFromT = (T) => (Math.log(T / T_MIN) / Math.log(T_MAX / T_MIN)) * SL_MAX;

const state = {
  active: 0, pending: 0, switching: false,
  sled: -REL[0], phi: 0, lift: 0, lever: -1,
  T: 0.5, alert: false, touring: !still.matches, tourClock: 0, tourStage: "rise",
};
const tauOf = () => CONTAINERS[state.active].tau * (state.alert ? 10 : 1);
const phiModel = () => 1 - Math.exp(-state.T / tauOf());
const zoneOf = (De) => (De > 3 ? "solid" : De >= 0.3 ? "visco" : "liquid");
const ZONE_TEXT = { solid: "固体", visco: "粘弹", liquid: "液体" };
const fmtT = (T) => {
  if (T < 1) return T.toFixed(2) + " s";
  if (T < 10) return T.toFixed(1) + " s";
  if (T < 60) return Math.round(T) + " s";
  const m = Math.floor(T / 60), s = Math.round(T - m * 60);
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
};
const fmtTau = (tau) => (tau < 60 ? tau + " s" : tau % 60 ? f1(tau / 60) + " 分钟" : tau / 60 + " 分钟");
const fmtDe = (De) => (De >= 100 ? De.toFixed(0) : De >= 10 ? De.toFixed(1) : De >= 1 ? De.toFixed(2) : De.toFixed(De >= 0.1 ? 2 : 3));

let shown = { key: "" };
function draw(time) {
  const tau = tauOf();
  const De = tau / state.T;
  const zone = zoneOf(De);
  // sled and glass
  const move = translateAlong(P, [state.sled, 0, 0]);
  sledEl.setAttribute("transform", move);
  backs.forEach((el) => el.setAttribute("transform", move));
  fronts.forEach((el) => el.setAttribute("transform", move));
  // which container is under the cat
  let near = 0;
  REL.forEach((x, i) => { if (Math.abs(x + state.sled) < Math.abs(REL[near] + state.sled)) near = i; });
  const key = [near, state.phi.toFixed(4), state.lift.toFixed(4), state.sled.toFixed(2), state.alert, (time * 4 | 0)].join("|");
  if (key !== shown.key) {
    shown.key = key;
    const def = CONTAINERS[near];
    const cat = catSvg(def, REL[near] + state.sled, CY, state.phi, state.lift, state.alert, time);
    CONTAINERS.forEach((_, i) => {
      // the cat is drawn in world space, so cancel the sled shift for its groups
      lows[i].innerHTML = i === near ? cat.low : "";
      highs[i].innerHTML = i === near ? cat.high : "";
    });
  }
  // instruments
  const swA = swAngle(state.T);
  swHand.setAttribute("d", lineOnTop(dialPoint(SW[0], SW[1], 4, swA + Math.PI), dialPoint(SW[0], SW[1], DIAL_R - 4, swA), TOP + 0.2, P));
  const subA = ((state.T % 60) / 60) * TAU2;
  subHand.setAttribute("d", lineOnTop(SUB, dialPoint(SUB[0], SUB[1], 4.6, subA), TOP + 0.15, P));
  const deA = deAngle(De);
  deHand.setAttribute("d", lineOnTop(dialPoint(DE[0], DE[1], 4, deA + Math.PI), dialPoint(DE[0], DE[1], DIAL_R - 4, deA), TOP + 0.2, P));
  lampEls.forEach((el) => el.toggleAttribute("data-on", el.dataset.zone === zone));
  leverEl.innerHTML = lever(state.lever);
  // readouts
  const text = `T ${fmtT(state.T)} · De ${fmtDe(De)} · ${ZONE_TEXT[zone]}`;
  if (readout.textContent !== text) readout.textContent = text;
  ui.tLabel.textContent = fmtT(state.T);
  ui.formula.innerHTML = `De = τ / T = <b>${fmtTau(tau)}</b> / <b>${fmtT(state.T)}</b> = <b class="de">${fmtDe(De)}</b>`;
  ui.state.dataset.zone = zone;
  ui.stateText.textContent = ZONE_TEXT[zone];
  const pct = Math.round(phiModel() * 100);
  ui.phiBar.style.setProperty("--phi", pct + "%");
  ui.phiText.textContent = pct + "%";
  if (document.activeElement !== ui.slider) ui.slider.value = String(Math.round(sliderFromT(state.T)));
  ui.slider.setAttribute("aria-valuetext", `观察时间 ${fmtT(state.T)}，底波拉数 ${fmtDe(De)}，${ZONE_TEXT[zone]}`);
  ui.boxes.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.container) === (state.switching ? state.pending : state.active))));
  ui.moods.forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.mood === "alert") === state.alert)));
  ui.play.setAttribute("aria-pressed", String(state.touring));
  ui.play.querySelector("span").textContent = state.touring ? "暂停演示" : "自动演示";
}

const follow = (v, target, dt, secs, calm) => (calm ? target : v + (target - v) * (1 - Math.exp(-dt / secs)));
const T_TOUR_FROM = 0.2;
function tourStep(dt) {
  if (state.switching) return;
  state.tourClock += dt;
  if (state.tourStage === "rise") {
    const share = Math.min(1, state.tourClock / 9);
    state.T = T_TOUR_FROM * Math.pow(T_MAX / T_TOUR_FROM, share * share * (3 - 2 * share) * 0.6 + share * 0.4);
    if (share >= 1) { state.tourStage = "hold"; state.tourClock = 0; }
  } else if (state.tourClock > 2.6) {
    state.tourStage = "rise"; state.tourClock = 0;
    choose((state.active + 1) % CONTAINERS.length, true);
  }
}
function choose(i, fromTour) {
  if (!fromTour) stopTour();
  if (i === state.active && !state.switching) return;
  state.pending = i;
  state.switching = true;
  if (fromTour) state.T = T_TOUR_FROM;
  run();
}

let frame = 0, last = 0, visible = true, idle = 0, clock = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (state.touring) tourStep(dt);
  let phiTarget = phiModel(), liftTarget = 0, sledTarget = -REL[state.active];
  if (state.switching) {
    phiTarget = 0;
    liftTarget = 1;
    if (state.lift > 0.9 && state.phi < 0.1) sledTarget = -REL[state.pending];
    if (Math.abs(state.sled + REL[state.pending]) < 0.25) {
      state.sled = -REL[state.pending];
      state.active = state.pending;
      state.switching = false;
    }
  }
  if (state.switching && sledTarget !== -REL[state.active]) state.sled = follow(state.sled, sledTarget, dt, 0.32, calm);
  state.phi = follow(state.phi, phiTarget, dt, state.switching ? 0.18 : 0.5, calm);
  state.lift = follow(state.lift, liftTarget, dt, 0.2, calm);
  state.lever = follow(state.lever, state.alert ? 1 : -1, dt, 0.12, calm);
  const settled = !state.touring && !state.switching && Math.abs(state.phi - phiModel()) < 0.001 && state.lift < 0.001 && Math.abs(state.lever - (state.alert ? 1 : -1)) < 0.001;
  if (settled) { state.phi = phiModel(); state.lift = 0; state.lever = state.alert ? 1 : -1; }
  draw(clock);
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
function run() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
function stopTour() {
  state.touring = false;
  clearTimeout(idle);
  if (!still.matches) idle = setTimeout(() => { state.touring = true; state.tourStage = "rise"; state.tourClock = 0; state.T = Math.min(state.T, 1); run(); }, 20000);
}
ui.slider.addEventListener("input", () => { stopTour(); state.T = tFromSlider(Number(ui.slider.value)); run(); });
ui.boxes.forEach((b) => b.addEventListener("click", () => choose(Number(b.dataset.container), false)));
ui.moods.forEach((b) => b.addEventListener("click", () => { stopTour(); state.alert = b.dataset.mood === "alert"; run(); }));
ui.play.addEventListener("click", () => {
  if (state.touring) { stopTour(); clearTimeout(idle); }
  else { state.touring = true; state.tourStage = "rise"; state.tourClock = 0; state.T = T_TOUR_FROM; }
  run();
});
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(svg);
state.phi = phiModel();
state.lever = -1;
draw(0);
run();
window.__cat = state;
window.__set = (o) => { Object.assign(state, o); state.touring = false; state.sled = -REL[state.active]; state.pending = state.active; state.switching = false; state.phi = o.phi ?? phiModel(); state.lever = state.alert ? 1 : -1; shown.key = ""; draw(0); };
