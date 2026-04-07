#!/usr/bin/env python3
"""
Convert UQM pixel-art fonts (directories of per-glyph PNGs) to TTF/WOFF2.

Font directory structure:
  <name>.fon/
    00020.png   # U+0020 SPACE
    00041.png   # U+0041 'A'
    ...

Each PNG is either an RGBA alpha-mask bitmap or an opaque black/white bitmap.
When transparency is present, alpha > 0 means "ink"; otherwise bright pixels
mean "ink".
Glyph height varies per font; width varies per character.

Baseline auto-detection: scans uppercase A-Z and 0-9, finds the last row
with any opaque pixels, sets BASELINE_ROW = that_row + 1 so those characters
sit directly on the baseline. Descenders (g, p, y, etc.) naturally extend below.
"""

import argparse
import os
import sys
from pathlib import Path
from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont

UNITS_PER_PIXEL = 100
INTER_CHAR = 1  # 1 extra pixel of advance between characters (UQM default)


def pixel_is_ink(pixel) -> bool:
    """
    Determine whether a source bitmap pixel should become glyph ink.

    Most extracted UQM fonts use transparent black for background and opaque
    white for ink, but slides.fon is stored as a fully opaque black/white
    bitmap. Support both encodings so the converter works for either case.
    """
    if len(pixel) >= 4 and pixel[3] < 255:
        return pixel[3] > 0
    return pixel[0] >= 128


def detect_metrics(fon_dir: Path):
    """
    Scan A-Z and 0-9 to find cap baseline row, then compute font metrics.
    Uses the modal (most common) bottom row across caps so that outliers like
    'Q' (which has a descending tail) don't shift the baseline for all glyphs.
    Returns (glyph_h, baseline_row, upm, ascender, descender, cap_height, x_height).
    """
    cap_codepoints = list(range(0x41, 0x5B)) + list(range(0x30, 0x3A))
    glyph_h = None
    bottom_rows: list[int] = []

    for cp in cap_codepoints:
        png = fon_dir / f"{cp:05x}.png"
        if not png.exists():
            continue
        img = Image.open(png).convert("RGBA")
        w, h = img.size
        if glyph_h is None:
            glyph_h = h
        pixels = img.load()
        for py in range(h - 1, -1, -1):
            if any(pixel_is_ink(pixels[px, py]) for px in range(w)):
                bottom_rows.append(py)
                break

    if not bottom_rows:
        raise ValueError("No cap glyphs found to detect metrics")

    # Use the most common bottom row so outliers (e.g. Q with a descender tail)
    # don't push the baseline down for every other glyph.
    from collections import Counter
    last_cap_row = Counter(bottom_rows).most_common(1)[0][0]

    if glyph_h is None:
        raise ValueError("No cap glyphs found to detect metrics")

    # Baseline sits at the bottom of the last cap content row
    baseline_row = last_cap_row + 1

    upm         = glyph_h * UNITS_PER_PIXEL
    ascender    = baseline_row * UNITS_PER_PIXEL
    descender   = -(glyph_h - baseline_row) * UNITS_PER_PIXEL

    # Scan lowercase 'x' for x-height, fall back to 60% of cap height
    cap_h_px    = last_cap_row  # number of pixel rows the cap occupies
    x_height_px = cap_h_px
    x_png = fon_dir / "00078.png"  # 'x'
    if x_png.exists():
        img = Image.open(x_png).convert("RGBA")
        pixels = img.load()
        w2, h2 = img.size
        first = None
        last  = None
        for py in range(h2):
            if any(pixel_is_ink(pixels[px2, py]) for px2 in range(w2)):
                if first is None:
                    first = py
                last = py
        if first is not None and last is not None:
            x_height_px = last - first + 1

    cap_height = cap_h_px * UNITS_PER_PIXEL
    x_height   = x_height_px * UNITS_PER_PIXEL

    return glyph_h, baseline_row, upm, ascender, descender, cap_height, x_height


def image_to_contours(img, baseline_row: int):
    """
    Return a list of (x1, y1, x2, y2) rectangles for each opaque pixel.
    Coordinates are in font units with y-up, baseline at y=0.
    """
    pixels = img.load()
    w, h = img.size
    rects = []
    for py in range(h):
        for px in range(w):
            if pixel_is_ink(pixels[px, py]):
                x1 = px * UNITS_PER_PIXEL
                x2 = (px + 1) * UNITS_PER_PIXEL
                y1 = (baseline_row - py - 1) * UNITS_PER_PIXEL
                y2 = (baseline_row - py) * UNITS_PER_PIXEL
                rects.append((x1, y1, x2, y2))
    return rects


def rects_to_pen_calls(pen, rects):
    for (x1, y1, x2, y2) in rects:
        pen.moveTo((x1, y1))
        pen.lineTo((x2, y1))
        pen.lineTo((x2, y2))
        pen.lineTo((x1, y2))
        pen.closePath()


def load_glyphs(fon_dir: Path, baseline_row: int):
    glyphs = {}
    for png in sorted(fon_dir.glob("*.png")):
        try:
            cp = int(png.stem, 16)
        except ValueError:
            continue
        img = Image.open(png).convert("RGBA")
        w, h = img.size
        rects = image_to_contours(img, baseline_row)
        advance = (w + INTER_CHAR) * UNITS_PER_PIXEL
        glyphs[cp] = {"advance": advance, "rects": rects}
    return glyphs


def build_font(fon_dir: Path, font_name: str) -> TTFont:
    glyph_h, baseline_row, upm, ascender, descender, cap_height, x_height = \
        detect_metrics(fon_dir)

    print(f"  Detected: height={glyph_h}px, baseline_row={baseline_row}, "
          f"upm={upm}, ascender={ascender}, descender={descender}")

    fb = FontBuilder(upm, isTTF=True)
    glyphs = load_glyphs(fon_dir, baseline_row)

    glyph_order = [".notdef"]
    char_map = {}
    for cp, info in sorted(glyphs.items()):
        if 0x20 <= cp <= 0x10FFFF:
            name = f"uni{cp:04X}"
            glyph_order.append(name)
            char_map[cp] = name

    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(char_map)
    fb.setupNameTable({"familyName": font_name, "styleName": "Regular"})
    fb.setupHorizontalHeader(ascent=ascender, descent=descender)
    fb.setupHorizontalMetrics({
        ".notdef": (2 * UNITS_PER_PIXEL, 0),
        **{char_map[cp]: (info["advance"], 0)
           for cp, info in glyphs.items() if cp in char_map},
    })
    fb.setupOS2(
        sTypoAscender=ascender,
        sTypoDescender=descender,
        sTypoLineGap=0,
        usWinAscent=ascender,
        usWinDescent=abs(descender),
        sxHeight=x_height,
        sCapHeight=cap_height,
    )
    fb.setupPost(isFixedPitch=False)
    fb.setupHead(unitsPerEm=upm)

    from fontTools.pens.ttGlyphPen import TTGlyphPen

    glyph_set = {}

    # .notdef: simple filled rectangle
    pen = TTGlyphPen(None)
    pen.moveTo((10, 0))
    pen.lineTo((90, 0))
    pen.lineTo((90, cap_height))
    pen.lineTo((10, cap_height))
    pen.closePath()
    glyph_set[".notdef"] = pen.glyph()

    for cp, info in glyphs.items():
        name = char_map.get(cp)
        if not name:
            continue
        pen = TTGlyphPen(None)
        rects_to_pen_calls(pen, info["rects"])
        glyph_set[name] = pen.glyph()

    fb.setupGlyf(glyph_set)
    fb.setupDummyDSIG()
    return fb.font


def main():
    parser = argparse.ArgumentParser(
        description="Convert UQM .fon glyph-PNG directory to TTF/WOFF2"
    )
    parser.add_argument("fon_dir", help="Path to the .fon directory")
    parser.add_argument("output",  help="Output path (.ttf or .woff2)")
    parser.add_argument("--name",  default=None, help="Font family name")
    args = parser.parse_args()

    fon_dir = Path(args.fon_dir)
    if not fon_dir.is_dir():
        print(f"Error: {fon_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    font_name = args.name or fon_dir.stem.split(".")[0].capitalize()
    output = Path(args.output)

    print(f"Building '{font_name}' from {fon_dir.name} ...")
    font = build_font(fon_dir, font_name)
    output.parent.mkdir(parents=True, exist_ok=True)

    if output.suffix.lower() == ".woff2":
        ttf_path = output.with_suffix(".ttf")
        font.save(str(ttf_path))
        print(f"  Saved TTF -> {ttf_path}")
        from fontTools.ttLib.woff2 import compress
        with open(str(ttf_path), "rb") as fi, open(str(output), "wb") as fo:
            compress(fi, fo)
        print(f"  Saved WOFF2 -> {output}")
    else:
        font.save(str(output))
        print(f"  Saved -> {output}")


if __name__ == "__main__":
    main()
