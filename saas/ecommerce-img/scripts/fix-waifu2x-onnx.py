#!/usr/bin/env python3
"""Align the browser ONNX graph with the ncnn upconv_7_photo network."""

from pathlib import Path
import struct

import numpy as np
import onnx
from onnx import numpy_helper


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "public" / "models" / "waifu2x.onnx"
NCNN_MODEL = ROOT / "waifu2x" / "models-upconv_7_photo" / "scale2.0x_model.bin"
LAYER_WEIGHT_COUNTS = [432, 4608, 18432, 73728, 147456, 294912]
LAYER_BIAS_COUNTS = [16, 32, 64, 128, 128, 256]


def main() -> None:
    model = onnx.load(MODEL)
    conv_count = 0
    deconv_count = 0

    for node in model.graph.node:
        attributes = {attribute.name: attribute for attribute in node.attribute}
        if node.op_type == "Conv":
            attributes["pads"].ints[:] = [0, 0, 0, 0]
            conv_count += 1
        elif node.op_type == "ConvTranspose":
            attributes["pads"].ints[:] = [3, 3, 3, 3]
            deconv_count += 1

    if conv_count != 6 or deconv_count != 1:
        raise RuntimeError(f"Unexpected graph: {conv_count} Conv, {deconv_count} ConvTranspose")

    binary = NCNN_MODEL.read_bytes()
    offset = 0
    for weight_count, bias_count in zip(LAYER_WEIGHT_COUNTS, LAYER_BIAS_COUNTS):
        tag = struct.unpack_from("<I", binary, offset)[0]
        if tag != 0x01306B47:
            raise RuntimeError(f"Unexpected ncnn fp16 tag at byte {offset}: {tag:#x}")
        offset += 4 + weight_count * 2 + bias_count * 4

    tag = struct.unpack_from("<I", binary, offset)[0]
    if tag != 0x01306B47:
        raise RuntimeError(f"Unexpected deconvolution tag at byte {offset}: {tag:#x}")
    offset += 4
    # ncnn stores Deconvolution weights output-channel first. ONNX ConvTranspose
    # expects input-channel first, so this transpose is required for parity.
    deconv = np.frombuffer(binary, dtype="<f2", count=3 * 256 * 4 * 4, offset=offset)
    deconv = deconv.astype(np.float32).reshape(3, 256, 4, 4).transpose(1, 0, 2, 3).copy()
    for index, initializer in enumerate(model.graph.initializer):
        if initializer.name == "deconv_W":
            model.graph.initializer[index].CopyFrom(numpy_helper.from_array(deconv, "deconv_W"))
            break
    else:
        raise RuntimeError("deconv_W initializer not found")

    onnx.checker.check_model(model)
    onnx.save(model, MODEL)
    print(f"Updated {MODEL}: ncnn padding and deconvolution layout aligned")


if __name__ == "__main__":
    main()
