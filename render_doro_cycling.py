"""Render a 5-second, photo-style animation of the Doro plush riding a bicycle.

The look is "toy photography": a side-view plush (procedural fur, embroidered
eyes, stitched seams) on a small bicycle, filmed with a tracking camera on a
park path with a shallow depth of field.

Every pixel is procedural (NumPy / SciPy / Pillow). Expensive parts -- fur
sprites, the bike frame and the background plates -- are built once; each frame
only composites, rotates and scrolls them, and the result is piped to ffmpeg.

Usage:
    python3 render_doro_cycling.py [output.mp4]
"""
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

W, H = 1280, 720
FPS = 30
DURATION = 5
SS = 2                      # supersampling for sprites
GROUND = 630                # y where the tyres touch the path
HORIZON = 300               # perspective horizon for the path
SPEED = 9.0                 # path scroll at tyre depth, px per frame
TW = 2560                   # width of the tileable background plates

LIGHT = np.array([0.35, -0.62, 0.70])
LIGHT /= np.linalg.norm(LIGHT)

PINK = (250, 172, 196)
PINK_STITCH = (190, 95, 138)
WHITE = (250, 246, 243)


# ======================================================================= utils

def gnoise(shape, sigma, seed, wrap=False):
    rng = np.random.default_rng(seed)
    n = rng.standard_normal(shape).astype(np.float32)
    n = ndi.gaussian_filter(n, sigma, mode="wrap" if wrap else "reflect")
    return n / (n.std() + 1e-6)


def noise1d(n, sigma, seed):
    rng = np.random.default_rng(seed)
    v = ndi.gaussian_filter1d(rng.standard_normal(n), sigma, mode="wrap")
    return v / (v.std() + 1e-6)


def catmull(points, closed=True, n=12):
    """Smooth a polygon / polyline through its control points."""
    pts = list(points)
    if closed:
        pts = [pts[-1]] + pts + [pts[0], pts[1]]
    else:
        pts = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t
                                    + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
                             for j in range(2)))
    if not closed:
        out.append(pts[-2])
    return out


def to_img(rgb, a=None):
    rgb = np.clip(rgb * 255, 0, 255).astype(np.uint8)
    if a is None:
        return Image.fromarray(rgb, "RGB")
    a = np.clip(a * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, a]), "RGBA")


# ============================================================ plush rendering

class Plush:
    """A premultiplied float canvas that fur pieces are layered onto.

    Local coordinates are in `unit` pixels relative to an origin; the canvas
    covers [x0, x1] x [y0, y1] in local units and is SS-times supersampled.
    """

    def __init__(self, x0, y0, x1, y1, unit):
        self.x0, self.y0, self.unit = x0, y0, unit
        self.w = int(round((x1 - x0) * unit * SS))
        self.h = int(round((y1 - y0) * unit * SS))
        self.rgb = np.zeros((self.h, self.w, 3), np.float32)
        self.a = np.zeros((self.h, self.w), np.float32)
        self.shade = np.ones((self.h, self.w), np.float32)

    def P(self, x, y):
        return ((x - self.x0) * self.unit * SS, (y - self.y0) * self.unit * SS)

    def px(self, v):
        return v * self.unit * SS

    def mask(self, draw_fn):
        img = Image.new("L", (self.w, self.h), 0)
        draw_fn(ImageDraw.Draw(img), self.P)
        return np.asarray(img, np.float32) / 255

    def polar_noise(self, crown, seed):
        """Fur strands radiating from a crown point (hair grows outwards)."""
        base = gnoise((700, 2200), (2.5, 0.9), seed, wrap=True)
        cx, cy = self.P(*crown)
        yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        r = np.hypot(xx - cx, yy - cy)
        th = np.arctan2(yy - cy, xx - cx)
        u = (th + np.pi) / (2 * np.pi) * 2200
        v = np.clip(r * 0.9, 0, 699)
        return ndi.map_coordinates(base, [v, u], order=1, mode="wrap")

    def fur(self, m, color, vol, seed, crown=None, stitches=None,
            shadow=0.35, fuzz=0.5, brightness=1.0, pile=0.07):
        """Layer one plush piece (mask m) on the canvas with fur + shading."""
        mb = ndi.gaussian_filter(m, 1.2)
        if crown is not None:
            fn = self.polar_noise(crown, seed)
        else:
            fn = gnoise(m.shape, (2.0, 1.4), seed)          # short minky pile
        clump = gnoise(m.shape, 6, seed + 7)

        band = np.clip(4 * mb * (1 - mb), 0, 1)
        alpha = np.clip((mb - 0.5) * 3.0 + 0.5 + fuzz * fn * band, 0, 1)

        # Pseudo-3D normal from a blurred silhouette -> soft, stuffed volume.
        hgt = ndi.gaussian_filter(m, self.px(vol))
        gy, gx = np.gradient(hgt)
        g = np.hypot(gx, gy)
        k = 2.4 / (np.percentile(g[m > 0.5], 97) + 1e-6)
        nx, ny, nz = -gx * k, -gy * k, np.ones_like(gx)
        nl = np.sqrt(nx * nx + ny * ny + nz * nz)
        lam = np.clip((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl, 0, 1)
        shade = (0.6 + 0.46 * lam) * brightness

        tex = 1 + pile * fn + 0.5 * pile * clump
        rgb = (np.array(color, np.float32) / 255)[None, None, :] * (shade * tex)[..., None]
        rgb += (0.5 * pile * np.clip(fn, 0, None) * lam)[..., None]     # sheen on fur tips

        if stitches is not None:
            ls = ndi.gaussian_filter(stitches, 0.9)
            sc = np.array(PINK_STITCH, np.float32) / 255
            dent = ndi.gaussian_filter(stitches, 3.0)               # pile pulled into seam
            rgb *= (1 - 0.15 * dent)[..., None]
            rgb = rgb * (1 - 0.45 * ls[..., None]) + (sc * shade[..., None]) * 0.45 * ls[..., None]

        if shadow:
            sh = ndi.gaussian_filter(ndi.shift(alpha, (self.px(0.035), -self.px(0.02)), order=1),
                                     self.px(0.05))
            self.rgb *= (1 - shadow * sh)[..., None]

        self.rgb = rgb * alpha[..., None] + self.rgb * (1 - alpha[..., None])
        self.a = alpha + self.a * (1 - alpha)
        self.shade = np.where(alpha > 0.5, shade, self.shade)
        return shade

    def embroider(self, m, color, angle=0.6, raised=True, gloss=0.0):
        """Satin-stitch embroidery: flat thread colour, stitch striping, slight relief."""
        m = ndi.gaussian_filter(m, 0.6)
        yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        stripe = np.sin((xx * math.cos(angle) + yy * math.sin(angle)) * 1.7)
        base = np.array(color, np.float32) / 255
        shade = 0.82 + 0.25 * self.shade
        rgb = base[None, None, :] * (shade * (0.94 + 0.06 * stripe))[..., None]
        if gloss:
            rgb += gloss * np.clip(stripe, 0, 1)[..., None] * 0.15
        if raised:
            edge = ndi.gaussian_filter(m, 1.5)
            rgb *= (0.85 + 0.15 * edge)[..., None]
            sh = ndi.gaussian_filter(ndi.shift(m, (2, 1), order=1), 1.5)
            self.rgb *= (1 - 0.25 * sh * (1 - m))[..., None]
        self.rgb = rgb * m[..., None] + self.rgb * (1 - m[..., None])
        self.a = np.maximum(self.a, m)

    def tint(self, m, color, strength):
        c = np.array(color, np.float32) / 255
        w = (m * strength)[..., None]
        self.rgb = self.rgb * (1 - w) + (c * self.shade[..., None] * self.a[..., None]) * w

    def image(self):
        a = np.clip(self.a, 1e-4, 1)
        img = to_img(self.rgb / a[..., None], self.a)
        return img.resize((self.w // SS, self.h // SS), Image.LANCZOS)


def build_head(R, blink=False):
    """Side view (facing right) of the Doro plush head. Returns (img, anchor)."""
    c = Plush(-1.3, -1.8, 1.32, 1.3, R)
    crown = (0.05, -0.95)

    def poly(points, smooth=True):
        p = catmull(points) if smooth else points
        return lambda d, P: d.polygon([P(*q) for q in p], fill=255)

    def stitch(lines, width=3):
        def fn(d, P):
            for ln in lines:
                d.line([P(*q) for q in catmull(ln, closed=False)], fill=255, width=width,
                       joint="curve")
        return c.mask(fn)

    # ahoge: a tapered tuft that curls forward at the tip
    spine = catmull([(0.0, -0.8), (0.03, -1.2), (0.1, -1.5), (0.28, -1.62),
                     (0.4, -1.5), (0.33, -1.38), (0.22, -1.42)], closed=False, n=10)
    left, right = [], []
    for i in range(len(spine)):
        a = spine[max(i - 1, 0)]
        b = spine[min(i + 1, len(spine) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = -ty / ln, tx / ln
        wdt = 0.11 * (1 - 0.7 * i / (len(spine) - 1))
        left.append((spine[i][0] + nx * wdt, spine[i][1] + ny * wdt))
        right.append((spine[i][0] - nx * wdt, spine[i][1] - ny * wdt))
    c.fur(c.mask(poly(left + right[::-1], smooth=False)), PINK, 0.08, 11,
          crown=(0.0, -0.8), shadow=0)

    # pointy "cat ear" hair tuft on top
    c.fur(c.mask(poly([(0.25, -0.86), (0.38, -1.06), (0.52, -0.84)], smooth=False)),
          PINK, 0.1, 12, crown=crown, shadow=0)

    # main hair volume
    hair_lines = stitch([[(0.05, -0.95), (-0.45, -0.6), (-0.8, 0.0), (-0.75, 0.55)],
                         [(0.05, -0.95), (-0.15, -0.3), (-0.3, 0.4), (-0.35, 0.85)]])
    c.fur(c.mask(lambda d, P: d.ellipse([P(-1.0, -1.0), P(1.0, 0.96)], fill=255)),
          PINK, 0.5, 13, crown=crown, stitches=hair_lines, shadow=0.25)

    # face: protrudes a little in front of / below the hair sphere
    c.fur(c.mask(lambda d, P: d.ellipse([P(0.02, -0.16), P(1.08, 1.0)], fill=255)),
          WHITE, 0.34, 15, shadow=0.3, fuzz=0.3, pile=0.035, brightness=1.08)

    # side hair falling behind the cheek (hides the back edge of the face)
    sphere = c.mask(lambda d, P: d.ellipse([P(-1.0, -1.0), P(1.0, 0.96)], fill=255))
    side = c.mask(poly([(0.3, -0.6), (0.2, -0.05), (0.14, 0.5), (0.1, 0.98), (-1.2, 1.1),
                        (-1.2, -0.6)]))
    c.fur(np.minimum(side, sphere), PINK, 0.3, 19, crown=crown, shadow=0.3)

    # white ear (behind the side lock)
    c.fur(c.mask(lambda d, P: d.ellipse([P(0.03, 0.18), P(0.3, 0.55)], fill=255)),
          WHITE, 0.08, 14, pile=0.035, brightness=1.05)

    # blush: felt-like soft patch + three short stitches
    blush = ndi.gaussian_filter(
        c.mask(lambda d, P: d.ellipse([P(0.62, 0.5), P(0.86, 0.64)], fill=255)), c.px(0.03))
    c.tint(blush, (250, 150, 168), 0.65)
    bl = stitch([[(0.66, 0.6), (0.69, 0.53)], [(0.72, 0.61), (0.75, 0.54)],
                 [(0.78, 0.61), (0.81, 0.54)]], width=3)
    c.tint(ndi.gaussian_filter(bl, 0.8), (225, 105, 135), 0.8)

    # embroidered eye (seen from the side: narrow, tall oval)
    ex, ey, erx, ery = 0.84, 0.28, 0.105, 0.2
    if not blink:
        c.embroider(c.mask(lambda d, P: d.ellipse([P(ex - erx, ey - ery), P(ex + erx, ey + ery)],
                                                  fill=255)), (70, 40, 105))
        c.embroider(c.mask(lambda d, P: d.ellipse(
            [P(ex - erx * 0.78, ey - ery * 0.8), P(ex + erx * 0.78, ey + ery * 0.84)], fill=255)),
            (118, 78, 175), angle=1.2)
        c.embroider(c.mask(lambda d, P: d.chord(
            [P(ex - erx * 0.78, ey - ery * 0.8), P(ex + erx * 0.78, ey + ery * 0.84)],
            0, 180, fill=255)), (176, 140, 222), angle=1.2, raised=False)
        c.embroider(c.mask(lambda d, P: d.ellipse(
            [P(ex - erx * 0.4, ey - ery * 0.5), P(ex + erx * 0.4, ey + ery * 0.1)], fill=255)),
            (75, 45, 112), raised=False)
        c.embroider(c.mask(lambda d, P: d.ellipse(
            [P(ex - erx * 0.62, ey - ery * 0.62), P(ex - erx * 0.05, ey - ery * 0.22)], fill=255)),
            (252, 250, 252), angle=0.2, gloss=1.0)
        c.embroider(c.mask(lambda d, P: d.ellipse(
            [P(ex + erx * 0.15, ey + ery * 0.35), P(ex + erx * 0.45, ey + ery * 0.55)], fill=255)),
            (245, 240, 250), raised=False)
    else:
        c.embroider(stitch([[(ex - erx, ey + 0.02), (ex, ey + 0.07), (ex + erx, ey + 0.02)]],
                           width=7), (70, 40, 105))
    # eyelash: thick satin stitch over the eye, flicking backwards
    lash = catmull([(ex + erx * 1.05, ey - ery * 0.55), (ex, ey - ery * 1.08),
                    (ex - erx * 1.3, ey - ery * 0.8), (ex - erx * 2.0, ey - ery * 1.05)],
                   closed=False)
    c.embroider(c.mask(lambda d, P: d.line([P(*q) for q in lash], fill=255,
                                           width=int(c.px(0.06)), joint="curve")),
                (68, 36, 78), angle=0.1, gloss=0.6)

    # ":3" mouth stitch on the front of the face
    c.embroider(stitch([[(0.985, 0.5), (1.012, 0.53), (0.992, 0.56), (1.01, 0.6)]], width=4),
                (110, 60, 70), raised=False)

    # bangs over the forehead, jagged lower edge
    bangs = [(0.15, -0.75), (0.7, -0.68), (0.98, -0.35), (1.06, 0.02), (0.98, 0.06),
             (0.93, -0.02), (0.86, 0.08), (0.76, -0.04), (0.66, 0.12), (0.55, 0.0),
             (0.44, 0.14), (0.3, -0.05)]
    bang_lines = stitch([[(0.4, -0.6), (0.62, -0.25), (0.76, -0.04)],
                         [(0.6, -0.62), (0.85, -0.3), (0.93, -0.02)]])
    c.fur(c.mask(poly(bangs, smooth=False)), PINK, 0.18, 16, crown=crown,
          stitches=bang_lines, shadow=0.45)

    # flap of hair over the ear
    c.fur(c.mask(poly([(-0.12, -0.55), (0.12, -0.5), (0.0, -0.1), (-0.22, -0.18)])),
          PINK, 0.1, 17, crown=crown, shadow=0.35)

    # long side lock hanging in front of the cheek, ending in a point
    lock = [(0.22, -0.55), (0.45, -0.5), (0.52, 0.0), (0.6, 0.55), (0.66, 1.12),
            (0.5, 0.75), (0.34, 0.3), (0.24, -0.1)]
    lock_line = stitch([[(0.34, -0.45), (0.44, 0.1), (0.56, 0.75)]])
    c.fur(c.mask(poly(lock)), PINK, 0.12, 18, crown=crown, stitches=lock_line, shadow=0.45)

    return c.image(), (-c.x0 * R, -c.y0 * R)


def build_body():
    """Side view white plush body with the bunny tail. Anchor = body centre."""
    c = Plush(-95, -80, 80, 80, 1)
    body = catmull([(0, -66), (44, -50), (60, 0), (52, 48), (10, 68), (-40, 64),
                    (-60, 22), (-52, -36)])
    c.fur(c.mask(lambda d, P: d.polygon([P(*q) for q in body], fill=255)),
          WHITE, 34, 22, shadow=0, fuzz=0.35, pile=0.035, brightness=1.08)
    c.fur(c.mask(lambda d, P: d.ellipse([P(-86, 2), P(-44, 44)], fill=255)),
          WHITE, 12, 23, shadow=0.35, pile=0.035, brightness=1.08)                                    # bunny tail
    return c.image(), (95, 80)


def build_limb(length, width, brightness, seed):
    """A stubby plush limb pointing down (+y). Anchor = top cap centre."""
    half = length + width
    c = Plush(-half, -half, half, half, 1)
    c.fur(c.mask(lambda d, P: d.rounded_rectangle([P(-width / 2, -width / 2),
                                                   P(width / 2, length + width / 2)],
                                                  radius=int(c.px(width / 2)), fill=255)),
          WHITE, width * 0.45, seed, shadow=0, fuzz=0.35, brightness=brightness, pile=0.035)
    return c.image(), (half, half)


def paste_rot(layer, sprite, anchor, at, direction_deg):
    """Rotate a down-pointing limb sprite so it points along direction_deg."""
    img = sprite.rotate(90 - direction_deg, resample=Image.BICUBIC, center=anchor)
    layer.alpha_composite(img, (int(round(at[0] - anchor[0])), int(round(at[1] - anchor[1]))))


def paste_sub(layer, sprite, anchor, at):
    """Composite with sub-pixel placement (avoids jitter on slow bobbing)."""
    x, y = at[0] - anchor[0], at[1] - anchor[1]
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    w, h = sprite.size
    moved = sprite.transform((w + 1, h + 1), Image.AFFINE, (1, 0, -fx, 0, 1, -fy),
                             resample=Image.BICUBIC)
    layer.alpha_composite(moved, (ix, iy))


# ================================================================ bicycle

RW = (470, 558)
FW = (800, 558)
WR = 72
CRANK = (622, 552)
CR = 22
SEAT = (590, 470)
SEAT_CLUSTER = (597, 482)
HEAD_TOP = (752, 446)
HEAD_BOT = (763, 490)
GRIP = (713, 420)

PAINT = (126, 196, 190)      # vintage mint
CHROME = (205, 208, 212)

BX0, BY0, BX1, BY1 = 380, 360, 900, 650     # bike sprite bounds (world px)


def shade_col(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c)


def tube(d, a, b, w, col, P, light=(0.35, -0.62)):
    """A cylinder: stacked strokes shifted towards the light + specular line."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy) or 1
    nx, ny = -dy / ln, dx / ln
    if nx * light[0] + ny * light[1] < 0:
        nx, ny = -nx, -ny
    n = 7
    for i in range(n):
        t = i / (n - 1)
        off = w * 0.22 * t
        width = w * (1 - 0.7 * t)
        cc = shade_col(col, 0.55 + 0.6 * t)
        p1 = P(ax + nx * off, ay + ny * off)
        p2 = P(bx + nx * off, by + ny * off)
        d.line([p1, p2], fill=cc, width=max(1, int(width * SS)))
        r = width * SS / 2
        for p in (p1, p2):
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=cc)
    off = w * 0.28
    d.line([P(ax + nx * off, ay + ny * off), P(bx + nx * off, by + ny * off)],
           fill=(247, 247, 247), width=max(1, int(w * 0.14 * SS)))


def build_bike():
    img = Image.new("RGBA", ((BX1 - BX0) * SS, (BY1 - BY0) * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def P(x, y):
        return ((x - BX0) * SS, (y - BY0) * SS)

    # fenders
    for hub, a0, a1 in ((RW, 195, 330), (FW, 205, 340)):
        bb = [P(hub[0] - WR - 7, hub[1] - WR - 7), P(hub[0] + WR + 7, hub[1] + WR + 7)]
        d.arc(bb, a0, a1, fill=shade_col(PAINT, 0.7), width=9 * SS)
        bb2 = [P(hub[0] - WR - 9, hub[1] - WR - 9), P(hub[0] + WR + 9, hub[1] + WR + 9)]
        d.arc(bb2, a0 + 3, a1 - 3, fill=shade_col(PAINT, 1.1), width=3 * SS)
    for hub, sx in ((RW, -1), (FW, 1)):                        # fender stays
        d.line([P(*hub), P(hub[0] + sx * WR * 0.85, hub[1] - WR * 0.45)],
               fill=CHROME, width=2 * SS)

    # chain + chainring
    for off in (-14, 14):
        d.line([P(CRANK[0], CRANK[1] + off), P(RW[0], RW[1] + off * 0.55)],
               fill=(70, 70, 74), width=3 * SS)
    cx, cy = P(*CRANK)
    for i in range(32):
        a = i * 2 * math.pi / 32
        d.ellipse([cx + 16 * SS * math.cos(a) - 2 * SS, cy + 16 * SS * math.sin(a) - 2 * SS,
                   cx + 16 * SS * math.cos(a) + 2 * SS, cy + 16 * SS * math.sin(a) + 2 * SS],
                  fill=(150, 152, 158))
    d.ellipse([cx - 15 * SS, cy - 15 * SS, cx + 15 * SS, cy + 15 * SS], fill=(185, 188, 194))
    d.ellipse([cx - 9 * SS, cy - 9 * SS, cx + 9 * SS, cy + 9 * SS], fill=(150, 152, 158))

    # frame
    tube(d, RW, CRANK, 8, PAINT, P)
    tube(d, RW, SEAT_CLUSTER, 7, PAINT, P)
    tube(d, CRANK, HEAD_BOT, 11, PAINT, P)
    tube(d, SEAT_CLUSTER, HEAD_TOP, 10, PAINT, P)
    tube(d, CRANK, SEAT_CLUSTER, 10, PAINT, P)
    fork = catmull([HEAD_BOT, (775, 520), (790, 545), FW], closed=False, n=6)
    for a, b in zip(fork, fork[1:]):
        tube(d, a, b, 7, CHROME, P)
    tube(d, HEAD_TOP, HEAD_BOT, 13, shade_col(PAINT, 0.9), P)
    # chain guard
    guard = catmull([(CRANK[0] + 20, CRANK[1] - 20), (CRANK[0] - 40, CRANK[1] - 24),
                     (RW[0] + 40, RW[1] - 12), (RW[0] + 35, RW[1] - 2),
                     (CRANK[0] - 40, CRANK[1] - 10), (CRANK[0] + 12, CRANK[1] - 12)])
    d.polygon([P(*q) for q in guard], fill=shade_col(PAINT, 0.95))
    d.line([P(*q) for q in guard[:len(guard) // 2]], fill=shade_col(PAINT, 1.18), width=2 * SS)

    # seat post + saddle (brown leather with highlight)
    tube(d, SEAT_CLUSTER, (SEAT[0] - 1, SEAT[1] + 2), 6, CHROME, P)
    saddle = catmull([(SEAT[0] - 32, SEAT[1] - 6), (SEAT[0], SEAT[1] - 11),
                      (SEAT[0] + 26, SEAT[1] - 4), (SEAT[0] + 22, SEAT[1] + 4),
                      (SEAT[0] - 30, SEAT[1] + 5)])
    d.polygon([P(*q) for q in saddle], fill=(112, 70, 48))
    d.line([P(SEAT[0] - 26, SEAT[1] - 6), P(SEAT[0] + 16, SEAT[1] - 7)],
           fill=(170, 120, 88), width=3 * SS)

    # stem, bar, grip, bell
    stem_top = (HEAD_TOP[0] - 3, HEAD_TOP[1] - 30)
    tube(d, HEAD_TOP, stem_top, 7, CHROME, P)
    bar = catmull([stem_top, (735, 412), (722, 418), GRIP], closed=False, n=5)
    for a, b in zip(bar, bar[1:]):
        tube(d, a, b, 6, CHROME, P)
    tube(d, (GRIP[0] + 4, GRIP[1]), (GRIP[0] - 12, GRIP[1] + 2), 11, (120, 78, 52), P)
    bx, by = P(stem_top[0] + 6, stem_top[1] + 4)
    d.ellipse([bx - 6 * SS, by - 6 * SS, bx + 6 * SS, by + 6 * SS], fill=(215, 205, 150))
    d.ellipse([bx - 3 * SS, by - 4 * SS, bx + 1 * SS, by], fill=(250, 245, 215))

    # front rack + wicker basket with flowers
    tube(d, (FW[0] + 6, FW[1] - 20), (812, 450), 3, CHROME, P)
    bx0, by0, bx1, by1 = 772, 392, 852, 450
    d.polygon([P(bx0, by0), P(bx1, by0), P(bx1 - 6, by1), P(bx0 + 6, by1)], fill=(170, 125, 78))
    rng = np.random.default_rng(5)
    for row in range(8):
        y = by0 + 4 + row * 6.5
        for col in range(11):
            x = bx0 + 3 + col * 7.4 + (3.7 if row % 2 else 0)
            if x > bx1 - 4 - row * 0.8 or x < bx0 + 3 + row * 0.8:
                continue
            tone = 0.85 + 0.3 * rng.random()
            d.ellipse([P(x - 3.4, y - 2.6), P(x + 3.4, y + 2.6)],
                      fill=shade_col((205, 160, 105), tone))
    tube(d, (bx0 - 1, by0), (bx1 + 1, by0), 5, (190, 145, 92), P)
    for fx, fy, col in ((788, 380, (252, 176, 200)), (808, 372, (255, 252, 246)),
                        (828, 382, (196, 166, 236)), (843, 388, (255, 214, 120))):
        d.line([P(fx, fy), P(fx + 2, by0 + 2)], fill=(92, 140, 70), width=3 * SS)
        for k in range(6):
            a = k * math.pi / 3
            d.ellipse([P(fx + 6 * math.cos(a) - 5, fy + 6 * math.sin(a) - 5),
                       P(fx + 6 * math.cos(a) + 5, fy + 6 * math.sin(a) + 5)],
                      fill=shade_col(col, 0.92 + 0.1 * (k % 2)))
        d.ellipse([P(fx - 3, fy - 3), P(fx + 3, fy + 3)], fill=(240, 196, 80))
    d.ellipse([P(800, 388), P(818, 398)], fill=(110, 160, 80))   # leaves
    d.ellipse([P(822, 390), P(838, 399)], fill=(96, 148, 72))

    return img.resize((BX1 - BX0, BY1 - BY0), Image.LANCZOS)


def build_wheel():
    size = (WR + 6) * 2
    img = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size * SS / 2

    def circ(r, **kw):
        d.ellipse([c - r * SS, c - r * SS, c + r * SS, c + r * SS], **kw)

    # tyre: dark rubber with a rounded profile and tread
    for r, col in ((WR + 1, (34, 34, 36)), (WR - 1, (50, 50, 54)), (WR - 3, (40, 40, 43)),
                   (WR - 6, (30, 30, 32))):
        circ(r, fill=col)
    for i in range(90):
        a = i * 2 * math.pi / 90
        r0, r1 = (WR - 0.5) * SS, (WR + 1) * SS
        d.line([(c + r0 * math.cos(a), c + r0 * math.sin(a)),
                (c + r1 * math.cos(a + 0.02), c + r1 * math.sin(a + 0.02))],
               fill=(22, 22, 24), width=SS)
    # chrome rim
    circ(WR - 7, fill=(170, 172, 178))
    circ(WR - 8, fill=(225, 227, 232))
    circ(WR - 10, fill=(150, 152, 158))
    circ(WR - 11, fill=(0, 0, 0, 0))
    # laced spokes
    for i in range(28):
        a = i * 2 * math.pi / 28
        side = 1 if i % 2 else -1
        h = a + side * 0.35
        hx, hy = c + 8 * SS * math.cos(h), c + 8 * SS * math.sin(h)
        d.line([(hx, hy), (c + (WR - 10) * SS * math.cos(a), c + (WR - 10) * SS * math.sin(a))],
               fill=(196, 198, 204), width=max(1, int(1.1 * SS)))
    circ(11, fill=(150, 152, 158))
    circ(9, fill=(214, 216, 222))
    circ(4, fill=(120, 122, 128))
    d.rectangle([c + 18 * SS, c - 3 * SS, c + 30 * SS, c + 3 * SS], fill=(240, 140, 40))
    return img.resize((size, size), Image.LANCZOS)


def wheel_frame(wheel, ang):
    """Rotated wheel with a little rotational motion blur."""
    deg = -math.degrees(ang)
    acc = None
    for k in range(3):
        r = np.asarray(wheel.rotate(deg + k * 2.2, resample=Image.BICUBIC), np.float32)
        acc = r if acc is None else acc + r
    return Image.fromarray((acc / 3).astype(np.uint8), "RGBA")


def draw_crank(layer, ang, near):
    pad = CR + 16
    img = Image.new("RGBA", (pad * 2 * SS, pad * 2 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def P(x, y):
        return ((x + pad) * SS, (y + pad) * SS)

    px, py = CR * math.cos(ang), CR * math.sin(ang)
    tube(d, (0, 0), (px, py), 6, CHROME if near else shade_col(CHROME, 0.75), P)
    d.rounded_rectangle([P(px - 11, py - 4), P(px + 11, py + 4)], radius=3 * SS,
                        fill=(40, 40, 44) if near else (30, 30, 33))
    d.ellipse([P(-5, -5), P(5, 5)], fill=(120, 122, 128))
    img = img.resize((pad * 2, pad * 2), Image.LANCZOS)
    layer.alpha_composite(img, (CRANK[0] - pad, CRANK[1] - pad))
    return CRANK[0] + px, CRANK[1] + py


# ============================================================== background

def build_far():
    """Sunny park treeline + lawn, out of focus (shallow depth of field)."""
    h = 600
    yy = np.arange(h, dtype=np.float32)[:, None]
    sky_t = np.clip(yy / 320, 0, 1)[..., None]
    sky = (np.array([128, 172, 220], np.float32) * (1 - sky_t)
           + np.array([226, 234, 240], np.float32) * sky_t) / 255
    img = np.broadcast_to(sky, (h, TW, 3)).copy()

    top = 150 + 60 * noise1d(TW, 140, 1)[None, :] + 22 * noise1d(TW, 22, 2)[None, :]
    n2 = gnoise((h, TW), 7, 3, wrap=True)
    fol = (yy > top + 22 * n2).astype(np.float32)
    holes = gnoise((h, TW), 3.5, 4, wrap=True)
    fol *= (holes < 1.9 - 0.6 * np.clip((yy - top) / 200, 0, 1))
    leaf = gnoise((h, TW), 4, 5, wrap=True)
    leaf2 = gnoise((h, TW), 16, 6, wrap=True)
    sun = np.clip(1 - (yy - top) / 260, 0, 1) * 0.6 + 0.25 * leaf2 + 0.25 * leaf

    dark, mid, light = (np.array(v, np.float32) / 255 for v in
                        ((38, 72, 38), (88, 132, 58), (176, 200, 98)))
    pdark, pmid, plight = (np.array(v, np.float32) / 255 for v in
                           ((190, 120, 148), (236, 176, 198), (255, 226, 236)))
    cherry = (noise1d(TW, 160, 7) > 0.55)[None, :].astype(np.float32)
    cherry = ndi.gaussian_filter1d(cherry, 20, axis=1, mode="wrap")
    s = np.clip(sun, 0, 1)[..., None]
    lo, hi = np.clip(s / 0.5, 0, 1), np.clip((s - 0.5) / 0.5, 0, 1)
    green = np.where(s < 0.5, dark + (mid - dark) * lo, mid + (light - mid) * hi)
    pink = np.where(s < 0.5, pdark + (pmid - pdark) * lo, pmid + (plight - pmid) * hi)
    foliage = green * (1 - cherry[..., None]) + pink * cherry[..., None]
    img = img * (1 - fol[..., None]) + foliage * fol[..., None]

    # shaded understory with tree trunks
    under = (yy > 400 + 30 * noise1d(TW, 60, 8)[None, :]).astype(np.float32)[..., None]
    under_col = np.array([52, 74, 48], np.float32) / 255 * (0.9 + 0.1 * leaf2[..., None])
    img = img * (1 - under * 0.85) + under_col * under * 0.85
    rng = np.random.default_rng(9)
    for _ in range(14):
        x = rng.integers(0, TW)
        wdt = rng.integers(10, 24)
        cols = (np.arange(TW)[None, :] - x) % TW
        m = ((cols < wdt) & (yy > 300 + rng.integers(0, 80))).astype(np.float32)[..., None]
        img = img * (1 - m) + np.array([62, 50, 44], np.float32) / 255 * m

    # far lawn in sunlight
    lawn_top = 470 + 6 * noise1d(TW, 40, 10)[None, :]
    lawn = np.clip((yy - lawn_top) / 4, 0, 1)[..., None]
    grass = (np.array([104, 148, 70], np.float32) / 255) * (
        0.88 + 0.1 * gnoise((h, TW), (6, 14), 11, wrap=True)[..., None]
        + 0.1 * np.clip((yy - 470) / 130, 0, 1)[..., None])
    img = img * (1 - lawn) + grass * lawn

    img = ndi.gaussian_filter(img, (9, 9, 0), mode=("nearest", "wrap", "nearest"))

    # bokeh discs where sunlight pokes through the leaves
    glow = Image.new("RGB", (TW, h), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    hy, hx = np.nonzero((holes > 1.9) & (yy > top + 30) & (yy < 380))
    pick = rng.choice(len(hx), size=min(220, len(hx)), replace=False)
    for i in pick:
        r = rng.uniform(5, 15)
        tone = rng.uniform(0.25, 0.6)
        col = tuple(int(255 * tone * k) for k in (1.0, 0.96, 0.82))
        for ox in (-TW, 0, TW):
            gd.ellipse([hx[i] + ox - r, hy[i] - r, hx[i] + ox + r, hy[i] + r], fill=col)
    g = np.asarray(glow.filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255
    img = 1 - (1 - img) * (1 - g)       # screen blend
    return img.astype(np.float32)


def build_lawn():
    """Mid-ground lawn strip with flowers (y 470..590), slightly out of focus. RGBA."""
    y0, h = 470, 120
    yy = np.arange(h, dtype=np.float32)[:, None] + y0
    blades = gnoise((h, TW), (5, 0.7), 21, wrap=True)
    top = 520 + 5 * noise1d(TW, 30, 20)[None, :]
    bottom = 566 + 3 * noise1d(TW, 8, 24)[None, :]
    alpha = (np.clip((yy - top) / 6 + 0.35 * blades, 0, 1)
             * np.clip((bottom - yy) / 3 + 0.9 * blades, 0, 1))
    depth = np.clip((yy - 520) / 50, 0, 1)
    col = (np.array([92, 134, 66], np.float32) / 255) * (
        0.88 + 0.06 * blades[..., None] + 0.18 * (1 - depth[..., None]))
    img = to_img(col)
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(22)
    for _ in range(90):                       # dandelions / clover / daisies
        x = rng.uniform(0, TW)
        y = rng.uniform(530, 560) - y0
        r = rng.uniform(2.5, 5)
        fc = [(255, 226, 90), (252, 252, 246), (250, 190, 210)][rng.integers(0, 3)]
        for ox in (-TW, 0, TW):
            d.ellipse([x + ox - r, y - r, x + ox + r, y + r], fill=fc)
    rgb = np.asarray(img, np.float32) / 255
    rgb = ndi.gaussian_filter(rgb, (2.6, 2.6, 0), mode=("nearest", "wrap", "nearest"))
    rgb = ndi.uniform_filter1d(rgb, 4, axis=1, mode="wrap")        # motion blur
    alpha = ndi.uniform_filter1d(ndi.gaussian_filter(alpha, 1.8, mode="wrap"), 4, axis=1,
                                 mode="wrap")
    return rgb.astype(np.float32), alpha.astype(np.float32), y0


def build_path():
    """Concrete park path in 'ground space' (+ petals). Rows map to screen rows."""
    y0 = 560
    h = H - y0
    rng = np.random.default_rng(30)
    grain = gnoise((h, TW), 0.6, 31, wrap=True)
    patch = gnoise((h, TW), 10, 32, wrap=True)
    stain = gnoise((h, TW), 40, 33, wrap=True)
    base = np.array([182, 174, 164], np.float32) / 255
    rgb = base * (1 + 0.07 * grain + 0.035 * patch + 0.03 * stain)[..., None]
    peb = (gnoise((h, TW), 0.8, 34, wrap=True) > 2.6).astype(np.float32)
    rgb = rgb * (1 - 0.18 * peb[..., None])
    for x in range(0, TW, 380):              # expansion joints
        rgb[:, x:x + 2] *= 0.72
    img = to_img(rgb)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 694 - y0, TW, 701 - y0], fill=(232, 230, 222))    # painted edge line
    for _ in range(260):                     # fallen cherry petals
        x = rng.uniform(0, TW)
        y = rng.uniform(4, h - 4)
        r = rng.uniform(1.6, 3.2)
        tone = rng.uniform(0.85, 1.0)
        pc = tuple(int(v * tone) for v in (250, 196, 212))
        for ox in (-TW, 0, TW):
            d.ellipse([x + ox - r * 1.4, y - r, x + ox + r * 1.4, y + r], fill=pc)
    rgb = np.asarray(img, np.float32) / 255
    yy = np.arange(h, dtype=np.float32)[:, None, None]
    rgb *= 0.8 + 0.2 * np.clip(yy / 18, 0, 1)                      # grass verge shade
    rgb = ndi.uniform_filter1d(rgb, 5, axis=1, mode="wrap")          # motion blur
    soft = ndi.gaussian_filter(rgb, (0, 3, 0), mode="wrap")
    return rgb.astype(np.float32), soft.astype(np.float32), y0


# =================================================================== scene

class Scene:
    def __init__(self):
        print("building background...", flush=True)
        self.far = build_far()
        self.lawn_rgb, self.lawn_a, self.lawn_y0 = build_lawn()
        self.path, self.path_soft, self.path_y0 = build_path()
        ys = np.arange(self.path_y0, H, dtype=np.float32)
        self.row_scale = (ys - HORIZON) / (GROUND - HORIZON)
        self.row_dof = np.clip(np.abs(ys - GROUND) / 70, 0, 1)[:, None, None].astype(np.float32)
        print("building plush + bike...", flush=True)
        self.head, self.head_anchor = build_head(118)
        self.head_blink, _ = build_head(118, blink=True)
        self.body, self.body_anchor = build_body()
        self.thigh = build_limb(46, 40, 1.08, 41)
        self.shin = build_limb(46, 38, 1.08, 42)
        self.thigh_far = build_limb(46, 40, 0.86, 43)
        self.shin_far = build_limb(46, 38, 0.86, 44)
        self.arm = build_limb(70, 34, 1.08, 45)
        self.arm_far = build_limb(70, 34, 0.84, 46)
        self.bike = build_bike()
        self.wheel = build_wheel()
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
        self.vignette = (1 - 0.28 * np.clip(r - 0.45, 0, 1) ** 1.5)[..., None]

    def background(self, scroll):
        img = np.empty((H, W, 3), np.float32)
        xs = (np.arange(W) + int(scroll * 0.22)) % TW
        img[:600] = self.far[:, xs]
        img[600:] = self.far[599:600, xs]
        # path rows in perspective: nearer rows move faster and look bigger
        y0 = self.path_y0
        cols = ((np.arange(W, dtype=np.float32)[None, :] - W / 2) / self.row_scale[:, None]
                + W / 2 + scroll).astype(np.int64) % TW
        rows = np.arange(H - y0)[:, None]
        img[y0:] = (self.path[rows, cols] * (1 - self.row_dof)
                    + self.path_soft[rows, cols] * self.row_dof)
        # mid lawn on top; its grass blades overhang the far edge of the path
        xs = (np.arange(W) + int(scroll * 0.8)) % TW
        ly = self.lawn_y0
        a = self.lawn_a[:, xs][..., None]
        h = a.shape[0]
        img[ly:ly + h] = img[ly:ly + h] * (1 - a) + self.lawn_rgb[:, xs] * a
        return img

    def foreground(self, f, t):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        wheel_ang = f * SPEED / WR
        crank_ang = wheel_ang * 0.62
        bob = 2.2 * math.sin(crank_ang * 2)

        far_foot = draw_crank(layer, crank_ang + math.pi, False)
        self.leg(layer, (592, 452 + bob), far_foot, self.thigh_far, self.shin_far)

        layer.alpha_composite(wheel_frame(self.wheel, wheel_ang), (RW[0] - WR - 6, RW[1] - WR - 6))
        layer.alpha_composite(wheel_frame(self.wheel, wheel_ang + 0.7),
                              (FW[0] - WR - 6, FW[1] - WR - 6))
        layer.alpha_composite(self.bike, (BX0, BY0))

        self.arm_to(layer, (622, 392 + bob), self.arm_far)
        paste_sub(layer, self.body, self.body_anchor, (596, 410 + bob))
        near_foot = draw_crank(layer, crank_ang, True)
        self.leg(layer, (604, 456 + bob), near_foot, self.thigh, self.shin)

        head = self.head_blink if 2.38 < t % 2.6 < 2.5 else self.head
        tilt = 1.5 * math.sin(crank_ang * 2 + 0.6)
        ax, ay = self.head_anchor
        rot = head.rotate(tilt, resample=Image.BICUBIC, center=(ax, ay + 80))
        paste_sub(layer, rot, (ax, ay), (604, 262 + bob * 1.3))
        self.arm_to(layer, (632, 392 + bob), self.arm)
        return layer

    def leg(self, layer, hip, foot, thigh, shin):
        l1 = l2 = 46
        dx, dy = foot[0] - hip[0], foot[1] - hip[1]
        dist = min(math.hypot(dx, dy), l1 + l2 - 0.5)
        base = math.atan2(dy, dx)
        a = math.acos(max(-1, min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))))
        k = base - a                                   # knee bends forward
        knee = (hip[0] + l1 * math.cos(k), hip[1] + l1 * math.sin(k))
        paste_rot(layer, shin[0], shin[1], knee,
                  math.degrees(math.atan2(foot[1] - knee[1], foot[0] - knee[0])))
        paste_rot(layer, thigh[0], thigh[1], hip, math.degrees(k))

    def arm_to(self, layer, shoulder, arm):
        ang = math.degrees(math.atan2(GRIP[1] - shoulder[1], GRIP[0] - shoulder[0]))
        paste_rot(layer, arm[0], arm[1], shoulder, ang)

    def render(self, f):
        t = f / FPS
        bg = self.background(f * SPEED)
        fg = self.foreground(f, t)
        fga = np.asarray(fg, np.float32) / 255

        # cast shadow: squash the silhouette onto the path (sun high, front-right)
        small = fg.getchannel("A").resize((W // 4, H // 4), Image.BILINEAR)
        a_, b_ = 0.07, -0.18
        g = GROUND / 4
        coeffs = (1, -b_ / a_, b_ * (g + 1) / a_, 0, -1 / a_, g + (g + 1) / a_)
        sh = small.transform(small.size, Image.AFFINE, coeffs, resample=Image.BILINEAR)
        sh = sh.filter(ImageFilter.GaussianBlur(2.5)).resize((W, H), Image.BILINEAR)
        sh = np.asarray(sh, np.float32)[..., None] / 255
        yy = np.arange(H)[:, None]
        xx = np.arange(W)[None, :]
        contact = sum(np.exp(-(((xx - hub[0]) / 34.0) ** 2 + ((yy - GROUND - 2) / 4.0) ** 2))
                      for hub in (RW, FW))
        sh = np.clip(sh * 0.5 + contact[..., None] * 0.45, 0, 0.75)
        sh[:GROUND - 40] = 0
        bg *= 1 - sh

        img = bg * (1 - fga[..., 3:]) + fga[..., :3] * fga[..., 3:]

        # grade: bloom, warm balance, vignette, film grain
        bright = np.clip(img - 0.78, 0, None)
        bloom = np.asarray(to_img(bright).resize((W // 8, H // 8), Image.BILINEAR)
                           .filter(ImageFilter.GaussianBlur(4)).resize((W, H), Image.BILINEAR),
                           np.float32) / 255
        img = img + 0.6 * bloom
        img = img * np.array([1.03, 1.0, 0.96], np.float32)
        img *= self.vignette
        rng = np.random.default_rng(1000 + f)
        img += rng.normal(0, 0.012, (H, W, 1)).astype(np.float32)
        return to_img(img)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "doro_cycling.mp4"
    scene = Scene()
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow",
         "-movflags", "+faststart", out],
        stdin=subprocess.PIPE)
    for f in range(FPS * DURATION):
        proc.stdin.write(scene.render(f).tobytes())
    proc.stdin.close()
    proc.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
