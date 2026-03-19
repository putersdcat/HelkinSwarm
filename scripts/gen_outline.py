"""Generate a 32x32 white-on-transparent outline icon from the color icon."""
from PIL import Image

img = Image.open(r"appPackage/color.png").convert("RGBA")
img = img.resize((32, 32), Image.LANCZOS)

pixels = img.load()
for y in range(32):
    for x in range(32):
        r, g, b, a = pixels[x, y]
        if a > 128:
            pixels[x, y] = (255, 255, 255, a)
        else:
            pixels[x, y] = (0, 0, 0, 0)

img.save(r"appPackage/outline.png")
print("OK: outline.png saved")
