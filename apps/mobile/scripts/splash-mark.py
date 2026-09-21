# Recorta la P lima de assets/icon.png a fondo transparente para el splash (spec mobile-loading D6, P7 del plan F1).
# Flood fill desde los bordes: el fondo violeta es conexo y rodea la P; la cara oscura interior queda protegida por
# el contorno lima. Salida 720×720 con margen. Uso: python3 scripts/splash-mark.py assets/icon.png assets/splash-mark.png
import sys
from PIL import Image, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
w, h = im.size
KEY = (0, 255, 0, 255)  # color temporal que no existe en el icono
for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)):
    ImageDraw.floodfill(im, (x, y), KEY, thresh=140)
px = im.load()
for y in range(h):
    for x in range(w):
        if px[x, y] == KEY:
            px[x, y] = (0, 0, 0, 0)
bbox = im.getbbox()
crop = im.crop(bbox)
side = max(crop.size) + 40
out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
out.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
out = out.resize((720, 720), Image.LANCZOS)
out.save(dst)
print("bbox", bbox, "->", out.size)
