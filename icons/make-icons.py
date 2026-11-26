"""Génère les icônes de l'app (192 et 512 px) à partir de l'icône du Cockpit.

Usage, depuis la racine du coffre :
    python3 Systeme/Cockpit/app/icons/make-icons.py
"""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE.parents[2] / "icone-cockpit.png"  # Systeme/icone-cockpit.png

src = Image.open(SRC).convert("RGB")
for size in (192, 512, 180):
    name = "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
    img = src.resize((size, size), Image.LANCZOS)
    # palette réduite : fichier léger, rendu identique à l'œil
    img = img.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.NONE)
    img.save(HERE / name, optimize=True)
    print(name, (HERE / name).stat().st_size, "octets")
