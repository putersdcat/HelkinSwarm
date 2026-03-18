from __future__ import annotations

import argparse
import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence, cast

from PIL import Image, ImageDraw

try:
    from rembg import new_session, remove
except ImportError:
    raise SystemExit("The 'rembg' package is required. Run: pip install rembg")

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg"}


@dataclass(frozen=True)
class SliceResult:
    source_file: str
    row: int
    col: int
    original_cell: str
    cropped_content: str
    output_size: str
    output_file: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Split 3x3 grid art sheets into square PNG sub-images "
            "with a high-quality AI alpha channel (rembg)."
        )
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory containing source PNG/JPG sheets.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "grid-ai-alpha-test",
        help="Directory where generated PNGs and review sheets will be written.",
    )
    parser.add_argument(
        "--files",
        nargs="*",
        help="Specific filenames to process from the input directory.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Process only N randomly selected files.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed used when --limit is set.",
    )
    parser.add_argument(
        "--grid-size",
        type=int,
        default=3,
        help="Grid dimension; default is 3 for a 3x3 sheet.",
    )
    parser.add_argument(
        "--padding",
        type=int,
        default=8,
        help="Transparent padding added around detected content before square fitting.",
    )
    parser.add_argument(
        "--min-size",
        type=int,
        default=64,
        help="Smallest allowed output dimension after 8px quantization.",
    )
    parser.add_argument(
        "--tighten-cell-to-multiple-of-8",
        action="store_true",
        help="Further crop each grid cell to the nearest 8px multiple before AI matting.",
    )
    parser.add_argument(
        "--alpha-matting",
        action="store_true",
        help="Enable enhanced alpha matting in rembg (can be slower but better on fuzzy edges).",
    )
    return parser.parse_args()


def discover_files(
    input_dir: Path,
    requested_files: Sequence[str] | None,
    limit: int,
    seed: int,
) -> list[Path]:
    if requested_files:
        files = [input_dir / name for name in requested_files]
    else:
        files = sorted(
            path
            for path in input_dir.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        )

    missing = [str(path.name) for path in files if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Requested files not found: {', '.join(missing)}")

    if limit and limit < len(files):
        rng = random.Random(seed)
        files = sorted(rng.sample(files, limit), key=lambda p: p.name.lower())

    return files


def crop_center_to_multiple(value: int, divisor: int) -> tuple[int, int]:
    target = value - (value % divisor)
    offset = (value - target) // 2
    return offset, target


def split_sheet_into_cells(
    image: Image.Image,
    grid_size: int,
    tighten_to_multiple_of_8: bool,
) -> list[tuple[int, int, Image.Image]]:
    width, height = image.size
    x_offset, cropped_width = crop_center_to_multiple(width, grid_size)
    y_offset, cropped_height = crop_center_to_multiple(height, grid_size)
    sheet = image.crop(
        (
            x_offset,
            y_offset,
            x_offset + cropped_width,
            y_offset + cropped_height,
        )
    )

    cell_w = cropped_width // grid_size
    cell_h = cropped_height // grid_size
    cells: list[tuple[int, int, Image.Image]] = []

    for row in range(grid_size):
        for col in range(grid_size):
            left = col * cell_w
            top = row * cell_h
            cell = sheet.crop((left, top, left + cell_w, top + cell_h))
            if tighten_to_multiple_of_8:
                side = min(cell.size)
                snapped = max(8, side - (side % 8))
                dx = (cell.width - snapped) // 2
                dy = (cell.height - snapped) // 2
                cell = cell.crop((dx, dy, dx + snapped, dy + snapped))
            cells.append((row + 1, col + 1, cell))

    return cells


def alpha_value(pixel: float | tuple[int, ...]) -> int:
    if isinstance(pixel, tuple):
        return int(pixel[0]) if pixel else 0
    return int(pixel)


def alpha_bbox(
    image: Image.Image,
    alpha_threshold: int = 10,
) -> tuple[int, int, int, int] | None:
    """Find bounds of visible content (ignoring highly transparent pixels)."""
    alpha = image.getchannel("A")
    width, height = image.size
    px = alpha.load()
    if px is None:
        raise RuntimeError("Unable to access alpha pixels.")

    min_x = width
    min_y = height
    max_x = -1
    max_y = -1

    for y in range(height):
        for x in range(width):
            if alpha_value(px[x, y]) >= alpha_threshold:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y

    if max_x == -1:
        return None

    return min_x, min_y, max_x + 1, max_y + 1


def quantize_square(
    image: Image.Image,
    min_size: int,
    padding: int,
) -> tuple[Image.Image, tuple[int, int]]:
    """Center cropped content onto a 192x192 or 256x256 absolute square."""
    bbox = alpha_bbox(image)
    if bbox is None:
        return Image.new("RGBA", (192, 192), (0, 0, 0, 0)), (0, 0)

    left, top, right, bottom = bbox
    content = image.crop(bbox)
    content_w = right - left
    content_h = bottom - top

    square_side = max(content_w, content_h) + padding * 2
    
    # Snap exactly to [192, 256]
    allowed_sizes = [192, 256]
    # Pick the closest size, or max if larger
    if square_side <= 192:
        quantized_side = 192
    elif square_side <= 224:
        quantized_side = 192
    else:
        quantized_side = 256

    base = Image.new("RGBA", (quantized_side, quantized_side), (0, 0, 0, 0))

    if max(content.size) > quantized_side - padding * 2:
        fit_side = max(8, quantized_side - padding * 2)
        scale = min(fit_side / content_w, fit_side / content_h)
        resized = content.resize(
            (
                max(1, int(round(content_w * scale))),
                max(1, int(round(content_h * scale))),
            ),
            resample=Image.Resampling.LANCZOS,
        )
    else:
        resized = content

    x = (quantized_side - resized.width) // 2
    y = (quantized_side - resized.height) // 2
    base.alpha_composite(resized, dest=(x, y))
    return base, (content_w, content_h)


def checkerboard(size: tuple[int, int], block: int = 16) -> Image.Image:
    width, height = size
    img = Image.new("RGBA", size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    light = (236, 236, 236, 255)
    dark = (196, 196, 196, 255)

    for y in range(0, height, block):
        for x in range(0, width, block):
            color = light if ((x // block) + (y // block)) % 2 == 0 else dark
            draw.rectangle((x, y, x + block - 1, y + block - 1), fill=color)

    return img


def build_contact_sheet(
    source_name: str,
    rendered_cells: Sequence[tuple[str, Image.Image]],
    output_dir: Path,
) -> None:
    thumb_side = 224
    padding = 24
    columns = 3
    rows = math.ceil(len(rendered_cells) / columns)
    width = padding + columns * (thumb_side + padding)
    height = padding + rows * (thumb_side + 52 + padding)

    sheet = Image.new("RGBA", (width, height), (250, 250, 250, 255))
    draw = ImageDraw.Draw(sheet)

    for index, (label, icon) in enumerate(rendered_cells):
        row = index // columns
        col = index % columns
        x = padding + col * (thumb_side + padding)
        y = padding + row * (thumb_side + 52 + padding)

        tile = checkerboard((thumb_side, thumb_side))
        preview = icon.copy()
        preview.thumbnail(
            (thumb_side - 16, thumb_side - 16),
            resample=Image.Resampling.LANCZOS,
        )
        px = (thumb_side - preview.width) // 2
        py = (thumb_side - preview.height) // 2
        tile.alpha_composite(preview, dest=(px, py))
        sheet.alpha_composite(tile, dest=(x, y))
        draw.rectangle(
            (x, y, x + thumb_side, y + thumb_side),
            outline=(140, 140, 140, 255),
            width=1,
        )
        draw.text((x, y + thumb_side + 8), label, fill=(20, 20, 20, 255))

    out_path = output_dir / f"{Path(source_name).stem}__contact-sheet.png"
    sheet.save(out_path)


def process_file(
    path: Path,
    args: argparse.Namespace,
    output_dir: Path,
    ai_session: Any,
) -> list[SliceResult]:
    image = Image.open(path).convert("RGBA")
    cells = split_sheet_into_cells(
        image,
        args.grid_size,
        args.tighten_cell_to_multiple_of_8,
    )
    results: list[SliceResult] = []
    contact_cells: list[tuple[str, Image.Image]] = []

    print(f"  > AI processing {len(cells)} cells...")
    for row, col, cell in cells:
        print(f"    - slicing r{row}c{col}...", end="", flush=True)

        # AI-based background removal
        transparent = remove(
            cell,
            session=ai_session,
            alpha_matting=args.alpha_matting,
            # post_process_mask works nicely with vector-ish drone art
            post_process_mask=True, 
        )

        output_image, (content_w, content_h) = quantize_square(
            transparent,
            args.min_size,
            args.padding,
        )
        print(" done.")

        size_label = f"{output_image.width}x{output_image.height}"
        out_name = f"{path.stem}__r{row}c{col}__{size_label}.png"
        out_path = output_dir / out_name
        output_image.save(out_path)

        results.append(
            SliceResult(
                source_file=path.name,
                row=row,
                col=col,
                original_cell=f"{cell.width}x{cell.height}",
                cropped_content=f"{content_w}x{content_h}",
                output_size=size_label,
                output_file=out_name,
            )
        )
        contact_cells.append((f"r{row}c{col} • {size_label}", output_image))

    build_contact_sheet(path.name, contact_cells, output_dir)
    return results


def write_manifest(output_dir: Path, results: Iterable[SliceResult]) -> None:
    manifest_path = output_dir / "manifest.csv"
    with manifest_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "source_file",
                "row",
                "col",
                "original_cell",
                "cropped_content",
                "output_size",
                "output_file",
            ]
        )
        for result in results:
            writer.writerow(
                [
                    result.source_file,
                    result.row,
                    result.col,
                    result.original_cell,
                    result.cropped_content,
                    result.output_size,
                    result.output_file,
                ]
            )


def main() -> None:
    args = parse_args()
    args.input_dir = args.input_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    files = discover_files(args.input_dir, args.files, args.limit, args.seed)
    if not files:
        raise SystemExit("No matching source files found.")

    print(f"Loading rembg U2-Net model...")
    session = new_session("u2net")

    print(f"Processing {len(files)} file(s) from {args.input_dir}")
    all_results: list[SliceResult] = []
    
    for path in files:
        print(f"- {path.name}")
        all_results.extend(process_file(path, args, args.output_dir, session))

    write_manifest(args.output_dir, all_results)
    print(f"Wrote {len(all_results)} slice PNGs to {args.output_dir}")
    print(f"Manifest: {args.output_dir / 'manifest.csv'}")


if __name__ == "__main__":
    main()
