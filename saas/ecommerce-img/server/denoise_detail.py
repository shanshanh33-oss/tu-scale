#!/usr/bin/env python3
"""Source-guided luminance detail recovery for local denoise models."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter


BAND_HEIGHT = 256
BAND_MARGIN = 12


def _luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _box_mean(values: np.ndarray, radius: int = 3) -> np.ndarray:
    pad_mode = "reflect" if min(values.shape) > 1 else "edge"
    padded = np.pad(values, ((radius, radius), (radius, radius)), mode=pad_mode)
    integral = np.pad(padded, ((1, 0), (1, 0)), mode="constant").cumsum(0).cumsum(1)
    size = radius * 2 + 1
    return (
        integral[size:, size:]
        - integral[:-size, size:]
        - integral[size:, :-size]
        + integral[:-size, :-size]
    ) / float(size * size)


def _structure_response(luminance_blur: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    gradient_x = np.zeros_like(luminance_blur)
    gradient_y = np.zeros_like(luminance_blur)
    gradient_x[:, 1:-1] = (luminance_blur[:, 2:] - luminance_blur[:, :-2]) * 0.5
    gradient_y[1:-1, :] = (luminance_blur[2:, :] - luminance_blur[:-2, :]) * 0.5
    tensor_xx = _box_mean(gradient_x * gradient_x)
    tensor_yy = _box_mean(gradient_y * gradient_y)
    tensor_xy = _box_mean(gradient_x * gradient_y)
    energy = np.sqrt(np.maximum(tensor_xx + tensor_yy, 0.0))
    coherence = np.sqrt(
        (tensor_xx - tensor_yy) ** 2 + 4.0 * tensor_xy * tensor_xy
    ) / (tensor_xx + tensor_yy + 1e-3)
    return energy, coherence


def recover_luminance_detail(
    source_rgb: Image.Image,
    denoised_rgb: Image.Image,
    amount: float,
    *,
    source_detail_mix: float = 0.68,
    structure_detail_mix: float = 1.0,
) -> Image.Image:
    """Restore coherent fine detail and reinforce denoised mid-scale structure.

    Fine detail is limited to luminance that the denoiser actually removed. The
    structure layer is derived from the denoised image itself, while multi-scale
    masks reject isolated high-frequency pixels. The result remains inside the
    source neighborhood luminance range to keep halos under control.
    """

    strength = float(np.clip(amount, 0.0, 1.0))
    if strength <= 0.001:
        return denoised_rgb
    if source_rgb.size != denoised_rgb.size:
        raise ValueError("Source and denoised images must have the same dimensions")

    width, height = source_rgb.size
    output = Image.new("RGB", (width, height))
    gain = min(0.9, 0.34 + strength)
    max_delta = 3.0 + strength * 8.0

    for top in range(0, height, BAND_HEIGHT):
        bottom = min(height, top + BAND_HEIGHT)
        crop_top = max(0, top - BAND_MARGIN)
        crop_bottom = min(height, bottom + BAND_MARGIN)
        source = np.asarray(
            source_rgb.crop((0, crop_top, width, crop_bottom)),
            dtype=np.float32,
        )
        clean = np.asarray(
            denoised_rgb.crop((0, crop_top, width, crop_bottom)),
            dtype=np.float32,
        )
        source_y = _luminance(source)
        clean_y = _luminance(clean)
        source_l = Image.fromarray(np.rint(source_y).astype(np.uint8), "L")
        fine_blur = np.asarray(
            source_l.filter(ImageFilter.GaussianBlur(radius=0.9)),
            dtype=np.float32,
        )
        medium_blur = np.asarray(
            source_l.filter(ImageFilter.GaussianBlur(radius=2.2)),
            dtype=np.float32,
        )

        fine = source_y - fine_blur
        medium = source_y - medium_blur
        detail = fine * 0.68 + medium * 0.32
        removed = source_y - clean_y
        same_direction = detail * removed > 0.0
        restorable = np.where(
            same_direction,
            np.minimum(np.abs(detail), np.abs(removed)),
            0.0,
        )

        structure_energy, structure_coherence = _structure_response(medium_blur)
        energy_mask = np.clip((structure_energy - 0.38) / 0.75, 0.0, 1.0)
        coherence_mask = np.clip((structure_coherence - 0.12) / 0.75, 0.0, 1.0)
        scale_consistency = np.where(fine * medium >= 0.0, 1.0, 0.18)
        source_structure_mask = energy_mask * coherence_mask
        fine_detail_mask = source_structure_mask * scale_consistency

        source_delta = np.sign(detail) * np.minimum(
            restorable * fine_detail_mask * gain,
            max_delta,
        ) * float(np.clip(source_detail_mix, 0.0, 1.0))

        clean_l = Image.fromarray(np.rint(clean_y).astype(np.uint8), "L")
        clean_structure_blur = np.asarray(
            clean_l.filter(ImageFilter.GaussianBlur(radius=1.35)),
            dtype=np.float32,
        )
        clean_mid_blur = np.asarray(
            clean_l.filter(ImageFilter.GaussianBlur(radius=2.8)),
            dtype=np.float32,
        )
        clean_energy, clean_coherence = _structure_response(clean_structure_blur)
        clean_energy_mask = np.clip((clean_energy - 0.30) / 0.72, 0.0, 1.0)
        clean_coherence_mask = np.clip((clean_coherence - 0.10) / 0.78, 0.0, 1.0)
        mid_source_energy_mask = np.clip((structure_energy - 0.48) / 0.72, 0.0, 1.0)
        mid_source_coherence_mask = np.clip((structure_coherence - 0.18) / 0.72, 0.0, 1.0)
        dark_structure_weight = np.clip((62.0 - source_y) / 46.0, 0.12, 1.0)
        mid_structure_mask = (
            np.sqrt(np.clip(mid_source_energy_mask * clean_energy_mask, 0.0, 1.0))
            * mid_source_coherence_mask
            * clean_coherence_mask
            * dark_structure_weight
        )
        clean_mid_detail = clean_y - clean_mid_blur
        source_mid_detail = source_y - medium_blur
        mid_alignment = np.where(clean_mid_detail * source_mid_detail >= 0.0, 1.0, 0.12)
        structure_gain = (0.32 + strength * 0.60) * float(
            np.clip(structure_detail_mix, 0.0, 1.0)
        )
        structure_delta = (
            np.clip(clean_mid_detail, -4.5, 4.5)
            * mid_structure_mask
            * mid_alignment
            * structure_gain
        )

        delta = np.clip(source_delta + structure_delta, -max_delta, max_delta)
        source_min = np.asarray(source_l.filter(ImageFilter.MinFilter(size=7)), dtype=np.float32)
        source_max = np.asarray(source_l.filter(ImageFilter.MaxFilter(size=7)), dtype=np.float32)
        target_y = np.clip(clean_y + delta, source_min, source_max)
        delta = target_y - clean_y
        restored = np.clip(clean + delta[..., None], 0.0, 255.0)

        inner_top = top - crop_top
        inner_bottom = inner_top + (bottom - top)
        output.paste(
            Image.fromarray(
                np.rint(restored[inner_top:inner_bottom]).astype(np.uint8),
                "RGB",
            ),
            (0, top),
        )

    return output
