# TU Scale Windows 开发交接

## 2026-11-13 PDF 压缩错误诊断与修复

- 用户提供的 Word 导出 PDF 使用带 `/Prev` 和 `/XRefStm` 的混合交叉引用结构。旧版 PDF 图片压缩器在读取图片前即报“内部结构暂不支持”。
- `src/tools/pdfImageCompression.js` 现在能遍历传统交叉引用链；对于这类无可处理 JPEG 照片的文件，提示“没有可进一步压缩的照片”。若复杂结构包含可处理照片，仍会拒绝改写，避免损坏文字、标签或其他对象。
- `tests/document-compression.test.mjs` 新增增量交叉引用回归测试；真实问题 PDF 的本地运行确认提示已变为“没有可进一步压缩的照片”。原文件未加入仓库。
- lint、92 项测试通过。构建使用 `npm run build -- --configLoader runner` 通过；普通 `npm run build` 在本次隔离副本中因 `node_modules` 指向只读原工作区，Vite 无法写入临时配置文件而失败，非源码构建错误。
- 此修改仅涉及前端 PDF 压缩和测试，不涉及 Functions、KV、第三方 API 或生产部署。无照片 PDF 的进一步无损结构压缩尚未实现；本次没有新增依赖或改变原有有照片 PDF 的压缩行为。

> 更新日期：2026-11-13（Asia/Shanghai）
> 工作分支：`codex/windows-dev`
> 本文件是 Mac / Windows Codex 之间的直接交接渠道；用户不负责转述例行日志。

## 当前 Windows 环境

- 项目路径：`D:\Projects\tu-scale`
- 应用路径：`D:\Projects\tu-scale\saas\ecommerce-img`
- Git：2.55.0
- Node.js：22.23.3
- npm：10.9.9
- Python：3.12.10，路径 `D:\Programs\Python31210\python.exe`
- pip：25.0.1
- D 盘开发缓存：`D:\Caches\npm`、`D:\Caches\pip`、`D:\Temp`
- `npm ci` 已通过；本次同步后 lint、91 项测试和构建再次通过。
- 本次仅修改 `windows/setup-python.ps1` 和本交接文件；模型、ZIP、`.venv`、`node_modules`、`dist` 不得提交。
- 模型 ZIP 和 `.sha256` 在应用目录中，是本地转移文件，不得提交。

## 模型包

- 文件：`TU-Scale-Windows-AI-Models-20261112.zip`
- 正确 SHA-256：
  `c4d18c8f24061065c674e3057648fd817de2368b986f49521743e2bd179aa8db`
- ZIP 内含 SCUNet 两个模型文件、SCUNet 许可证和 DRUNet 模型。
- ZIP 外层 SHA-256 已通过；已解压到项目并通过四个文件的
  `windows\verify-models.ps1` 校验。这些模型和 ZIP 仍不得提交。

## 本次 Windows 修复与验证

- 从 `codex/windows-dev` 快进至远端基线 `69c6003`，未修改 `main`。
- 发现 Python 3.12.10 安装文件被移到 `D:\Programs\新建文件夹`，而 `py` 注册路径和用户 PATH 仍指向 `D:\Programs\Python31210`。确认目标路径不存在、无进程使用后，将安装目录改回注册路径；`py -3.12 --version` 返回 3.12.10。
- `windows/setup-python.ps1` 的两处版本检查和导入检查在 Windows PowerShell 5.1 中会丢失 Python `-c` 参数内的双引号。已改成不依赖引号的等价检查，未更改依赖或业务行为。
- 按 `powershell -ExecutionPolicy Bypass -File .\windows\setup-python.ps1 -PythonPath 'D:\Programs\Python31210\python.exe'` 重建项目 `.venv`，依赖安装和 `numpy`、`onnxruntime`、Pillow 导入检查通过。pip 缓存及临时目录位于 D 盘。
- `windows\verify-models.ps1` 的四个文件校验全部通过。
- `windows\dev-stop.ps1` 与 `windows\dev-start.ps1` 已执行。`http://127.0.0.1:5174/` 返回 HTTP 200；`http://127.0.0.1:5179/denoise/status` 返回 `pythonRuntime=true`、`models.scunet=true`、`models.drunet=true`、`upscale=true`。
- 在更新后的分支上重新运行 lint、91 项测试和构建，全部通过。未测试真实图片推理或浏览器 WebGPU 性能。

## 后续工作

- 当前完整本地开发服务正在运行；用 `windows\dev-stop.ps1` 只停止记录的 TU Scale 进程。
- npm 依赖审计曾报告 41 项漏洞告警（5 moderate、36 high）；本次没有自动升级或修改锁文件。
- Mac 端拉取 `codex/windows-dev` 获取本次脚本修复和验证状态。不要将模型 ZIP、模型、`.venv`、`node_modules`、`dist` 或本地日志提交。

## 新规划阶段一技术审计

- 2026-11-12 完成 Windows 源码、远端 `main` 与公开站点静态资源对照；证据及未完成的画质基线见 `windows/QUALITY_STAGE1_AUDIT.md`。
- 当前线上基础 JS、CSS、HTML 内容及 `waifu2x.onnx` 与本地构建一致；开发分支新增的增强模型尚未在线上提供。
- 下一步先建立仓库外固定原图与旧版输出档案，再进行彩色摩尔纹专项修复和候选模型评估。未取得样图前不宣称画质升级通过。

## 必须向用户请示的情形

- 需要管理员权限、关闭/排除安全软件、重启 Windows 或停止归属不明的进程。
- 需要密钥、账号、敏感文件或生产配置。
- 需要删除不可重建的文件、更换技术栈、修改产品行为或触发生产部署。

其他常规诊断、重建、测试、开发分支提交和推送，由 Windows Codex 自主完成。

## 2026-11-13 固定画质基线与优先级

- 用户新增 7 张织物图，并在两张截图中圈出真实彩色摩尔纹；此前把这些图仅归为普通织纹是误判。标注保存在仓库外 D:\TU-Scale-QA\annotations，其中第二张对应本地清单 T07。用户随后明确将摩尔纹专项降为后续优先级。
- 已在仓库外建立 SHA-256 核验的 50 张固定原图清单 D:\TU-Scale-QA\fixed-50.csv：人像 12、商品/汽车 12、建筑/城市 6、自然/纹理 6、织物 7、插画 7。43 张来自用户原图（仅私人 QA，转授权范围未独立核实）；7 张插画直接来自 The Met 官方 Open Access，逐张 API 核验 isPublicDomain=true，来源、作者和 SHA-256 见 licensed-samples\met-manifest.csv。The Met 的 Open Access 说明：https://www.metmuseum.org/hubs/open-access 。
- Wikimedia Commons 数码摄影摩尔纹分类中已找到逐张标注 CC 许可的候选，但官方图片服务器返回 HTTP 429，未下载、未计入固定 50 张。不得从镜像绕过限流。
- 新增 windows/quality-baseline.py，只读仓库外原图和裁切 CSV，调用现有本地 waifu2x.onnx Python CPU 路径，把 2x 输出、bicubic 对照、模型与输入哈希及耗时写到仓库外新目录。无产品代码、模型、依赖或生产环境改动。
- 已用 quality-crops-6-v3.csv 对人像、汽车、建筑、自然、织物、插画各 1 张运行当前模型：384×384 原生像素裁切输出为 768×768；六次耗时 0.65–0.72 秒。该结果只代表本机本地 CPU 裁切推理，不代表网页 WebGPU/WASM、整图或用户最终导出速度。前两版自动中心裁切误选背景，其记录保留但不作为画质判断。输出位于 D:\TU-Scale-QA\baseline-20261113-03。
- 本轮 5174 仍返回 HTTP 200；5179 的 pythonRuntime、models.scunet、models.drunet 和 upscale 均为 true。
- 候选模型初查：Real-ESRGAN 代码仓库 BSD-3-Clause，SPAN 代码仓库 Apache-2.0；模型权重的具体许可、2x 适配、浏览器 ONNX/WebGPU 可用性与同图画质仍需逐项确认。当前不引入或替换任何模型。官方来源：https://github.com/xinntao/Real-ESRGAN 和 https://github.com/hongyuanyu/SPAN 。
- 下一步优先完成 50 张有代表性的裁切及当前版本完整输出，开展候选模型同图对比与浏览器回退测试；彩色摩尔纹专项放后。Mac 端需另行获得仓库外 QA 原图与清单才能复现，不得提交图片、模型或用户标注。
- 本阶段验证：quality-baseline.py 成功完成六张原生裁切；npm run lint 通过、npm test 91/91 通过、npm run build 通过。当时尚未执行浏览器端 WebGPU/WASM 真正推理、完整 50 张输出和候选模型质量对比；50 张裁切输出见下节。

### 50 张当前模型裁切输出完成（同日后续）

- D:\TU-Scale-QA\quality-crops-50-v3.csv 已按主体与 EXIF 方向修订；D:\TU-Scale-QA\baseline-50-curated-20261113 有 50 张输入、50 张 bicubic 对照、50 张当前 waifu2x 2x 输出，共 150 个 PNG。50 条结果均有原图/输出哈希和耗时，平均 0.656 秒/张，范围 0.627–0.781 秒（384×384 原生像素裁切，本地 ONNX CPU）。最初的中心裁切技术跑批保留作审计，但不作为同图画质比较基准。
- 本地浏览器实际打开 5174，AI 清晰模式可选，控制台未见新错误；未在网页上传原图，也未完成浏览器 WebGPU/WASM 实际推理。后者与整图导出、50 张人工画质评分仍是后续验收项。
