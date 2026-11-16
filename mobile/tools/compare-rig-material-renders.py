"""Measure a diagnostic pixel difference between two deterministic rig renders.

    python3 tools/compare-rig-material-renders.py source.png candidate.png report.json

This tool intentionally does not assert a material-fidelity threshold. A source
Blender render and an imported GLB can have camera or geometry registration
differences, and no approved visual threshold exists, so its output is
diagnostic evidence only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def arguments() -> tuple[Path, Path, Path]:
    if len(sys.argv) != 4:
        raise RuntimeError("Pass source PNG, candidate PNG and output JSON")
    source, candidate, output = (Path(value).expanduser().resolve() for value in sys.argv[1:])
    if source.suffix.lower() != ".png" or candidate.suffix.lower() != ".png" or output.suffix.lower() != ".json":
        raise RuntimeError("Expected source PNG, candidate PNG and output JSON")
    output.parent.mkdir(parents=True, exist_ok=True)
    return source, candidate, output


def main() -> None:
    source_path, candidate_path, output_path = arguments()
    source = Image.open(source_path).convert("RGB")
    candidate = Image.open(candidate_path).convert("RGB")
    if source.size != candidate.size:
        raise RuntimeError(f"Image dimensions differ: {source.size} vs {candidate.size}")
    difference = ImageChops.difference(source, candidate)
    statistics = ImageStat.Stat(difference)
    pixel_count = source.width * source.height
    non_identical = sum(pixel != (0, 0, 0) for pixel in difference.get_flattened_data())
    report = {
        "schema": "vozual.material-render-diagnostic",
        "schemaVersion": 1,
        "source": source_path.name,
        "candidate": candidate_path.name,
        "resolution": list(source.size),
        "meanAbsoluteChannelDelta8Bit": [round(value, 6) for value in statistics.mean],
        "rmsChannelDelta8Bit": [round(value, 6) for value in statistics.rms],
        "nonIdenticalPixelFraction": round(non_identical / pixel_count, 9),
        "disposition": "diagnostic-only-no-approved-material-fidelity-threshold",
    }
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
