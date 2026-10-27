#!/usr/bin/env python3
"""Run TU Scale's bundled waifu2x model outside the browser UI thread."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image


MODEL_PADDING = 7
DEFAULT_TILE_SIZE = 192
MAX_INPUT_EDGE = 6000
MAX_INPUT_PIXELS = 24_000_000


def create_session(model_path: Path) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.intra_op_num_threads = 0
    return ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def model_byte(values: np.ndarray) -> np.ndarray:
    return np.rint(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8)


def upscale(
    input_path: Path,
    output_path: Path,
    model_path: Path,
    tile_size: int,
) -> None:
    with Image.open(input_path) as opened:
        source = np.asarray(opened.convert("RGBA"), dtype=np.uint8)

    height, width = source.shape[:2]
    if width > MAX_INPUT_EDGE or height > MAX_INPUT_EDGE or width * height > MAX_INPUT_PIXELS:
        raise ValueError(
            f"AI input is too large: {width}x{height}; "
            f"maximum edge {MAX_INPUT_EDGE}, maximum pixels {MAX_INPUT_PIXELS}"
        )

    session = create_session(model_path)
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    output = np.empty((height * 2, width * 2, 4), dtype=np.uint8)

    for core_y in range(0, height, tile_size):
        core_height = min(tile_size, height - core_y)
        input_height = core_height + MODEL_PADDING * 2 + core_height % 2
        source_y = np.clip(
            np.arange(core_y - MODEL_PADDING, core_y - MODEL_PADDING + input_height),
            0,
            height - 1,
        )

        for core_x in range(0, width, tile_size):
            core_width = min(tile_size, width - core_x)
            input_width = core_width + MODEL_PADDING * 2 + core_width % 2
            source_x = np.clip(
                np.arange(core_x - MODEL_PADDING, core_x - MODEL_PADDING + input_width),
                0,
                width - 1,
            )
            rgb = source[source_y[:, None], source_x[None, :], :3]
            tensor = np.transpose(rgb.astype(np.float32) / 255.0, (2, 0, 1))[None, ...]
            prediction = session.run([output_name], {input_name: tensor})[0][0]

            copy_width = core_width * 2
            copy_height = core_height * 2
            if prediction.shape[1] < copy_height or prediction.shape[2] < copy_width:
                raise RuntimeError(
                    "AI_MODEL_OUTPUT_MISMATCH: "
                    f"got {prediction.shape[2]}x{prediction.shape[1]}, "
                    f"need {copy_width}x{copy_height}"
                )

            rgb_output = np.transpose(
                prediction[:, :copy_height, :copy_width],
                (1, 2, 0),
            )
            output[
                core_y * 2 : (core_y + core_height) * 2,
                core_x * 2 : (core_x + core_width) * 2,
                :3,
            ] = model_byte(rgb_output)

            alpha = source[
                core_y : core_y + core_height,
                core_x : core_x + core_width,
                3,
            ]
            output[
                core_y * 2 : (core_y + core_height) * 2,
                core_x * 2 : (core_x + core_width) * 2,
                3,
            ] = np.repeat(np.repeat(alpha, 2, axis=0), 2, axis=1)

    Image.fromarray(output, "RGBA").save(output_path, format="PNG", compress_level=3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--tile-size", type=int, default=DEFAULT_TILE_SIZE)
    args = parser.parse_args()

    if not args.model.is_file():
        raise FileNotFoundError(f"waifu2x model not found: {args.model}")
    tile_size = max(64, min(384, args.tile_size))
    upscale(args.input, args.output, args.model, tile_size)


if __name__ == "__main__":
    main()
