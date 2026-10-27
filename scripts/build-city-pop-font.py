"""Builds City Pop's pixel font ("AniTrack Pixel") for both apps from the glyphs below.

    python -I scripts/build-city-pop-font.py

An original 5 x 7 capital face on an 8-pixel em: crisp at 8, 16, 24 or 32 px. Small letters
draw as capitals, as on old game screens. Writes the desktop WOFF, the Android TTF, and the WOFF
as base64 for desktop's player window (a data: page, which can only embed its font).
"""
import base64
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent.parent
PIXEL = 100          # font units per pixel
EM = 8 * PIXEL       # 8-pixel em: 7-pixel capitals and a pixel above them
ADVANCE = 6 * PIXEL  # 5-pixel glyphs and a pixel between them

# Rows top to bottom: seven above the baseline, an eighth for a comma's tail.
GLYPHS = {
    "A": ".###. #...# #...# ##### #...# #...# #...#",
    "B": "####. #...# #...# ####. #...# #...# ####.",
    "C": ".###. #...# #.... #.... #.... #...# .###.",
    "D": "####. #...# #...# #...# #...# #...# ####.",
    "E": "##### #.... #.... ####. #.... #.... #####",
    "F": "##### #.... #.... ####. #.... #.... #....",
    "G": ".###. #...# #.... #.### #...# #...# .####",
    "H": "#...# #...# #...# ##### #...# #...# #...#",
    "I": ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
    "J": "..### ...#. ...#. ...#. ...#. #..#. .##..",
    "K": "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
    "L": "#.... #.... #.... #.... #.... #.... #####",
    "M": "#...# ##.## #.#.# #.#.# #...# #...# #...#",
    "N": "#...# #...# ##..# #.#.# #..## #...# #...#",
    "O": ".###. #...# #...# #...# #...# #...# .###.",
    "P": "####. #...# #...# ####. #.... #.... #....",
    "Q": ".###. #...# #...# #...# #.#.# #..#. .##.#",
    "R": "####. #...# #...# ####. #.#.. #..#. #...#",
    "S": ".#### #.... #.... .###. ....# ....# ####.",
    "T": "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
    "U": "#...# #...# #...# #...# #...# #...# .###.",
    "V": "#...# #...# #...# #...# #...# .#.#. ..#..",
    "W": "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
    "X": "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
    "Y": "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
    "Z": "##### ....# ...#. ..#.. .#... #.... #####",
    "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
    "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
    "2": ".###. #...# ....# ...#. ..#.. .#... #####",
    "3": "##### ...#. ..#.. ...#. ....# #...# .###.",
    "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
    "5": "##### #.... ####. ....# ....# #...# .###.",
    "6": "..##. .#... #.... ####. #...# #...# .###.",
    "7": "##### ....# ...#. ..#.. .#... .#... .#...",
    "8": ".###. #...# #...# .###. #...# #...# .###.",
    "9": ".###. #...# #...# .#### ....# ...#. .##..",
    " ": "..... ..... ..... ..... ..... ..... .....",
    "!": "..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..",
    '"': ".#.#. .#.#. ..... ..... ..... ..... .....",
    "#": ".#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.",
    "$": "..#.. .#### #.#.. .###. ..#.# ####. ..#..",
    "%": "##... ##..# ...#. ..#.. .#... #..## ...##",
    "&": ".##.. #..#. #.#.. .#... #.#.# #..#. .##.#",
    "'": "..#.. ..#.. .#... ..... ..... ..... .....",
    "(": "...#. ..#.. .#... .#... .#... ..#.. ...#.",
    ")": ".#... ..#.. ...#. ...#. ...#. ..#.. .#...",
    "*": "..... ..#.. #.#.# .###. #.#.# ..#.. .....",
    "+": "..... ..#.. ..#.. ##### ..#.. ..#.. .....",
    ",": "..... ..... ..... ..... ..... .##.. .##.. .#...",
    "-": "..... ..... ..... .###. ..... ..... .....",
    ".": "..... ..... ..... ..... ..... .##.. .##..",
    "/": "..... ....# ...#. ..#.. .#... #.... .....",
    ":": "..... .##.. .##.. ..... .##.. .##.. .....",
    ";": "..... .##.. .##.. ..... .##.. .##.. .#...",
    "<": "...#. ..#.. .#... #.... .#... ..#.. ...#.",
    "=": "..... ..... ##### ..... ##### ..... .....",
    ">": ".#... ..#.. ...#. ....# ...#. ..#.. .#...",
    "?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
    "@": ".###. #...# ....# .##.# #.#.# #.#.# .###.",
    "[": ".###. .#... .#... .#... .#... .#... .###.",
    "\\": "..... #.... .#... ..#.. ...#. ....# .....",
    "]": ".###. ...#. ...#. ...#. ...#. ...#. .###.",
    "^": "..#.. .#.#. #...# ..... ..... ..... .....",
    "_": "..... ..... ..... ..... ..... ..... #####",
    "`": ".#... ..#.. ...#. ..... ..... ..... .....",
    "{": "...## ..#.. ..#.. .#... ..#.. ..#.. ...##",
    "|": "..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
    "}": "##... ..#.. ..#.. ...#. ..#.. ..#.. ##...",
    "~": "..... ..... .#... #.#.# ...#. ..... .....",
    "·": "..... ..... ..... ..#.. ..... ..... .....",   # ·
    "×": "..... #...# .#.#. ..#.. .#.#. #...# .....",   # ×
    "–": "..... ..... ..... ##### ..... ..... .....",   # –
    "—": "..... ..... ..... ##### ..... ..... .....",   # —
    "‘": "...#. ..#.. ..... ..... ..... ..... .....",   # ‘
    "’": "..#.. .#... ..... ..... ..... ..... .....",   # ’
    "“": "..#.# .#.#. ..... ..... ..... ..... .....",   # “
    "”": ".#.#. #.#.. ..... ..... ..... ..... .....",   # ”
    "…": "..... ..... ..... ..... ..... ..... #.#.#",   # …
    "✦": "..#.. ..#.. .###. ##### .###. ..#.. ..#..",   # ✦
    "▶": "#.... ##... ###.. ####. ###.. ##... #....",   # ▶
}


def outline(rows: list[str]):
    """One rectangle per run of lit pixels in a row, wound clockwise (TrueType)."""
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        top = (7 - r) * PIXEL
        bottom = top - PIXEL
        x = 0
        while x < len(row):
            if row[x] != "#":
                x += 1
                continue
            start = x
            while x < len(row) and row[x] == "#":
                x += 1
            left, right = start * PIXEL, x * PIXEL
            pen.moveTo((left, bottom))
            pen.lineTo((left, top))
            pen.lineTo((right, top))
            pen.lineTo((right, bottom))
            pen.closePath()
    return pen.glyph()


def name_of(char: str) -> str:
    return "space" if char == " " else f"uni{ord(char):04X}"


def build() -> FontBuilder:
    order = [".notdef"] + [name_of(c) for c in GLYPHS]
    glyphs, metrics, cmap = {}, {}, {}
    notdef = ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"]
    for name, rows in [(".notdef", notdef)] + [(name_of(c), GLYPHS[c].split()) for c in GLYPHS]:
        assert all(len(row) == 5 for row in rows) and len(rows) in (7, 8), name
        glyphs[name] = outline(rows)
        lit = [x for row in rows for x, cell in enumerate(row) if cell == "#"]
        metrics[name] = (ADVANCE, min(lit) * PIXEL if lit else 0)
    for char in GLYPHS:
        cmap[ord(char)] = name_of(char)
        # Small letters are the capitals.
        if char.isascii() and char.isalpha():
            cmap[ord(char.lower())] = name_of(char)
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=EM, descent=-2 * PIXEL)
    fb.setupNameTable({"familyName": "AniTrack Pixel", "styleName": "Regular", "uniqueFontIdentifier": "AniTrack Pixel Regular", "fullName": "AniTrack Pixel", "psName": "AniTrackPixel-Regular", "version": "Version 1.000"})
    fb.setupOS2(sTypoAscender=EM, sTypoDescender=-2 * PIXEL, sTypoLineGap=0, usWinAscent=EM, usWinDescent=2 * PIXEL, sxHeight=7 * PIXEL, sCapHeight=7 * PIXEL, fsType=0)
    fb.setupPost(isFixedPitch=1)
    return fb


if __name__ == "__main__":
    font = build()
    android = ROOT / "apps/android/app/src/main/res/font/city_pop_pixel.ttf"
    android.parent.mkdir(parents=True, exist_ok=True)
    font.save(android)
    desktop = ROOT / "apps/desktop/renderer/fonts/city-pop-pixel.woff"
    font.font.flavor = "woff"
    font.save(desktop)
    embedded = ROOT / "packages/shared/city-pop-pixel-font.ts"
    embedded.write_text(
        "/** City Pop's pixel font as base64 WOFF, for desktop's player window. Generated by scripts/build-city-pop-font.py. */\n"
        f'export const CITY_POP_PIXEL_WOFF = "{base64.b64encode(desktop.read_bytes()).decode()}";\n',
        encoding="utf-8", newline="\n",
    )
    for path in (android, desktop, embedded):
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size} bytes")
