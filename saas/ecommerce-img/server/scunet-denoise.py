#!/usr/bin/env python3
"""Local-only SCUNet proxy denoise for TU Scale's desktop AI service."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from denoise_detail import recover_luminance_detail


DEFAULT_MODEL = (
    Path(__file__).resolve().parent.parent
    / "waifu2x"
    / "models-scunet"
    / "scunet_color_real_psnr.onnx"
)
PROXY_LONG_EDGE = 1024
BAND_HEIGHT = 256


def image_to_tensor(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return np.transpose(rgb, (2, 0, 1))[None, ...]


def tensor_to_rgb(tensor: np.ndarray) -> Image.Image:
    rgb = np.transpose(np.clip(tensor[0], 0.0, 1.0), (1, 2, 0))
    return Image.fromarray(np.rint(rgb * 255.0).astype(np.uint8), "RGB")


def multiple_of_64(value: float) -> int:
    return max(64, round(value / 64) * 64)


def proxy_size(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, PROXY_LONG_EDGE / max(width, height))
    return multiple_of_64(width * scale), multiple_of_64(height * scale)


def create_session(model_path: Path) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def render_proxy_result(
    source_rgb: Image.Image,
    denoised_proxy: Image.Image,
    source_proxy: Image.Image,
    correction_strength: float = 0.88,
) -> Image.Image:
    width, height = source_rgb.size
    proxy = np.asarray(source_proxy, dtype=np.float32) / 255.0
    denoised = np.asarray(denoised_proxy, dtype=np.float32) / 255.0
    correction = np.clip(denoised - proxy, -0.20, 0.20)
    encoded = Image.fromarray(
        np.rint((correction + 0.5) * 255.0).clip(0, 255).astype(np.uint8),
        "RGB",
    ).resize((width, height), Image.Resampling.BICUBIC)

    corrected = Image.new("RGB", (width, height))
    for top in range(0, height, BAND_HEIGHT):
        bottom = min(height, top + BAND_HEIGHT)
        source_band = np.asarray(source_rgb.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        correction_band = np.asarray(encoded.crop((0, top, width, bottom)), dtype=np.float32) / 255.0 - 0.5
        result = np.clip(source_band + correction_band * correction_strength, 0.0, 1.0)
        corrected.paste(
            Image.fromarray(np.rint(result * 255.0).astype(np.uint8), "RGB"),
            (0, top),
        )

    smooth = corrected.resize(source_proxy.size, Image.Resampling.LANCZOS).resize(
        (width, height), Image.Resampling.BICUBIC
    )
    heavy = Image.new("RGB", (width, height))
    for top in range(0, height, BAND_HEIGHT):
        bottom = min(height, top + BAND_HEIGHT)
        source_band = np.asarray(source_rgb.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        corrected_band = np.asarray(corrected.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        smooth_band = np.asarray(smooth.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        detail = source_band - smooth_band
        luminance = (
            source_band[..., 0] * 0.2126
            + source_band[..., 1] * 0.7152
            + source_band[..., 2] * 0.0722
        )
        detail_energy = np.max(np.abs(detail), axis=2)
        edge_keep = np.clip((detail_energy - 0.015) / 0.055, 0.0, 1.0)
        dark_weight = np.clip((0.58 - luminance) / 0.45, 0.0, 1.0)
        suppress = dark_weight * (1.0 - edge_keep) * correction_strength * 0.72
        result = np.clip(corrected_band - detail * suppress[..., None], 0.0, 1.0)
        heavy.paste(
            Image.fromarray(np.rint(result * 255.0).astype(np.uint8), "RGB"),
            (0, top),
        )
    return heavy


def blend_with_source(source_rgb: Image.Image, heavy: Image.Image, strength: float) -> Image.Image:
    width, height = source_rgb.size
    # UI 35–100% maps to a conservative 28–70% AI contribution. The default
    # 75% setting contributes about 54%, which was selected from the real 24 MP
    # night-photo comparison to avoid the full model's plastic look.
    ai_mix = 0.28 + np.clip((strength - 0.35) / 0.65, 0.0, 1.0) * 0.42
    output = Image.new("RGB", (width, height))
    for top in range(0, height, BAND_HEIGHT):
        bottom = min(height, top + BAND_HEIGHT)
        source = np.asarray(source_rgb.crop((0, top, width, bottom)), dtype=np.float32)
        denoised = np.asarray(heavy.crop((0, top, width, bottom)), dtype=np.float32)
        luma = source[..., 0] * 0.2126 + source[..., 1] * 0.7152 + source[..., 2] * 0.0722
        dx = np.zeros_like(luma)
        dy = np.zeros_like(luma)
        dx[:, 1:] = np.abs(luma[:, 1:] - luma[:, :-1])
        dy[1:, :] = np.abs(luma[1:, :] - luma[:-1, :])
        edge = np.clip((np.maximum(dx, dy) - 4.0) / 24.0, 0.0, 1.0)
        dark = np.clip((175.0 - luma) / 105.0, 0.0, 1.0)
        weight = ai_mix * dark * (1.0 - 0.78 * edge)
        result = np.clip(
            source * (1.0 - weight[..., None]) + denoised * weight[..., None],
            0.0,
            255.0,
        )
        output.paste(Image.fromarray(np.rint(result).astype(np.uint8), "RGB"), (0, top))
    return output


def denoise(
    input_path: Path,
    output_path: Path,
    model_path: Path,
    strength: float,
    clarity: float,
) -> None:
    with Image.open(input_path) as opened:
        source = opened.convert("RGBA")
    alpha = source.getchannel("A")
    source_rgb = source.convert("RGB")
    size = proxy_size(*source_rgb.size)
    source_proxy = source_rgb.resize(size, Image.Resampling.LANCZOS)
    session = create_session(model_path)
    output = session.run(
        None,
        {session.get_inputs()[0].name: image_to_tensor(source_proxy)},
    )[0]
    denoised_proxy = tensor_to_rgb(output)
    heavy = render_proxy_result(source_rgb, denoised_proxy, source_proxy)
    final_rgb = blend_with_source(source_rgb, heavy, strength)
    final_rgb = recover_luminance_detail(source_rgb, final_rgb, clarity)
    final = final_rgb.convert("RGBA")
    final.putalpha(alpha)
    final.save(output_path, format="PNG")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--strength", type=float, default=0.75)
    parser.add_argument("--clarity", type=float, default=0.0)
    args = parser.parse_args()
    if not args.model.is_file():
        raise FileNotFoundError(f"SCUNet model not found: {args.model}")
    denoise(
        args.input,
        args.output,
        args.model,
        float(np.clip(args.strength, 0.35, 1.0)),
        float(np.clip(args.clarity, 0.0, 1.0)),
    )


if __name__ == "__main__":
    main()
