#!/usr/bin/env python3
"""Build NR Accounting vector logos (outlined paths, font-independent)."""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

FONTS = {
    "bold": "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "medium": "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf",
}

NAVY_TOP = "#1B3A66"
NAVY_BOT = "#0A1A30"
NAVY_INK = "#11294C"   # wordmark on light
GOLD = "#CBA24C"
GOLD_LT = "#E4C879"

def string_paths(text, weight, tracking=0):
    """Return (svg_path_d, (xmin,ymin,xmax,ymax)) in em-units, y-DOWN."""
    font = TTFont(FONTS[weight])
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    spen = SVGPathPen(gs)
    bpen = BoundsPen(gs)
    x = 0.0
    for ch in text:
        g = cmap.get(ord(ch))
        if g is None:
            x += font["head"].unitsPerEm * 0.3
            continue
        t = (1, 0, 0, -1, x, 0)  # flip Y so it's y-down, shift by advance
        gs[g].draw(TransformPen(spen, t))
        gs[g].draw(TransformPen(bpen, t))
        x += hmtx[g][0] + tracking
    return spen.getCommands(), bpen.bounds

def fit_transform(bounds, target_h, cx=None, cy=None, x0=None, baseline_y=None):
    xmin, ymin, xmax, ymax = bounds
    s = target_h / (ymax - ymin)
    if x0 is not None:
        tx = x0 - s * xmin
    else:
        tx = cx - s * (xmin + xmax) / 2
    if baseline_y is not None:
        ty = baseline_y - s * ymax
    else:
        ty = cy - s * (ymin + ymax) / 2
    return s, tx, ty, s * (xmax - xmin)

# ---------------------------------------------------------------- mark (512)
nr_d, nr_b = string_paths("NR", "bold")
s, tx, ty, w = fit_transform(nr_b, 196, cx=256, cy=238)

DEFS = f"""  <defs>
    <linearGradient id="navy" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{NAVY_TOP}"/>
      <stop offset="1" stop-color="{NAVY_BOT}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{GOLD_LT}"/>
      <stop offset="1" stop-color="{GOLD}"/>
    </linearGradient>
  </defs>"""

mark = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
{DEFS}
  <rect x="0" y="0" width="512" height="512" rx="116" ry="116" fill="url(#navy)"/>
  <rect x="9" y="9" width="494" height="494" rx="108" ry="108" fill="none" stroke="{GOLD}" stroke-width="3.5" opacity="0.9"/>
  <g transform="translate({tx:.2f},{ty:.2f}) scale({s:.4f})"><path d="{nr_d}" fill="url(#gold)"/></g>
  <rect x="216" y="356" width="80" height="7" rx="3.5" fill="{GOLD}"/>
</svg>"""
open("logo-mark.svg", "w").write(mark)

# ------------------------------------------------- horizontal lockup
# layout: mark (size M) at left, then "NR" bold + "Accounting" medium
CAP = 96
nr2_d, nr2_b = string_paths("NR", "bold")
ac_d, ac_b = string_paths("Accounting", "medium")
s1, _, _, w1 = fit_transform(nr2_b, CAP, x0=0, baseline_y=0)
s2, _, _, w2 = fit_transform(ac_b, CAP, x0=0, baseline_y=0)

M = 132            # mark size in lockup
gap = 40           # mark -> text gap
nr_gap = 34        # NR -> Accounting gap
pad = 36
text_x = pad + M + gap
baseline = pad + M * 0.66   # visually center text against mark
nr_x = text_x
ac_x = text_x + w1 + nr_gap
total_w = ac_x + w2 + pad
total_h = pad * 2 + M

def lockup(ink, gold_fill, bg=None):
    bg_rect = f'  <rect width="{total_w:.0f}" height="{total_h:.0f}" fill="{bg}"/>\n' if bg else ""
    ms = M / 512.0
    # NR path transform
    nr_tx = nr_x; nr_ty = baseline - s1 * nr2_b[3]
    ac_tx = ac_x; ac_ty = baseline - s2 * ac_b[3]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.0f} {total_h:.0f}" width="{total_w:.0f}" height="{total_h:.0f}">
{DEFS}
{bg_rect}  <g transform="translate({pad},{pad}) scale({ms:.5f})">
    <rect x="0" y="0" width="512" height="512" rx="116" ry="116" fill="url(#navy)"/>
    <rect x="9" y="9" width="494" height="494" rx="108" ry="108" fill="none" stroke="{GOLD}" stroke-width="3.5" opacity="0.9"/>
    <g transform="translate({tx:.2f},{ty:.2f}) scale({s:.4f})"><path d="{nr_d}" fill="url(#gold)"/></g>
    <rect x="216" y="356" width="80" height="7" rx="3.5" fill="{GOLD}"/>
  </g>
  <g transform="translate({nr_tx:.2f},{nr_ty:.2f}) scale({s1:.4f})"><path d="{nr2_d}" fill="{ink}"/></g>
  <g transform="translate({ac_tx:.2f},{ac_ty:.2f}) scale({s2:.4f})"><path d="{ac_d}" fill="{gold_fill}"/></g>
</svg>"""

open("logo-horizontal.svg", "w").write(lockup(NAVY_INK, NAVY_INK))      # navy on transparent/light
open("logo-horizontal-dark.svg", "w").write(lockup("#FFFFFF", GOLD))     # white+gold for dark bg

print(f"mark NR: scale={s:.3f}")
print(f"lockup size: {total_w:.0f} x {total_h:.0f}")
print("wrote logo-mark.svg, logo-horizontal.svg, logo-horizontal-dark.svg")
