# 2026-11-14 候选放大模型离线评估

> 开发分支：`codex/windows-dev`。本次只做仓库外模型、固定裁切样本和独立浏览器测试页评估；没有替换 TU Scale 的 waifu2x、修改产品代码或部署。

## 范围与复现材料

- 固定输入：`D:\TU-Scale-QA\baseline-50-curated-20261113` 的 50 张 384×384 裁切 PNG，来自 `D:\TU-Scale-QA\fixed-50.csv`（43 张用户私人 QA 图、7 张 The Met Open Access 插画）。当前 waifu2x 与 bicubic 对照均在同一目录。用户图的公开再分发授权未核实，不得提交。
- 候选模型、脚本、逐张输出、哈希和推理计时均在 `D:\TU-Scale-QA\candidate-models`；对比表为 `comparison-metrics-v2-20261114.csv`。`comparison-metrics-20261114.csv` 是首次脚本报错后留下的不完整文件，不能使用。
- 候选输出：AMD SESR-M7 FP32 50 张、INT8 50 张；nunif swin_unet photo 50 张、art 7 张，尺寸均为 768×768。比较脚本直接读取固定输入，不改原图。

## 来源、许可与完整性

| 候选 | 来源与许可证据 | 本地模型 SHA-256 | 体积 |
| --- | --- | --- | ---: |
| AMD SESR-M7 FP32 | [AMD 官方模型页](https://huggingface.co/amd/sesr-m7-256x256-tiles-amdnpu)，Apache-2.0 LICENSE；模型哈希与该页 LFS 记录相同 | `ee8aad0b59ef3d0a0bb96af4957a6d2b848d3c41ed251c72502d6bc6fe1499ea` | 93,752 B |
| AMD SESR-M7 INT8 | 同上 | `63d2600fa41b21c2326d1740f75486f24e0b791c490ea73a898bf64fdd429ab1` | 107,131 B |
| nunif photo 2× | [nunif 官方 Release](https://github.com/nagadomi/nunif/releases/tag/0.0.0)；作者在 [waifu2x 许可讨论](https://github.com/nagadomi/waifu2x/issues/478) 与 [nunif 讨论](https://github.com/nagadomi/nunif/discussions/751) 确认仓库及 Release 权重按 MIT 授权 | `008cd5c0b36fed6ddcbdb2240fc5e01a98368e929396de76c281d5f4af0c83dd` | 18,905,935 B |
| nunif art 2× | 同上 | `581a69575295f5e082531b1ce6974dc27977576601b1d15c4c89d69b48c6ebef` | 16,727,049 B |

nunif 官方 ZIP 约 701 MB。为减少下载量，只从官方 Release 以 HTTP Range 读取 ZIP 中央目录与这两个条目，逐一核对解压长度和中央目录 CRC32；表中 SHA-256 是解出的本地模型哈希，并非官方发布的全包 SHA。官方 MIT LICENSE 已另存于候选目录。中途停止的 26,951,680 B 下载片段 `waifu2x_onnx_models_20250502.zip.part` 不是完整 ZIP，不得解压或分发。AMD 模型与 LICENSE 从官方页面取得。

## 同图结果

- AMD FP32 与当前输出的平均像素绝对差为 0.544/255；INT8 与 FP32 为 1.001/255。目视抽查人物、车、织物等样本，AMD 与当前结果非常接近，尚未看到足以证明升级价值的改善。
- nunif photo 与当前输出的平均像素绝对差为 1.311/255，边缘梯度比为 1.148；部分汽车文字、轮胎等边缘更强，也有过锐化风险。nunif art 在 7 张插画上能够输出并保留线条，但未完成系统人工评分。
- 这些像素差和边缘比只描述变化，不能当成画质得分。目视只抽查了部分样本；尚未逐张评估 50 张的真实纹理、人物和车辆身份、文字、伪影及用户标注的彩色摩尔纹。摩尔纹专项依用户决定后置。

## 推理与浏览器兼容性

- 本地 ONNX Runtime CPU，384×384 裁切，排除会话创建时间：AMD FP32 平均 0.043 秒/张（50 张），INT8 0.075 秒/张（50 张）；nunif photo 2.233 秒/张（50 张），art 1.679 秒/张（7 张）。现有 waifu2x 基线平均 0.656 秒/张包含独立进程启动，计时口径不同，不能直接比较速度。
- 用项目现有 ONNX Runtime Web 1.27.0 资源和独立的本地静态测试页，在浏览器以合成 RGB 输入测试 nunif photo：64×64 输入经 WebGPU、WASM 均得到 96×96；400×400 输入经 WebGPU、WASM 均得到 768×768。400×400 单次 WebGPU 会话创建约 2.29 秒、推理约 0.99 秒；WASM 创建约 1.37 秒、推理约 5.38 秒。均为冷启动/单次合成数据，不能推断产品整图性能或质量。
- 独立测试页端口 5180 已关闭；TU Scale 5174、5179 服务保持运行。此次没有把候选模型接入前端，也没有验证分块大图、透明 PNG、浏览器最终导出、WebGPU 失败回退或 Mac Safari。

## 决策与后续门槛

目前不替换现有 waifu2x。AMD 结果与现有输出接近；nunif 的边缘增强值得继续评估，但尚无 50 张人工画质评分或整图资源测试支撑产品切换。按根目录 AGENTS.md，更换 waifu2x / 现有图片处理方案需用户明确确认。

下一步：在相同放大设置下逐张盲评至少当前版、nunif photo（插画另比 art）和原图，重点核对汽车/人物身份、真实纹理、文字及过锐化；补测整图尺寸、分块拼接、内存/显存、透明 PNG、WebGPU/WASM 回退。只有候选显著改善且通过回归，再提出具体接入范围、模型体积与浏览器兼容方案供确认。所有原图、输出、模型与临时页面继续留在仓库外。

## 2026-11-15 原尺寸视觉复核

- 检查了 50 张四列缩略图总览（输入、当前 waifu2x、nunif photo、AMD FP32），并在原始 768×768 输出尺寸逐对检查 L33 车胎、L01 人像、L09 汽车座舱文字、T07 织物、MET-365764 线描插画（插画用 nunif art）。对照图位于仓库外 `D:\TU-Scale-QA\candidate-models\contact-sheets-20261114`。
- L33 的 BRIDGESTONE 字母在 nunif photo 中略清楚；L01 肤质及牙齿、L09 文字和车座、MET-365764 细线没有稳定且明显的整体提升。T07 原有织纹/彩色摩尔纹仍在，nunif 不是这项问题的解决方案。
- 缩略图总览不能判定细节画质；这次原尺寸抽查也不是盲评或全 50 张评分。没有发现必须立即停用当前模型的问题，也没有足够证据切换候选模型。继续保留现有 waifu2x，AMD 暂不推进接入；nunif 只保留为进一步研究候选。若后续考虑替换，仍需 50 张逐张盲评、整图资源与透明图/回退测试及用户明确确认。
