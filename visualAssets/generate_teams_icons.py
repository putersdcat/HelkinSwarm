import argparse
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

def generate_color_icon(image_path: Path, output_path: Path):
    """Generate the standard 192x192 color.png"""
    img = Image.open(image_path).convert("RGBA")
    color_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    color_192.save(output_path)
    print(f"Saved color icon to {output_path}")

def generate_outline_icon(image_path: Path, output_path: Path):
    """Generate the 32x32 outline.png. 
    
    This technique isolates the grey metallic skeleton of the drone by filtering 
    out the high-saturation glowing orbs, punching holes completely through the 
    center loops and preserving the internal lattice structure before scaling 
    down to 32x32.
    """
    # 1. Open main image exactly at original high res
    img = Image.open(image_path).convert("RGBA")
    alpha = np.array(img.split()[-1])
    
    # 2. Convert to HSV. The glowing objects (purple, blue) have high saturation, 
    #    while the metal structure is mostly grey (low saturation).
    hsv_img = img.convert("HSV")
    _, s, _ = hsv_img.split()
    s_np = np.array(s)
    
    # 3. Create a logic mask: keep pixels where saturation is low (metal) 
    #    AND it's inside the original alpha bounds.
    #    saturation threshold of ~60 out of 255 cleanly cuts out the bright glowing cores.
    mask = np.logical_and(s_np < 60, alpha > 128)
    
    # Convert mask to 0-255 image mask
    metal_alpha_np = (mask * 255).astype(np.uint8)
    metal_img = Image.fromarray(metal_alpha_np, mode="L")
    
    # 4. Scale the clean metal chassis mask down to 32x32 natively
    sm_img = metal_img.resize((32, 32), Image.Resampling.LANCZOS)
    sm_np = np.array(sm_img)
    
    # 5. Crisp up the edges by binarizing it with a strict threshold.
    #    A tight threshold (>160) organically erodes the lines just enough 
    #    on quantization to maximize negative space through the rings,
    #    preventing structural bridging (the muddy "white ball" effect).
    sm_np[sm_np > 160] = 255
    sm_np[sm_np <= 160] = 0
    sm_bin = Image.fromarray(sm_np, mode="L")
    
    # 6. Paint entirely white, using our delicately extracted skeleton as the stencil
    final_img = Image.new("RGBA", (32, 32), (255, 255, 255, 255))
    final_img.putalpha(sm_bin)

    final_img.save(output_path)
    print(f"Saved thinned skeletonized outline icon to {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Extract metallic skeletal 32x32 outline icons for Teams apps")
    parser.add_argument("--input", type=Path, required=True, help="Path to input master transparent icon")
    parser.add_argument("--out-dir", type=Path, default=Path("appPackage"), help="Output directory (defaults to appPackage)")
    args = parser.parse_args()
    
    args.out_dir.mkdir(parents=True, exist_ok=True)
    
    color_out = args.out_dir / "color.png"
    outline_out = args.out_dir / "outline.png"
    
    generate_color_icon(args.input, color_out)
    generate_outline_icon(args.input, outline_out)

if __name__ == "__main__":
    main()
