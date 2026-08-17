#!/usr/bin/env python3
"""Local-only DRUNet proxy denoise for TU Scale's desktop AI service."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

from denoise_detail import recover_luminance_detail


DEFAULT_MODEL = (
    Path(__file__).resolve().parent.parent
    / "waifu2x"
    / "models-drunet"
    / "drunet_color.onnx"
)
PROXY_LONG_EDGE = 1024
BAND_HEIGHT = 256


def image_to_tensor(image: Image.Image, noise_sigma: float) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    chw = np.transpose(rgb, (2, 0, 1))
    noise_map = np.full((1, rgb.shape[0], rgb.shape[1]), noise_sigma / 255.0, dtype=np.float32)
    return np.concatenate((chw, noise_map), axis=0)[None, ...]


def tensor_to_rgb(tensor: np.ndarray) -> Image.Image:
    rgb = np.transpose(np.clip(tensor[0], 0.0, 1.0), (1, 2, 0))
    return Image.fromarray(np.rint(rgb * 255.0).astype(np.uint8), "RGB")


def multiple_of_8(value: float) -> int:
    return max(8, round(value / 8) * 8)


def proxy_size(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, PROXY_LONG_EDGE / max(width, height))
    return multiple_of_8(width * scale), multiple_of_8(height * scale)


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
    correction_strength: float = 0.86,
) -> Image.Image:
    width, height = source_rgb.size
    proxy = np.asarray(source_proxy, dtype=np.float32) / 255.0
    denoised = np.asarray(denoised_proxy, dtype=np.float32) / 255.0
    correction = np.clip(denoised - proxy, -0.18, 0.18)
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
    proxy_blur = source_proxy.filter(ImageFilter.GaussianBlur(radius=1.15))
    proxy_structure = np.max(
        np.abs(
            np.asarray(source_proxy, dtype=np.float32)
            - np.asarray(proxy_blur, dtype=np.float32)
        ),
        axis=2,
    )
    structure_mask = Image.fromarray(
        np.rint(np.clip((proxy_structure - 1.6) / 8.0, 0.0, 1.0) * 255.0).astype(np.uint8),
        "L",
    ).resize((width, height), Image.Resampling.BILINEAR)
    smooth = corrected.resize(source_proxy.size, Image.Resampling.LANCZOS).resize(
        (width, height), Image.Resampling.BICUBIC
    )
    softened = Image.new("RGB", (width, height))
    for top in range(0, height, BAND_HEIGHT):
        bottom = min(height, top + BAND_HEIGHT)
        source_band = np.asarray(source_rgb.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        corrected_band = np.asarray(corrected.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        smooth_band = np.asarray(smooth.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        structure = np.asarray(structure_mask.crop((0, top, width, bottom)), dtype=np.float32) / 255.0
        detail = source_band - smooth_band
        detail_energy = np.max(np.abs(detail), axis=2)
        fine_structure = np.clip((detail_energy - 0.010) / 0.035, 0.0, 1.0)
        luminance = (
            source_band[..., 0] * 0.2126
            + source_band[..., 1] * 0.7152
            + source_band[..., 2] * 0.0722
        )
        dark_weight = np.clip((0.62 - luminance) / 0.5, 0.0, 1.0)
        suppress = (
            dark_weight
            * (1.0 - 0.86 * structure)
            * (1.0 - 0.58 * fine_structure)
            * correction_strength
            * 0.72
        )
        result = np.clip(corrected_band - detail * suppress[..., None], 0.0, 1.0)
        softened.paste(
            Image.fromarray(np.rint(result * 255.0).astype(np.uint8), "RGB"),
            (0, top),
        )
    return softened


def blend_with_source(source_rgb: Image.Image, denoised: Image.Image, strength: float) -> Image.Image:
    width, height = source_rgb.size
    normalized = np.clip((strength - 0.35) / 0.65, 0.0, 1.0)
    ai_mix = 0.34 + normalized * 0.38
    output = Image.new("RGB", (width, height))
    for top in range(0, height, BAND_HEIGHT):
        bottom = min(height, top + BAND_HEIGHT)
        source = np.asarray(source_rgb.crop((0, top, width, bottom)), dtype=np.float32)
        clean = np.asarray(denoised.crop((0, top, width, bottom)), dtype=np.float32)
        luma = source[..., 0] * 0.2126 + source[..., 1] * 0.7152 + source[..., 2] * 0.0722
        dx = np.zeros_like(luma)
        dy = np.zeros_like(luma)
        dx[:, 1:] = np.abs(luma[:, 1:] - luma[:, :-1])
        dy[1:, :] = np.abs(luma[1:, :] - luma[:-1, :])
        edge = np.clip((np.maximum(dx, dy) - 3.5) / 21.0, 0.0, 1.0)
        dark = np.clip((180.0 - luma) / 110.0, 0.0, 1.0)
        weight = ai_mix * dark * (1.0 - 0.82 * edge)
        result = np.clip(
            source * (1.0 - weight[..., None]) + clean * weight[..., None],
            0.0,
            255.0,
        )
        output.paste(Image.fromarray(np.rint(result).astype(np.uint8), "RGB"), (0, top))
    return output


def strength_to_sigma(strength: float) -> float:
    normalized = np.clip((strength - 0.35) / 0.65, 0.0, 1.0)
    return float(6.0 + normalized * 18.0)


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
    model_input = image_to_tensor(source_proxy, strength_to_sigma(strength))
    output = session.run(None, {session.get_inputs()[0].name: model_input})[0]
    denoised_proxy = tensor_to_rgb(output)
    corrected = render_proxy_result(source_rgb, denoised_proxy, source_proxy)
    final_rgb = blend_with_source(source_rgb, corrected, strength)
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
        raise FileNotFoundError(f"DRUNet model not found: {args.model}")
    denoise(
        args.input,
        args.output,
        args.model,
        float(np.clip(args.strength, 0.35, 1.0)),
        float(np.clip(args.clarity, 0.0, 1.0)),
    )


if __name__ == "__main__":
    main()
