// Lockstitch timing for one turn of the main shaft. Pure: no imports, inlined into the page as-is.
// Units are millimetres, z = 0 is the top of the needle plate, angles are degrees of main-shaft turn
// with 0 at needle top dead centre.

export const M = {
  crank: 15, // needle-bar crank radius: stroke 30 mm
  link: 50, // connecting rod
  eyeBDC: -9, // needle eye at bottom dead centre
  eyeToTip: 1.5,
  stitch: 3, // stitch length
  catchAt: 205, // hook point meets the loop 25° after bottom dead centre
  castOff: 290, // loop slides off the hook, take-up starts pulling
  setAt: 330, // stitch set in the middle of the cloth, feed starts
  feedSpan: 90, // feed runs 330° → 60°, while the needle is out of the cloth
  needle: [0, 0],
  hookC: [6.31, -9.01], // the needle sits at 125° on the hook, where the view grazes the bobbin case
  needleAt: 125,
  hookR: 13,
  caseR: 10.5,
  loopR: 11.4,
  caseTop: -5.5,
  clothTop: 2,
  plateBottom: -2.5,
  exitAt: 110, // where the bobbin thread leaves the case, around the hook centre
};

export const wrap = (a) => ((a % 360) + 360) % 360;
export const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function eyeAt(theta) {
  const t = (theta * Math.PI) / 180;
  const { crank: r, link: l } = M;
  return M.eyeBDC + r * Math.cos(t) + Math.sqrt(l * l - r * r * Math.sin(t) ** 2) - (l - r);
}

// 2:1 — the hook turns twice per stitch (clockwise from above); its point is at the needle at catchAt.
export const hookAt = (A) => M.needleAt - 2 * (A - M.catchAt);

// Cycle c starts when the stitch before it is set (θ = setAt); u runs 0 → 360 through it.
export function cycleOf(A) {
  const v = A + 360 - M.setAt;
  const c = Math.floor(v / 360);
  return { c, u: v - 360 * c };
}

// Needle tip under the cloth top: the needle is in the cloth.
const ENTER = (() => {
  let lo = 0, hi = 180;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (eyeAt(mid) - M.eyeToTip > M.clothTop) lo = mid; else hi = mid;
  }
  return hi;
})();
export const enterAt = ENTER;

export function stateOf(A) {
  const theta = wrap(A);
  const { c, u } = cycleOf(A);
  const L = M.stitch;
  const feed = ease(u / M.feedSpan);
  const fabric = -L * (c + feed); // world y shift of the cloth
  // feed dog: four-motion — up, back with the cloth, down, forward again under the plate
  let back;
  if (u < M.feedSpan) back = feed;
  else if (u < 120) back = 1;
  else if (u < 320) back = 1 - ease((u - 120) / 200);
  else back = 0;
  const w = u > 300 ? u - 360 : u;
  const up = ease((w + 25) / 25) * (1 - ease((w - M.feedSpan) / 25));
  const eye = eyeAt(theta);
  const inCloth = eye - M.eyeToTip < M.clothTop;
  const entered = theta >= ENTER && theta < M.setAt; // this cycle's hole exists
  let phase;
  if (u < M.feedSpan) phase = "feed";
  else if (theta < 180) phase = "down";
  else if (theta < M.catchAt) phase = "loop";
  else if (theta < M.castOff) phase = "hook";
  else phase = "take";
  return {
    A, theta, c, u, fabric, eye, inCloth, entered, phase,
    hook: wrap(hookAt(A)),
    dog: { y: L * (0.5 - back), top: -1.3 + 2.2 * up },
  };
}

export const PHASES = {
  feed: "送布",
  down: "下针",
  loop: "形成线环",
  hook: "勾线绕梭",
  take: "收线锁紧",
};
