#!/usr/bin/env python3
"""Convert the official waifu2x VGG7 photo 1x JSON model to ONNX."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def build_model(source: Path, destination: Path) -> None:
    layers = json.loads(source.read_text())
    nodes = []
    initializers = []
    current = "Input1"

    for index, layer in enumerate(layers, start=1):
        weight_name = f"conv{index}_W"
        bias_name = f"conv{index}_B"
        conv_output = f"conv{index}_output"
        weight = np.asarray(layer["weight"], dtype=np.float32)
        bias = np.asarray(layer["bias"], dtype=np.float32)
        initializers.extend([
            numpy_helper.from_array(weight, weight_name),
            numpy_helper.from_array(bias, bias_name),
        ])
        nodes.append(helper.make_node(
            "Conv",
            [current, weight_name, bias_name],
            [conv_output],
            name=f"conv{index}",
            kernel_shape=[3, 3],
            strides=[1, 1],
            pads=[0, 0, 0, 0],
        ))
        if index < len(layers):
            activation_output = f"relu{index}_output"
            nodes.append(helper.make_node(
                "LeakyRelu",
                [conv_output],
                [activation_output],
                name=f"relu{index}",
                alpha=0.1,
            ))
            current = activation_output
        else:
            current = conv_output

    nodes.append(helper.make_node("Identity", [current], ["output"], name="output"))
    graph = helper.make_graph(
        nodes,
        "waifu2x_vgg7_photo_noise0_1x",
        [helper.make_tensor_value_info("Input1", TensorProto.FLOAT, [1, 3, "height", "width"])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, "output_height", "output_width"])],
        initializer=initializers,
    )
    model = helper.make_model(
        graph,
        producer_name="TU Scale",
        opset_imports=[helper.make_opsetid("", 13)],
    )
    model.ir_version = 8
    model.metadata_props.add(key="source", value=f"nagadomi/waifu2x models/vgg_7/photo/{source.name}")
    model.metadata_props.add(key="scale_factor", value="1")
    model.metadata_props.add(key="padding", value="7")
    onnx.checker.check_model(model)
    destination.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, destination)
    print(f"Created {destination} ({destination.stat().st_size / 1024 / 1024:.2f} MiB)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    build_model(args.source, args.destination)


if __name__ == "__main__":
    main()
