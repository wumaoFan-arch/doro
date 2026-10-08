"""Render a 5-second animation of Doro riding a bicycle.

Every frame is drawn procedurally with Pillow (2x supersampled, then
downscaled for smooth edges) and piped to ffmpeg as an H.264 MP4.

Usage:
    python3 render_doro_cycling.py [output.mp4]
"""
import math
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

W, H = 1280, 720
FPS = 30
DURATION = 5
SS = 2  # supersampling factor

# Palette sampled from the Doro plush reference photos
PINK = (246, 168, 198)
PINK_DARK = (222, 128, 166)
PINK_LINE = (196, 96, 140)
WHITE = (255, 250, 250)
WHITE_SHADE = (236, 226, 232)
WHITE_LINE = (205, 188, 200)
PURPLE = (150, 112, 210)
PURPLE_DARK = (82, 50, 120)
PURPLE_LIGHT = (190, 160, 232)
LASH = (70, 40, 80)
BLUSH = (248, 150, 170)

SPEED = 11.0  # ground scroll, px per frame


def s(v):
    return v * SS


def sw(v):
    return max(1, int(round(v * SS)))


def pts(seq):
    return [(s(x), s(y)) for x, y in seq]


def ellipse(d, cx, cy, rx, ry, fill, outline=None, width=0):
    d.ellipse([s(cx - rx), s(cy - ry), s(cx + rx), s(cy + ry)],
              fill=fill, outline=outline, width=sw(width) if outline else 0)


def capsule(d, a, b, w, fill, outline=None, ow=0):
    """Thick line with round caps, optionally outlined."""
    if outline:
        d.line(pts([a, b]), fill=outline, width=sw(w + 2 * ow))
        for p in (a, b):
            ellipse(d, p[0], p[1], w / 2 + ow, w / 2 + ow, outline)
    d.line(pts([a, b]), fill=fill, width=sw(w))
    for p in (a, b):
        ellipse(d, p[0], p[1], w / 2, w / 2, fill)


def polyline(d, seq, fill, w):
    d.line(pts(seq), fill=fill, width=sw(w), joint="curve")
    for p in (seq[0], seq[-1]):
        ellipse(d, p[0], p[1], w / 2, w / 2, fill)


# ---------------------------------------------------------------- background

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_sky():
    sky = Image.new("RGB", (s(W), s(H)))
    d = ImageDraw.Draw(sky)
    top, bottom = (150, 200, 245), (255, 228, 236)
    for y in range(s(H)):
        d.line([(0, y), (s(W), y)], fill=lerp(top, bottom, y / s(H)))
    # soft sun
    glow = Image.new("RGBA", (s(W), s(H)), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for r, a in ((150, 40), (110, 70), (75, 255)):
        col = (255, 245, 200, a) if r != 75 else (255, 240, 170, 255)
        g.ellipse([s(1080 - r), s(110 - r), s(1080 + r), s(110 + r)], fill=col)
    glow = glow.filter(ImageFilter.GaussianBlur(s(6)))
    sky.paste(glow, (0, 0), glow)
    return sky


def draw_cloud(d, x, y, k):
    for dx, dy, r in ((0, 0, 34), (38, -14, 42), (80, 0, 32), (40, 12, 34)):
        ellipse(d, x + dx * k, y + dy * k, r * k, r * k * 0.85, (255, 255, 255))


def wrap(x, period):
    return (x % period) - 200


def draw_background(img, f):
    d = ImageDraw.Draw(img)
    # clouds (slow parallax)
    for i, (x0, y0, k) in enumerate(((100, 90, 1.0), (520, 60, 0.7),
                                      (900, 150, 0.8), (1300, 80, 1.1))):
        draw_cloud(d, wrap(x0 - f * SPEED * 0.08, 1700), y0, k)

    # far hills
    ground = 640
    far = [(x, 470 + 30 * math.sin((x + f * SPEED * 0.2) / 140)
            + 15 * math.sin((x + f * SPEED * 0.2) / 53)) for x in range(-10, W + 20, 10)]
    d.polygon(pts(far + [(W + 20, ground), (-10, ground)]), fill=(186, 222, 190))
    near = [(x, 530 + 22 * math.sin((x + f * SPEED * 0.45) / 110 + 1.3))
            for x in range(-10, W + 20, 10)]
    d.polygon(pts(near + [(W + 20, ground), (-10, ground)]), fill=(150, 205, 150))

    # trees on the near hill
    for i in range(7):
        x = wrap(i * 260 + 60 - f * SPEED * 0.45, 7 * 260)
        y = 530 + 22 * math.sin((x + f * SPEED * 0.45) / 110 + 1.3)
        d.rectangle([s(x - 6), s(y - 40), s(x + 6), s(y + 10)], fill=(140, 100, 80))
        col = (255, 196, 214) if i % 2 else (120, 186, 120)  # cherry blossom / green
        ellipse(d, x, y - 62, 38, 34, col)
        ellipse(d, x - 22, y - 44, 26, 22, col)
        ellipse(d, x + 22, y - 44, 26, 22, col)

    # grass + road
    d.rectangle([0, s(ground - 25), s(W), s(ground)], fill=(132, 196, 128))
    d.rectangle([0, s(ground), s(W), s(H)], fill=(196, 188, 196))
    d.rectangle([0, s(ground), s(W), s(ground + 6)], fill=(170, 160, 172))
    for i in range(10):
        x = wrap(i * 180 - f * SPEED, 10 * 180)
        d.rounded_rectangle([s(x), s(678), s(x + 90), s(688)], radius=s(5),
                            fill=(255, 255, 255))
    # little flowers in the grass
    for i in range(16):
        x = wrap(i * 97 + (i * 37) % 50 - f * SPEED, 16 * 97)
        y = ground - 12 - (i * 13) % 10
        col = ((255, 255, 255), (255, 210, 120), (255, 170, 200))[i % 3]
        for a in range(5):
            ang = a * 2 * math.pi / 5
            ellipse(d, x + 4 * math.cos(ang), y + 4 * math.sin(ang), 3, 3, col)
        ellipse(d, x, y, 2.2, 2.2, (255, 220, 90))


# ---------------------------------------------------------------- bicycle

RW = (445, 560)   # rear hub
FW = (795, 560)   # front hub
WR = 78           # wheel radius
CRANK = (605, 568)
CR = 30           # crank radius
SEAT = (548, 448)
HEAD_TOP = (742, 448)
HEAD_BOT = (756, 492)
FRAME = (160, 128, 222)
FRAME_DARK = (120, 92, 180)


def draw_wheel(d, c, ang):
    cx, cy = c
    ellipse(d, cx, cy, WR, WR, None, (70, 64, 78), 9)
    ellipse(d, cx, cy, WR - 8, WR - 8, None, (210, 210, 220), 3)
    for i in range(12):
        a = ang + i * math.pi / 6
        d.line(pts([(cx, cy), (cx + (WR - 8) * math.cos(a), cy + (WR - 8) * math.sin(a))]),
               fill=(200, 200, 210), width=sw(1.5))
    ellipse(d, cx, cy, 9, 9, (180, 180, 190))
    ellipse(d, cx, cy, 4, 4, (120, 120, 130))


def draw_pedal(d, ang, near):
    px = CRANK[0] + CR * math.cos(ang)
    py = CRANK[1] + CR * math.sin(ang)
    col = (90, 90, 100) if near else (70, 70, 80)
    capsule(d, CRANK, (px, py), 6, col)
    d.rounded_rectangle([s(px - 13), s(py - 4), s(px + 13), s(py + 4)],
                        radius=s(3), fill=(60, 60, 70))
    return px, py


def draw_bike(d, wheel_ang, crank_ang):
    draw_wheel(d, RW, wheel_ang)
    draw_wheel(d, FW, wheel_ang)
    # chain + chainring
    d.line(pts([(CRANK[0], CRANK[1] - 16), (RW[0], RW[1] - 9)]), fill=(110, 110, 120), width=sw(3))
    d.line(pts([(CRANK[0], CRANK[1] + 16), (RW[0], RW[1] + 9)]), fill=(110, 110, 120), width=sw(3))
    ellipse(d, CRANK[0], CRANK[1], 18, 18, (170, 170, 180), (110, 110, 120), 3)
    # frame tubes
    seat_low = (SEAT[0] + 4, SEAT[1] + 14)
    for a, b in ((RW, CRANK), (RW, seat_low), (CRANK, seat_low),
                 (seat_low, HEAD_TOP), (CRANK, HEAD_BOT)):
        capsule(d, a, b, 9, FRAME)
    capsule(d, HEAD_TOP, HEAD_BOT, 12, FRAME_DARK)
    capsule(d, HEAD_BOT, FW, 8, FRAME_DARK)
    # front basket with a bow-coloured liner
    bx, by = 800, 440
    d.polygon(pts([(bx - 30, by - 30), (bx + 40, by - 30), (bx + 32, by + 20), (bx - 22, by + 20)]),
              fill=(222, 186, 140), outline=(180, 140, 100))
    for i in range(1, 5):
        x = bx - 30 + i * 14
        d.line(pts([(x, by - 30), (x - 2, by + 20)]), fill=(190, 150, 110), width=sw(2))
    d.line(pts([(bx - 26, by - 5), (bx + 36, by - 5)]), fill=(190, 150, 110), width=sw(2))
    # a small pink flower bouquet poking out of the basket
    for (fx, fy, col) in ((bx - 10, by - 38, (255, 170, 200)), (bx + 10, by - 44, (255, 255, 255)),
                          (bx + 26, by - 36, (190, 160, 232))):
        d.line(pts([(fx, fy), (fx + 2, by - 25)]), fill=(110, 170, 100), width=sw(3))
        for a in range(5):
            ang = a * 2 * math.pi / 5
            ellipse(d, fx + 6 * math.cos(ang), fy + 6 * math.sin(ang), 5, 5, col)
        ellipse(d, fx, fy, 3.5, 3.5, (255, 220, 90))
    # seat post + saddle
    capsule(d, seat_low, (SEAT[0] - 2, SEAT[1] - 2), 7, (150, 150, 160))
    d.rounded_rectangle([s(SEAT[0] - 34), s(SEAT[1] - 10), s(SEAT[0] + 22), s(SEAT[1] + 3)],
                        radius=s(7), fill=(90, 70, 90))


def draw_handlebar(d):
    stem_top = (HEAD_TOP[0] - 6, HEAD_TOP[1] - 40)
    capsule(d, HEAD_TOP, stem_top, 8, (150, 150, 160))
    grip = (stem_top[0] - 30, stem_top[1] + 6)
    capsule(d, stem_top, grip, 8, (150, 150, 160))
    capsule(d, (grip[0] + 4, grip[1] - 1), (grip[0] - 8, grip[1] + 2), 12, (110, 80, 150))
    return grip


# ---------------------------------------------------------------- doro

def leg_ik(hip, foot, l1, l2):
    """Two-bone IK; knee bends forward (towards +x)."""
    dx, dy = foot[0] - hip[0], foot[1] - hip[1]
    dist = min(math.hypot(dx, dy), l1 + l2 - 0.01)
    base = math.atan2(dy, dx)
    cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    a = math.acos(max(-1, min(1, cos_a)))
    k = base - a
    return hip[0] + l1 * math.cos(k), hip[1] + l1 * math.sin(k)


def draw_leg(d, hip, foot, near):
    knee = leg_ik(hip, foot, 64, 66)
    fill = WHITE if near else WHITE_SHADE
    capsule(d, hip, knee, 30, fill, WHITE_LINE, 2)
    capsule(d, knee, foot, 26, fill, WHITE_LINE, 2)
    ellipse(d, foot[0] + 4, foot[1] - 6, 18, 13, fill, WHITE_LINE, 2)


def draw_body(d, bob):
    cx, cy = 560, 405 + bob
    # bunny tail
    ellipse(d, cx - 58, cy + 30, 20, 19, WHITE, WHITE_LINE, 2)
    ellipse(d, cx, cy, 58, 56, WHITE, WHITE_LINE, 2.5)
    # soft belly shading
    ellipse(d, cx + 8, cy + 12, 36, 30, (255, 253, 253))


def draw_arm(d, bob, grip, near):
    shoulder = (590, 385 + bob) if near else (575, 382 + bob)
    fill = WHITE if near else WHITE_SHADE
    capsule(d, shoulder, (grip[0] - 4, grip[1] + 2), 28, fill, WHITE_LINE, 2)


def bezier(p0, p1, p2, n=20):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in (i / n for i in range(n + 1))]


def draw_head(d, cx, cy, R, t, blink):
    def P(x, y):
        return cx + x * R, cy + y * R

    sway = math.sin(t * 2 * math.pi * 1.6) * 0.06

    # --- ahoge curl (behind the hair outline so it grows out of the head)
    base = P(0.02, -0.92)
    tip = P(0.06 + sway, -1.38)
    stem = bezier(base, P(-0.06, -1.15), tip)
    cc = (tip[0] + 0.2 * R, tip[1])
    spiral = []
    for i in range(40):
        u = i / 39
        a = math.pi + u * 1.6 * math.pi
        r = 0.2 * R * (1 - 0.55 * u)
        spiral.append((cc[0] + r * math.cos(a), cc[1] + r * math.sin(a)))
    curl = stem + spiral
    polyline(d, curl, PINK_LINE, 0.15 * R + 4)
    polyline(d, curl, PINK, 0.15 * R)

    # --- cat-ear hair points (viewer's left)
    for ear in (([-0.62, -0.72], [-0.98, -0.92], [-0.88, -0.42]),
                ([-0.88, -0.25], [-1.12, -0.18], [-0.86, 0.02])):
        poly = [P(*p) for p in ear]
        d.polygon(pts(poly), fill=PINK, outline=PINK_LINE, width=sw(2))
        inner = [P(ear[0][0] * 0.94 + ear[1][0] * 0.06, ear[0][1] * 0.9 + ear[1][1] * 0.1),
                 P(ear[1][0] * 0.88 + ear[0][0] * 0.12, ear[1][1] * 0.86 + ear[0][1] * 0.14),
                 P(ear[2][0] * 0.94 + ear[1][0] * 0.06, ear[2][1] * 0.9 + ear[1][1] * 0.1)]
        d.polygon(pts(inner), fill=PINK_DARK)

    # --- bun (viewer's right) with rose swirl
    bx, by = P(0.74, -0.68)
    br = 0.38 * R
    ellipse(d, bx, by, br, br, PINK, PINK_LINE, 2.5)
    swirl = []
    for i in range(60):
        u = i / 59
        a = u * 3.2 * math.pi
        r = br * 0.72 * (1 - 0.85 * u)
        swirl.append((bx + r * math.cos(a), by + r * math.sin(a)))
    d.line(pts(swirl), fill=PINK_LINE, width=sw(2), joint="curve")

    # --- hair back
    ellipse(d, cx, cy - 0.06 * R, R, 0.94 * R, PINK, PINK_LINE, 3)

    # human ears
    for sx in (-1, 1):
        ex, ey = P(sx * 0.9, 0.36)
        ellipse(d, ex, ey, 0.13 * R, 0.17 * R, WHITE, WHITE_LINE, 2)

    # --- side lock (viewer's left), drawn after ears, swinging a little
    lock = [P(-0.86, -0.15), P(-0.6, -0.1),
            P(-0.66 + sway, 0.55), P(-0.8 + sway * 1.5, 0.92), P(-0.86, 0.45)]
    d.polygon(pts(lock), fill=PINK, outline=PINK_LINE, width=sw(2))

    # --- face
    ellipse(d, cx, cy + 0.22 * R, 0.8 * R, 0.66 * R, WHITE, WHITE_LINE, 2)

    # --- bangs
    edge = [(-0.82, 0.02), (-0.68, 0.26), (-0.5, 0.02), (-0.3, 0.2), (-0.12, -0.02),
            (0.04, 0.16), (0.22, -0.02), (0.42, 0.2), (0.6, 0.0), (0.76, 0.22), (0.84, 0.04)]
    bang = [P(0.92, -0.4)] + [P(x, y) for x, y in reversed(edge)] + [P(-0.92, -0.4), P(0, -0.7)]
    d.polygon(pts(bang), fill=PINK)
    d.line(pts([P(x, y) for x, y in edge]), fill=PINK_LINE, width=sw(2.5), joint="curve")
    for x0, y0, x1, y1 in ((-0.35, -0.45, -0.44, 0.1), (-0.05, -0.5, -0.12, 0.0),
                           (0.25, -0.45, 0.27, 0.12), (0.55, -0.35, 0.6, 0.05)):
        d.line(pts([P(x0, y0), P(x1, y1)]), fill=PINK_DARK, width=sw(2))

    # --- eyes
    for sx in (-1, 1):
        ex, ey = P(sx * 0.36, 0.34)
        rx, ry = 0.17 * R, 0.2 * R * (1 - blink)
        if ry > 2:
            ellipse(d, ex, ey, rx, ry, PURPLE_DARK)
            ellipse(d, ex, ey + ry * 0.05, rx * 0.86, ry * 0.86, PURPLE)
            d.pieslice([s(ex - rx * 0.86), s(ey - ry * 0.8), s(ex + rx * 0.86), s(ey + ry * 0.9)],
                       0, 180, fill=PURPLE_LIGHT)
            ellipse(d, ex, ey - ry * 0.15, rx * 0.45, ry * 0.45, PURPLE_DARK)
            ellipse(d, ex - rx * 0.35, ey - ry * 0.45, rx * 0.26, ry * 0.24, (255, 255, 255))
            ellipse(d, ex + rx * 0.35, ey + ry * 0.35, rx * 0.11, ry * 0.1, (255, 255, 255))
        else:
            d.arc([s(ex - rx), s(ey - 8), s(ex + rx), s(ey + 8)], 0, 180, fill=LASH, width=sw(4))
        # eyelash: a thick arc with an outer flick
        top = ey - max(ry, 6) - 2
        lash = bezier((ex - sx * rx * 1.05, ey - max(ry, 6) * 0.45), (ex, top - 0.07 * R),
                      (ex + sx * rx * 1.15, ey - max(ry, 6) * 0.55), 16)
        d.line(pts(lash), fill=LASH, width=sw(5), joint="curve")
        d.line(pts([lash[-1], (lash[-1][0] + sx * 0.06 * R, lash[-1][1] - 0.04 * R)]),
               fill=LASH, width=sw(4))

    # --- ":3" mouth
    mx, my = P(0, 0.56)
    w = 0.055 * R
    for ox in (-w, w):
        d.arc([s(mx + ox - w), s(my - w), s(mx + ox + w), s(my + w)], 0, 180,
              fill=(110, 60, 70), width=sw(2.5))

    # --- blush
    for sx in (-1, 1):
        bx2, by2 = P(sx * 0.56, 0.58)
        ellipse(d, bx2, by2, 0.12 * R, 0.07 * R, BLUSH)
        for k in (-1, 0, 1):
            x = bx2 + k * 0.05 * R
            d.line(pts([(x + 0.02 * R, by2 - 0.035 * R), (x - 0.02 * R, by2 + 0.035 * R)]),
                   fill=(230, 110, 140), width=sw(1.5))

    # --- purple bow + white satin ribbon under the bun
    kx, ky = P(0.82, -0.18)
    flutter = math.sin(t * 2 * math.pi * 2.2) * 0.05 * R
    for tail in ((kx + 0.02 * R, 0.5), (kx + 0.12 * R, 0.62)):
        d.polygon(pts([(kx, ky), (tail[0] + 0.06 * R + flutter, ky + tail[1] * R),
                       (tail[0] + 0.16 * R + flutter, ky + tail[1] * R - 0.04 * R),
                       (kx + 0.08 * R, ky)]),
                  fill=(255, 255, 255), outline=WHITE_LINE, width=sw(1.5))
    ellipse(d, kx + 0.12 * R, ky + 0.02 * R, 0.13 * R, 0.08 * R, (255, 255, 255), WHITE_LINE, 1.5)
    for sx in (-1, 1):
        d.polygon(pts([(kx, ky), (kx + sx * 0.22 * R, ky - 0.12 * R),
                       (kx + sx * 0.2 * R, ky + 0.1 * R)]),
                  fill=PURPLE, outline=PURPLE_DARK, width=sw(1.5))
    ellipse(d, kx, ky, 0.05 * R, 0.05 * R, PURPLE_DARK)


# ---------------------------------------------------------------- frame

def speed_lines(d, f):
    for i in range(6):
        y = 300 + i * 45 + (i * 17) % 20
        x = wrap(i * 260 - f * SPEED * 2.2, 1600)
        d.line(pts([(x, y), (x + 70 + (i % 3) * 20, y)]), fill=(255, 255, 255), width=sw(3))


def render_frame(f, sky):
    t = f / FPS
    img = sky.copy()
    draw_background(img, f)
    d = ImageDraw.Draw(img)

    # Ride in from the left during the first second, then cruise.
    intro = min(1.0, t / 1.0)
    ease = 1 - (1 - intro) ** 3
    offset_x = -700 * (1 - ease)

    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)

    wheel_ang = f * SPEED / WR
    crank_ang = f * 0.3
    bob = 3 * math.sin(crank_ang * 2)
    blink_phase = t % 2.4
    blink = max(0.0, 1 - abs(blink_phase - 2.2) / 0.08) if blink_phase > 2.1 else 0.0

    speed_lines(ld, f)
    # shadow
    ld.ellipse([s(420), s(632), s(830), s(650)], fill=(120, 110, 130, 90))

    # far-side limbs
    far_pedal = draw_pedal(ld, crank_ang + math.pi, False)
    draw_leg(ld, (566, 438 + bob), far_pedal, False)
    draw_bike(ld, wheel_ang, crank_ang)
    grip = draw_handlebar(ld)
    draw_arm(ld, bob, grip, False)
    draw_body(ld, bob)
    near_pedal = draw_pedal(ld, crank_ang, True)
    draw_leg(ld, (580, 444 + bob), near_pedal, True)
    draw_head(ld, 590, 262 + bob * 1.4, 128, t, blink)
    draw_arm(ld, bob, grip, True)

    img.paste(layer, (int(s(offset_x)), 0), layer)
    return img.resize((W, H), Image.LANCZOS)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "doro_cycling.mp4"
    sky = make_sky()
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out],
        stdin=subprocess.PIPE)
    for f in range(FPS * DURATION):
        proc.stdin.write(render_frame(f, sky).tobytes())
    proc.stdin.close()
    proc.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
