"""Hoja de control de un ícono: al lado de sus vecinos, a 36 y 64 px.

Un ícono se decide así, no mirando el de 1024: el problema aparece en chico y
al lado de otros (skill dark-app-aesthetics, §12). Debajo, los tamaños chicos
del .ico ampliados por vecino más cercano, para ver cada píxel.

Uso: python tools/icon-sheet.py <build/icon.png> <build/icon.ico> <salida.png>
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw

png, ico, out = (Path(a) for a in sys.argv[1:4])
NEIGHBORS = [
    Path(r"S:\tools\Atlas\build\icon.png"),
    Path(r"S:\tools\Pharos\build\icon.png"),
    Path(r"S:\tools\Tessera\build\icon.png"),
    Path(r"S:\tools\Verba\build\icon.png"),
]
icons = [png] + [n for n in NEIGHBORS if n.exists()]
BG = (32, 33, 37, 255)  # una barra de tareas oscura
PAD = 18

def row(size):
    imgs = [Image.open(p).convert("RGBA").resize((size, size), Image.LANCZOS) for p in icons]
    w = PAD + len(imgs) * (size + PAD)
    canvas = Image.new("RGBA", (w, size + PAD * 2), BG)
    for i, im in enumerate(imgs):
        canvas.alpha_composite(im, (PAD + i * (size + PAD), PAD))
    return canvas

rows = [row(36), row(64)]

# Los tamaños chicos del .ico, tal cual están dibujados, ampliados x6.
ico_img = Image.open(ico)
small = []
for s in (16, 20, 24, 32):
    ico_img.size = (s, s)
    small.append(ico_img.convert("RGBA").resize((s * 6, s * 6), Image.NEAREST))
w = PAD + sum(im.width + PAD for im in small)
zoom = Image.new("RGBA", (w, max(im.height for im in small) + PAD * 2), BG)
x = PAD
for im in small:
    zoom.alpha_composite(im, (x, PAD))
    x += im.width + PAD
rows.append(zoom)

sheet = Image.new("RGBA", (max(r.width for r in rows), sum(r.height for r in rows)), BG)
y = 0
for r in rows:
    sheet.alpha_composite(r, (0, y))
    y += r.height
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out)
print(f"hoja de control: {out} ({len(icons) - 1} vecinos)")
