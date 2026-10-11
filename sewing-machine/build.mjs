// Lockstitch: the lower half of a sewing-machine head, cut open. `node build.mjs [--light]`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, "..", ".claude", "skills", "anatomy");
const k = await import(join(SKILL, "kit", "iso-kit.mjs"));
const G = await import(join(SKILL, "kit", "lathe.mjs"));
const { kitScript } = await import(join(SKILL, "scripts", "inline-kit.mjs"));
const { M } = await import(join(HERE, "model.mjs"));

const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 640;
const HEIGHT = 680;

// World (mm): x along the bed, y toward the operator, z up; z = 0 is the plate top.
// Everything at x > 0 above the bed floor is cut away, so the hook and its drive show.
const FLOOR = { x: -32, y: -34, w: 74, d: 46, r: 4 };
const FLOOR_Z = [-40, -33];
const BED = { x0: -32, x1: 0, y0: -34, y1: 12, z0: -33, z1: -0.2 };
const SHAFT = { y: -21, z: -24, r: 2.5 }; // lower shaft, along x
const WHEEL = { x0: 44, x1: 50, r: 17 };
const C = M.hookC;
const HOOK_Z = [-15, -6.6];
const CASE_Z = [-13.5, M.caseTop];
const HEAD = { x: -9, y: -15, w: 18, d: 21, r: 2 };
const HEAD_Z = [62, 72];
const NEEDLE_CLIP_Z = -40; // the view grazes the bobbin case, so the needle shows all the way down

const P = k.fitProjection(
  [...k.boxCorners(FLOOR, -44, 0), ...k.boxCorners(HEAD, HEAD_Z[0], HEAD_Z[1]), [WHEEL.x1 + 2.6, SHAFT.y - WHEEL.r, SHAFT.z], [WHEEL.x1 + 2.6, SHAFT.y + WHEEL.r, SHAFT.z], [WHEEL.x1, SHAFT.y, SHAFT.z - WHEEL.r]],
  WIDTH,
  HEIGHT,
  { pad: 16, azimuth: 35, elevation: 34 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const Xaxis = (y, z) => G.frameOf([0, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const SF = Xaxis(SHAFT.y, SHAFT.z);
const slot = (name, extra = "") => `<g data-slot="${name}"${extra}></g>`;

// Rounded rectangle with a radius per corner: [x0y0, x1y0, x1y1, x0y1].
function box(x0, y0, x1, y1, radii, steps = 6) {
  const out = [];
  const corners = [
    [x0, y0, Math.PI, 1.5 * Math.PI],
    [x1, y0, 1.5 * Math.PI, 2 * Math.PI],
    [x1, y1, 0, 0.5 * Math.PI],
    [x0, y1, 0.5 * Math.PI, Math.PI],
  ];
  corners.forEach(([cx, cy, a0, a1], i) => {
    const r = radii[i];
    if (!r) return out.push([cx, cy]);
    const ox = cx + (i === 0 || i === 3 ? r : -r);
    const oy = cy + (i < 2 ? r : -r);
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      out.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
    }
  });
  return out;
}
const prism = (ring, z0, z1, bevel = 0) => k.extrude(ring, z0, z1 - z0, P, { bevel });

// ── base ───────────────────────────────────────────────────────────────
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(FLOOR, -44, 11, P)}"/>`];
  const feet = k.corners(FLOOR, 9).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  for (const [x, y] of feet) {
    out.push(S(k.cylinder(x, y, 4.6, -44, 1.2, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 3.6, -42.8, 2.8, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(FLOOR, FLOOR_Z[0], FLOOR_Z[1] - FLOOR_Z[0], P, 6, 0.6), { tone: "mid" }));
  // groove round the open floor, ending on the cut face of the bed
  out.push(L(k.onTop([[0, -31], [37.5, -31], [39, -29.5], [39, 8.5], [37.5, 10], [0, 10]], FLOOR_Z[1], P), { tone: "faint" }));
  const screws = [[36.5, -28.5], [36.5, 7]];
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.5, FLOOR_Z[1], P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, FLOOR_Z[1]])), { size: 0.5 }));
  // label plate on the floor
  const plate = { x: 14, y: 1.5, w: 20, d: 6.5, r: 1 };
  out.push(S(k.slabOf(plate, FLOOR_Z[1], 0.5, P, 3), { tone: "lo", crease: "none" }));
  out.push(k.faceTextSvg(k.topMatrix([24, 5.6], FLOOR_Z[1] + 0.5, P, "x"), "HOOK 2 : 1", { size: 2.3, tone: "mid", anchor: "middle" }));
  out.push(D([at([15.4, 4.75, FLOOR_Z[1] + 0.5]), at([32.6, 4.75, FLOOR_Z[1] + 0.5])], { size: 0.4 }));
  return out.join("");
}

// ── the bed casting, left of the cut ───────────────────────────────────
function bed() {
  const out = [];
  const lower = box(BED.x0, BED.y0, BED.x1, BED.y1, [4, 0, 0, 4]);
  out.push(S(prism(lower, BED.z0, -16), { tone: "mid", inner: L(k.ringSeam(lower, -27, P), { tone: "faint" }) }));
  // above z = -16 the casting is pocketed under the plate, where the hook runs
  const far = box(BED.x0, BED.y0, BED.x1, BED.y1, [4, 0, 0, 4]);
  const pocket = [...far.slice(0, far.length / 2), [0, -24], [-8, -24], [-8, 7], [0, 7], ...far.slice(far.length / 2)];
  out.push(S(k.extrude(pocket, -16, BED.z1 + 16, P, { convex: false, bevel: 0.6 }), { tone: "mid", inner: L(k.ringSeam(far, -4, P), { tone: "faint" }) }));
  // a slide-plate release button and two cover screws on the front of the bed
  out.push(S(G.disc(BED.y1, BED.y1 + 1.2, 1.8, G.frameOf([-16, 0, -9], [0, 1, 0], [1, 0, 0], [0, 0, 1]), P), { tone: "mid" }));
  out.push(D([at([-26, BED.y1, -21.5]), at([-6, BED.y1, -21.5])], { size: 0.5 }));
  out.push(L(k.pathOf([at([-8, -24, -16]), at([-8, 7, -16])]), { tone: "lo" }));
  const top = BED.z1;
  // groove round the bed top, ending on the cut
  out.push(L(k.onTop([[0, -31], [-27.5, -31], [-29, -29.5], [-29, 8.5], [-27.5, 10], [0, 10]], top, P), { tone: "faint" }));
  // plate recess
  out.push(L(k.onTop([[0, -27.6], [-21, -27.6], [-22.6, -26], [-22.6, 7], [-21, 8.6], [0, 8.6]], top, P), { tone: "lo" }));
  const screws = [[-26, -28.5], [-26, 7]];
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.5, top, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, top])), { size: 0.5 }));
  // the cut face carries the casting's wall line and the boss the lower shaft runs in
  out.push(L(k.pathOf([at([0, -34, -27]), at([0, 12, -27])]), { tone: "faint" }));
  out.push(D([at([0, -30, -30]), at([0, 8, -30])], { size: 0.45 }));
  return out.join("");
}

// ── lower shaft, gears, handwheel ──────────────────────────────────────
function shaftRun(s0, s1) {
  return S(G.disc(s0, s1, SHAFT.r, SF, P), { tone: "mid", crease: "none" });
}
function lowerShaftBack() {
  const out = [];
  out.push(S(G.disc(0, 2.2, 5.2, SF, P), { tone: "mid" }));
  out.push(D(G.dotsOf(SF, 2.2, 4, 4, P, { all: true, phase: 0.6 }), { size: 0.4 }));
  out.push(shaftRun(2.2, C[0] - 2.5));
  out.push(S(G.disc(C[0] - 2.5, C[0] + 2.5, 8, SF, P), { tone: "mid" }));
  out.push(L(G.circleOf(SF, C[0] + 2.5, 5.2, P), { tone: "faint" }));
  out.push(slot("lowerGear"));
  out.push(S(G.disc(C[0] + 2.5, C[0] + 4, 3.6, SF, P), { tone: "mid" }));
  out.push(shaftRun(C[0] + 4, 32));
  return out.join("");
}
function pillowBlock() {
  const out = [];
  const plan = { x: 32, y: SHAFT.y - 6, w: 6, d: 12, r: 1 };
  out.push(S(k.slabOf(plan, FLOOR_Z[1], 4, P, 3, 0.4), { tone: "lo" }));
  out.push(S(k.slabOf(k.insetPlan(plan, 0.8), FLOOR_Z[1] + 4, -19 - FLOOR_Z[1] - 4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(k.insetPlan(plan, 0.8), -24, P, 3), { tone: "faint" }) }));
  out.push(D([at([35, SHAFT.y - 3.5, -19]), at([35, SHAFT.y + 3.5, -19])], { size: 0.5 }));
  out.push(L(k.sideRing([38, SHAFT.y, SHAFT.z], 3.1, "x", P, 24), { tone: "lo" }));
  return out.join("");
}
function wheel() {
  const out = [];
  out.push(shaftRun(38, WHEEL.x0));
  out.push(S(G.disc(WHEEL.x0, WHEEL.x1, WHEEL.r, SF, P, { bevel: 0.5 }), { tone: "mid" }));
  out.push(slot("wheel"));
  out.push(L(G.circleOf(SF, WHEEL.x1, 13.6, P), { tone: "lo" }));
  out.push(S(G.disc(WHEEL.x1, WHEEL.x1 + 2.6, 5, SF, P), { tone: "mid" }));
  out.push(L(G.circleOf(SF, WHEEL.x1 + 2.6, 2.4, P), { tone: "lo" }));
  out.push(D([at([WHEEL.x1 + 2.6, SHAFT.y, SHAFT.z])], { size: 0.55, tone: "hi" }));
  return out.join("");
}

// ── hook, bobbin case, bobbin ──────────────────────────────────────────
function hookDrive() {
  const out = [];
  out.push(S(k.cylinder(C[0], C[1], 3.6, FLOOR_Z[1], 4, P, 24, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(C[0], C[1], 2, FLOOR_Z[1] + 4, -26.5 - FLOOR_Z[1] - 4, P, 20), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(C[0], C[1], 4, -26.5, 5, P, 32), { tone: "mid" }));
  out.push(slot("hookGear"));
  out.push(S(k.cylinder(C[0], C[1], 2, -21.5, 4.5, P, 20), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(C[0], C[1], 5, -17, 2, P, 32), { tone: "mid" }));
  return out.join("");
}
function hook() {
  const out = [];
  const seams = [-9.2, -12.4].map((z) => k.sideArc(C[0], C[1], M.hookR, z, P, 48)).join("");
  out.push(S(k.cylinder(C[0], C[1], M.hookR, HOOK_Z[0], HOOK_Z[1] - HOOK_Z[0], P, 72, 0.5), { tone: "mid", inner: L(seams, { tone: "faint" }) }));
  return out.join("");
}
function bobbinCase() {
  const out = [];
  out.push(S(k.cylinder(C[0], C[1], M.caseR, CASE_Z[0], CASE_Z[1] - CASE_Z[0], P, 64), { tone: "mid" }));
  out.push(L(k.ring(C[0], C[1], M.caseR - 0.7, M.caseTop, P, 64), { tone: "lo" }));
  // bobbin: top flange, wound thread showing through its four holes, hub
  out.push(S(k.cylinder(C[0], C[1], 9.3, -6.6, 0.5, P, 64), { tone: "hi", crease: "lo" }));
  const holes = [0, 1, 2, 3].map((i) => [C[0] + 5.4 * Math.cos(0.4 + (i * Math.PI) / 2), C[1] + 5.4 * Math.sin(0.4 + (i * Math.PI) / 2)]);
  out.push(holes.map(([x, y]) => `<path class="sw-wound" d="${k.ring(x, y, 1.5, -6.1, P, 20)}"/>`).join(""));
  out.push(L(holes.map(([x, y]) => k.ring(x, y, 1.5, -6.1, P, 20)).join(""), { tone: "lo" }));
  out.push(S(k.cylinder(C[0], C[1], 2.1, -6.1, 0.5, P, 24), { tone: "hi", crease: "lo" }));
  out.push(L(k.ring(C[0], C[1], 1, -5.6, P, 16), { tone: "lo" }));
  // tension leaf on the rim, with its screw, where the bobbin thread leaves the case
  const leaf = [];
  for (let a = 60; a <= 104; a += 4) leaf.push([C[0] + 10.3 * Math.cos((a * Math.PI) / 180), C[1] + 10.3 * Math.sin((a * Math.PI) / 180)]);
  for (let a = 104; a >= 60; a -= 4) leaf.push([C[0] + 8.2 * Math.cos((a * Math.PI) / 180), C[1] + 8.2 * Math.sin((a * Math.PI) / 180)]);
  out.push(S(prism(leaf, M.caseTop, M.caseTop + 0.45), { tone: "hi", crease: "lo" }));
  const screw = [C[0] + 9.2 * Math.cos((72 * Math.PI) / 180), C[1] + 9.2 * Math.sin((72 * Math.PI) / 180)];
  out.push(L(k.ring(screw[0], screw[1], 0.7, M.caseTop + 0.45, P, 12), { tone: "lo" }));
  out.push(D([at([screw[0], screw[1], M.caseTop + 0.45])], { size: 0.4 }));
  return out.join("");
}

// ── needle plate and cloth (left of the cut) ───────────────────────────
function plate() {
  const out = [];
  const ring = box(-22, -27, 0, 8, [2, 0, 0, 2]);
  out.push(S(prism(ring, M.plateBottom, 0, 0.4), { tone: "hi", crease: "lo" }));
  // seam guides at 10, 13 and 16 mm from the needle, each running edge to edge
  out.push(L([-16, -18.5, -20.5].map((x) => k.lineOnTop([x, -27], [x, 8], 0, P)).join(""), { tone: "lo" }));
  out.push(L(k.topTicks(-26, 8, 2, 5, -21.5, 0, [0.8, 1.4], P, "y").minor, { tone: "lo" }));
  const screws = [[-19.2, -24.2], [-19.2, 5.2]];
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.1, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.45 }));
  return out.join("");
}
function cloth() {
  const out = [];
  out.push(S(prism(box(-14.6, -34, 0, 12, [1, 0, 0, 1], 3), 0, 1), { tone: "lo" }));
  out.push(S(prism(box(-14, -34, 0, 12, [1, 0, 0, 1], 3), 1, M.clothTop), { tone: "lo" }));
  out.push(L([-3.5, -7, -10.5].map((x) => k.lineOnTop([x, -34], [x, 12], M.clothTop, P)).join(""), { tone: "faint" }));
  out.push(slot("weave"));
  return out.join("");
}

// ── feed dog (built at rest: y = 0, teeth top = 0) ─────────────────────
function teeth(x0, x1, upTo = 6) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const y = -5.2 + i * 1.8;
    if (y + 1.2 > upTo) break;
    out.push(S(prism([[x0, y], [x1, y], [x1, y + 1.2], [x0, y + 1.2]], -0.7, 0), { tone: "hi", crease: "lo" }));
  }
  return out.join("");
}
function dogLeft() {
  return [
    S(prism([[-4.4, -8], [0, -8], [0, -5.5], [-4.4, -5.5]], -3.2, -1.2), { tone: "mid" }),
    S(k.slabOf({ x: -4.4, y: -5.5, w: 2.6, d: 11, r: 0.4 }, -3.2, 2.5, P, 2), { tone: "mid" }),
    teeth(-4.2, -2),
  ].join("");
}
function dogBack() {
  return [
    S(k.slabOf({ x: 1.9, y: -30, w: 2.4, d: 22.4, r: 0.4 }, -3.0, 1.4, P, 2, 0.3), { tone: "mid" }),
    S(prism([[0, -8], [4.4, -8], [4.4, -5.5], [0, -5.5]], -3.2, -1.2), { tone: "mid" }),
    D([at([3.1, -12, -1.6]), at([3.1, -22, -1.6])], { size: 0.4 }),
  ].join("");
}
// The right rail is cut off at y = -2 so the needle and the catch stay in view; its cut face rides with the dog.
function dogRight() {
  return [S(prism(box(1.8, -5.5, 4.4, -2, [0.4, 0.4, 0, 0], 2), -3.2, -0.7), { tone: "mid" }), teeth(2, 4.2, -2)].join("");
}
function bracket() {
  const plan = { x: 0, y: -32.5, w: 6.4, d: 7, r: 0.8 };
  return [
    S(k.slabOf(plan, -8, 7.6, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, -4.6, P, 3), { tone: "faint" }) }),
    D([at([3.2, -31, -0.4]), at([3.2, -27, -0.4])], { size: 0.45 }),
  ].join("");
}

// ── presser foot and bar ───────────────────────────────────────────────
function footBack() {
  const out = [];
  out.push(S(k.cylinder(0, -10, 3, 12, 50, P, 24), { tone: "mid", crease: "none" }));
  out.push(L(k.sideArc(0, -10, 3, 20, P, 16), { tone: "faint" }));
  out.push(S(k.slabOf({ x: -2.4, y: -12.6, w: 4.8, d: 6.2, r: 0.8 }, 3.2, 10.8, P, 3, 0.4), { tone: "mid" }));
  out.push(S(G.disc(2.4, 4.6, 1.8, Xaxis(-9.5, 10.5), P), { tone: "mid" }));
  out.push(L(k.sideRing([4.6, -9.5, 10.5], 0.8, "x", P, 12), { tone: "lo" }));
  out.push(S(prism(box(-4.6, -7, 4.6, -2.6, [1.2, 1.2, 0, 0], 3), M.clothTop, M.clothTop + 1.2, 0.3), { tone: "hi", crease: "lo" }));
  out.push(D([at([-3.4, -4.8, M.clothTop + 1.2]), at([3.4, -4.8, M.clothTop + 1.2])], { size: 0.4 }));
  out.push(S(prism(box(-4.6, -2.6, -0.9, 6.8, [0, 0, 0.5, 2], 3), M.clothTop, M.clothTop + 1.2, 0.3), { tone: "hi", crease: "lo" }));
  return out.join("");
}
function footRight() {
  return S(prism(box(0.9, -2.6, 4.6, 6.8, [0, 0, 2, 0.5], 3), M.clothTop, M.clothTop + 1.2, 0.3), { tone: "hi", crease: "lo" });
}

// ── needle bar, clamp and needle (built with the eye at z = 0) ─────────
function needleBar() {
  const out = [];
  out.push(S(k.cylinder(0, 0, 3.5, 37, 42, P, 28), { tone: "mid", crease: "none" }));
  out.push(L(k.sideArc(0, 0, 3.5, 41, P, 20), { tone: "faint" }));
  const clamp = { x: -3.4, y: -3.4, w: 6.8, d: 6.8, r: 0.8 };
  out.push(S(k.slabOf(clamp, 29.8, 7.2, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(clamp, 33.4, P, 3), { tone: "faint" }) }));
  out.push(S(G.disc(3.4, 5.6, 1.6, Xaxis(-1.4, 33.4), P), { tone: "mid" }));
  out.push(L(G.ribsOf(Xaxis(-1.4, 33.4), 3.6, 5.6, 1.6, 14, P), { tone: "lo" }));
  out.push(S(G.disc(3.4, 4.2, 0.8, Xaxis(2, 31.6), P), { tone: "mid" }));
  // needle: shank, taper, blade, tip; the long groove carries the thread up from the eye
  out.push(S(k.cylinder(0, 0, 1, 20.6, 9.2, P, 20), { tone: "hi", crease: "lo" }));
  out.push(S(k.cylinder(0, 0, 0.7, 19.6, 1, P, 16), { tone: "hi", crease: "none" }));
  out.push(S(k.cylinder(0, 0, 0.45, -0.9, 20.5, P, 14), { tone: "hi", crease: "none" }));
  out.push(S(prism([[-0.45, 0], [0.45, 0], [0, 0.1], [0, -0.1]].map(([x, y]) => [x, y]), -1.5, -0.9), { tone: "hi", crease: "none" }));
  out.push(`<path class="sw-eye" d="${k.pathOf([at([0.46, 0, -0.5]), at([0.46, 0, 0.5])])}"/>`);
  out.push(L(k.pathOf([at([0.5, 0, 0.5]), at([0.5, 0, 19.6]), at([0.75, 0, 20.4]), at([1.05, 0, 21]), at([1.05, 0, 29.8]), at([3.4, 2, 29.8]), at([3.4, 2, 31.6])]), { tone: "red", className: "sw-thread" }));
  return out.join("");
}

function head() {
  const out = [];
  out.push(S(k.cylinder(0, -10, 4.4, 59.5, 2.5, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(0, 0, 5, 59, 3, P, 28), { tone: "mid" }));
  const inner = L(k.sideSeam(k.insetPlan(HEAD, 0), 68.5, P, 3), { tone: "faint" });
  out.push(S(k.slabOf(HEAD, HEAD_Z[0], HEAD_Z[1] - HEAD_Z[0], P, 3, 0.5), { tone: "mid", inner }));
  // the cut top: casting wall, shaft bores for the needle bar and presser bar
  out.push(L(k.planOutline(k.insetPlan(HEAD, 3), HEAD_Z[1], P, 3), { tone: "lo" }));
  out.push(L(k.ring(0, 0, 3.5, HEAD_Z[1], P, 24) + k.ring(0, -10, 3, HEAD_Z[1], P, 24), { tone: "mid" }));
  out.push(D([at([9, -12.5, 70.4]), at([9, 3.5, 70.4]), at([9, -12.5, 66.4]), at([9, 3.5, 66.4])], { size: 0.45 }));
  // thread guide on the face plate
  out.push(S(G.disc(9, 10.4, 0.9, Xaxis(2, 63.2), P), { tone: "mid" }));
  out.push(L(k.sideRing([10.4, 2, 63.2], 0.4, "x", P, 12), { tone: "lo" }));
  return out.join("");
}

const clipTop = at([0, 0, HEAD_Z[1] - 1])[1];
const clipBottom = at([0, 0, NEEDLE_CLIP_Z])[1];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A sewing-machine bed cut open under the needle. The needle carries the red upper thread down through the cloth; under the plate the rotary hook, turning twice per stitch, catches the loop and carries it round the bobbin case, so the blue bobbin thread is locked inside it. The take-up pulls the lock into the middle of the cloth, and the feed dog moves the cloth on by one stitch.",
  body: [
    `<defs><clipPath id="sw-needle-clip"><rect x="0" y="${clipTop.toFixed(1)}" width="${WIDTH}" height="${(clipBottom - clipTop).toFixed(1)}"/></clipPath></defs>`,
    base(),
    bed(),
    lowerShaftBack(),
    pillowBlock(),
    wheel(),
    hookDrive(),
    hook(),
    slot("hookTop"),
    slot("beakBack"),
    bobbinCase(),
    slot("beakFront"),
    `<g data-part="dogLeft">${dogLeft()}</g>`,
    plate(),
    cloth(),
    `<g data-part="dogBack">${dogBack()}</g>`,
    bracket(),
    footBack(),
    slot("threads"),
    `<g clip-path="url(#sw-needle-clip)"><g data-part="needle">${needleBar()}</g>${slot("needleThread")}</g>`,
    `<g data-part="dogRight">${dogRight()}</g>`,
    footRight(),
    head(),
    slot("headThread"),
  ],
});

const CSS = `
.sw-thread{stroke-width:1.15px}
.sw-wound{fill:var(--anatomy-blue);fill-opacity:.55;stroke:none}
.sw-eye{stroke:var(--anatomy-paper);stroke-width:.9px;stroke-linecap:round;fill:none}
.iso-stage{touch-action:none;cursor:grab;outline:none;user-select:none;-webkit-user-select:none}
.iso-stage[data-dragging]{cursor:grabbing}
.iso-stage:focus-visible{box-shadow:0 0 0 1px var(--anatomy-mid);border-radius:6px}
`;

const model = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const live = readFileSync(join(HERE, "live.js"), "utf8");
const config = `const P = ${JSON.stringify(P)};\nconst GEO = ${JSON.stringify({ SHAFT, WHEEL, C, HOOK_Z })};\n`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "锁式线迹",
  hint: "拖动手轮，一针一针地看",
  readout: "主轴 0° · 旋梭 0° · 送布",
  keys: [
    { mark: "red", label: "上线：穿过针眼，被针带到布下" },
    { mark: "blue", label: "底线：从梭芯引出" },
    { mark: "lit", label: "旋梭梭尖：主轴转一圈，它转两圈" },
  ],
  caption:
    "缝纫机机头下半部剖开，布料沿针迹线剖开。针把上线带到布下，回升约 1.8 mm 时上线在针旁形成线环；旋梭梭尖在主轴 205° 勾住线环，带着它绕过梭壳，把从梭芯引出的底线套在环里。挑线随后把线环收回，交点拉到两层布中间；针离开布料后，送布牙升起，把布送走一个针距（3 mm）。剖面上能看到每一针的上线和底线在布中间互锁。",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="缝纫机主轴：左右方向键转动手轮" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0">${svg}</div>`,
});

const name = theme === "light" ? "lockstitch-light.html" : "lockstitch.html";
const page = k.pageHtml({ title: "锁式线迹", theme, body, script: kitScript() + "\n" + model + "\n" + config + live }).replace("</style>", CSS + "</style>").replace('<html lang="en">', '<html lang="zh-CN">');
writeFileSync(join(HERE, name), page);
console.log("wrote", name, (page.length / 1024).toFixed(0) + " KB");
