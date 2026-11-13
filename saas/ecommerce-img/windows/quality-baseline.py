#!/usr/bin/env python3
"""Capture a reproducible, offline waifu2x quality baseline from native-pixel crops."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps


APP_ROOT = Path(__file__).resolve().parents[1]
MODEL = APP_ROOT / "public" / "models" / "waifu2x.onnx"
UPSCALE_SCRIPT = APP_ROOT / "windows" / "server" / "waifu2x-upscale.py"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_crops(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"id", "category", "local_path", "sha256", "crop_x", "crop_y", "crop_size"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"CSV needs columns: {', '.join(sorted(required))}")
        rows = list(reader)
    if not rows or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("CSV must contain unique, nonempty sample IDs")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=MODEL)
    parser.add_argument("--tile-size", type=int, default=192)
    args = parser.parse_args()

    crops_path = args.crops.resolve(strict=True)
    model_path = args.model.resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite an existing run: {output}")
    if not 64 <= args.tile_size <= 384:
        raise ValueError("Tile size must be between 64 and 384")
    rows = read_crops(crops_path)
    output.mkdir(parents=True)
    (output / "run.json").write_text(
        json.dumps(
            {
                "started_utc": datetime.now(timezone.utc).isoformat(),
                "python": sys.version,
                "model": str(model_path),
                "model_sha256": sha256(model_path),
                "upscale_script_sha256": sha256(UPSCALE_SCRIPT),
                "crops_csv_sha256": sha256(crops_path),
                "tile_size": args.tile_size,
                "notes": "Native-pixel crops; local ONNX CPU path. Not a browser or full-image benchmark.",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    report_path = output / "results.csv"
    fields = [
        "id", "category", "source_sha256", "crop_x", "crop_y", "crop_size",
        "output_width", "output_height", "inference_seconds",
        "input_sha256", "waifu2x_sha256", "bicubic_sha256",
    ]
    with report_path.open("w", encoding="utf-8-sig", newline="") as report:
        writer = csv.DictWriter(report, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            sample_id = row["id"]
            if not sample_id.isascii() or not sample_id.replace("-", "").isalnum():
                raise ValueError(f"Unsafe sample ID: {sample_id}")
            source_path = Path(row["local_path"]).resolve(strict=True)
            actual_sha = sha256(source_path)
            if actual_sha != row["sha256"].lower():
                raise ValueError(f"Source SHA-256 mismatch: {sample_id}")
            left, top, size = (int(row[key]) for key in ("crop_x", "crop_y", "crop_size"))
            with Image.open(source_path) as opened:
                image = ImageOps.exif_transpose(opened)
                if left < 0 or top < 0 or size < 64 or left + size > image.width or top + size > image.height:
                    raise ValueError(f"Crop outside image: {sample_id}")
                crop = image.crop((left, top, left + size, top + size)).convert("RGBA")
            input_path = output / f"{sample_id}-input.png"
            waifu_path = output / f"{sample_id}-waifu2x.png"
            bicubic_path = output / f"{sample_id}-bicubic.png"
            crop.save(input_path, format="PNG")
            crop.resize((size * 2, size * 2), Image.Resampling.BICUBIC).save(
                bicubic_path, format="PNG"
            )
            started = time.perf_counter()
            subprocess.run(
                [
                    sys.executable, str(UPSCALE_SCRIPT), str(input_path), str(waifu_path),
                    "--model", str(model_path), "--tile-size", str(args.tile_size),
                ],
                check=True,
            )
            elapsed = time.perf_counter() - started
            with Image.open(waifu_path) as result:
                if result.size != (size * 2, size * 2):
                    raise ValueError(f"Unexpected output dimensions: {sample_id}")
            writer.writerow(
                {
                    "id": sample_id,
                    "category": row["category"],
                    "source_sha256": actual_sha,
                    "crop_x": left,
                    "crop_y": top,
                    "crop_size": size,
                    "output_width": size * 2,
                    "output_height": size * 2,
                    "inference_seconds": f"{elapsed:.3f}",
                    "input_sha256": sha256(input_path),
                    "waifu2x_sha256": sha256(waifu_path),
                    "bicubic_sha256": sha256(bicubic_path),
                }
            )
            report.flush()
            print(f"{sample_id}: {size}x{size} -> {size * 2}x{size * 2}, {elapsed:.2f}s")


if __name__ == "__main__":
    main()
