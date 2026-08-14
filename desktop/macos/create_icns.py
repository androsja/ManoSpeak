"""Create a classic ICNS file from PNG images without external packages."""

from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
import struct

from PIL import Image


ICON_TYPES = {
    16: b"icp4",
    32: b"icp5",
    64: b"icp6",
    128: b"ic07",
    256: b"ic08",
    512: b"ic09",
    1024: b"ic10",
}


def png_payload(image: Image.Image, size: int) -> bytes:
    rendered = image.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    output = BytesIO()
    rendered.save(output, format="PNG", optimize=True)
    return output.getvalue()


def create_icns(source: Path, destination: Path) -> None:
    image = Image.open(source)
    elements = []
    for size, icon_type in ICON_TYPES.items():
        payload = png_payload(image, size)
        elements.append(icon_type + struct.pack(">I", len(payload) + 8) + payload)
    body = b"".join(elements)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    create_icns(args.source, args.destination)


if __name__ == "__main__":
    main()
