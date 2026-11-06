"""Assemble actual UI captures into a compact README walkthrough (requires Pillow)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
paths = sorted((root / "test-results/demo-frames").glob("*.png"))
if len(paths) != 4:
    raise SystemExit("Run node scripts/capture-demo.mjs first; expected four UI frames.")
frames = []
for path in paths:
    with Image.open(path) as image:
        frames.append(image.convert("RGB").resize((990, 684), Image.Resampling.LANCZOS)
                      .quantize(colors=192, method=Image.Quantize.MEDIANCUT))
output = root / "docs/assets/walkthrough.gif"
frames[0].save(output, save_all=True, append_images=frames[1:],
               duration=[2200, 1800, 2400, 1800], loop=0, optimize=True, disposal=2)
print(f"Saved {output.name}: {output.stat().st_size / 1024:.0f} KB")
