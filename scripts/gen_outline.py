"""Generate a 32x32 white-on-transparent Teams outline icon.

Modes
------
basic (default)
    Naive pass: any opaque pixel → white, transparent stays transparent.
    Fast, no dependencies beyond Pillow.

skeleton  (--skeleton / -s)
    HSV saturation filter isolates the grey metallic structure and discards
    high-saturation glowing orbs.  The skeleton mask is scaled to 32×32 then
    binarised with a tight threshold to preserve ring/lattice openings and
    avoid the muddy "white ball" effect of the basic mode.
    Requires numpy in addition to Pillow.

Usage
------
    # basic (default)
    python scripts/gen_outline.py

    # skeleton (advanced)
    python scripts/gen_outline.py --skeleton

    # custom paths
    python scripts/gen_outline.py -i visualAssets/rawIcons/master.png -o appPackage/outline.png --skeleton
"""
import argparse
from pathlib import Path

from PIL import Image


# ---------------------------------------------------------------------------
# Basic mode
# ---------------------------------------------------------------------------

def gen_outline_basic(src: Path, out: Path) -> None:
    """Flatten every opaque pixel to white, keep transparency."""
    img = Image.open(src).convert("RGBA")
    img = img.resize((32, 32), Image.LANCZOS)
    pixels = img.load()
    for y in range(32):
        for x in range(32):
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (255, 255, 255, a) if a > 128 else (0, 0, 0, 0)
    img.save(out)
    print(f"OK [basic]: {out}")


# ---------------------------------------------------------------------------
# Skeleton mode  (HSV saturation filter)
# ---------------------------------------------------------------------------

def gen_outline_skeleton(src: Path, out: Path) -> None:
    """Isolate the metallic skeleton by filtering out high-saturation glowing cores.

    Steps
    -----
    1. Open at full source resolution and extract the alpha channel.
    2. Convert to HSV; the glowing purple/blue orbs have high saturation while
       the grey metal chassis has low saturation.
    3. Build a mask: keep pixels where saturation < 60 AND original alpha > 128.
    4. Scale the skeleton mask to 32×32 with LANCZOS.
    5. Binarise strictly (threshold 160) — this erodes enough at quantisation to
       keep rings and lattice openings punched through rather than bridging over.
    6. Paint everything white, using the extracted skeleton as the alpha stencil.
    """
    import numpy as np  # local import — only needed for skeleton mode

    img = Image.open(src).convert("RGBA")
    alpha = np.array(img.split()[-1])

    hsv_img = img.convert("HSV")
    _, s, _ = hsv_img.split()
    s_np = np.array(s)

    # Low-saturation pixels inside the original alpha bounds = metallic structure
    mask = (s_np < 60) & (alpha > 128)
    metal_alpha = Image.fromarray((mask * 255).astype("uint8"), mode="L")

    # Downscale skeleton mask
    sm = metal_alpha.resize((32, 32), Image.Resampling.LANCZOS)
    sm_np = np.array(sm)

    # Hard binarise: maximises negative space through rings, prevents bridging
    sm_np = np.where(sm_np > 160, 255, 0).astype("uint8")

    final = Image.new("RGBA", (32, 32), (255, 255, 255, 255))
    final.putalpha(Image.fromarray(sm_np, mode="L"))
    final.save(out)
    print(f"OK [skeleton]: {out}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a 32×32 white-on-transparent Teams outline icon.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=Path("appPackage/color.png"),
        metavar="PATH",
        help="Source icon path (default: appPackage/color.png)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=Path("appPackage/outline.png"),
        metavar="PATH",
        help="Output path (default: appPackage/outline.png)",
    )
    parser.add_argument(
        "--skeleton", "-s",
        action="store_true",
        help=(
            "Advanced mode: use HSV saturation filter to extract the metallic "
            "skeleton, discarding high-saturation glowing orbs.  Requires numpy."
        ),
    )
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    if args.skeleton:
        gen_outline_skeleton(args.input, args.output)
    else:
        gen_outline_basic(args.input, args.output)


if __name__ == "__main__":
    main()

