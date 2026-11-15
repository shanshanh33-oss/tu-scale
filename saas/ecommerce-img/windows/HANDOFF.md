# TU Scale Windows 开发交接

## 2026-11-13 PDF 压缩错误诊断与修复

- 用户提供的 Word 导出 PDF 使用带 `/Prev` 和 `/XRefStm` 的混合交叉引用结构。旧版 PDF 图片压缩器在读取图片前即报“内部结构暂不支持”。
- `src/tools/pdfImageCompression.js` 现在能遍历传统交叉引用链；复杂结构仍不会被旧图片重写器直接改动，避免损坏文字、标签或其他对象。
- 经用户同意新增 `pdf-lib@1.17.1`：图片压缩无法缩小时，`src/tools/pdfStructureCompression.js` 尝试在浏览器本地重写对象流。仅在文件更小且页数、尺寸及 PDF.js 提取文字校验通过后输出；疑似签名 PDF 不进入该回退。依赖被动态加载，新增独立构建块约 395 KB（gzip 约 168 KB）。
- Windows 静态服务原本把 `.mjs` PDF worker 作为 `application/octet-stream` 返回；`windows/server/windows-static-server.cjs` 已补 `text/javascript` 类型。界面上的 PDF 压缩说明已同步更新。
- `tests/document-compression.test.mjs` 新增增量交叉引用、无照片文字 PDF 结构优化和签名保护测试。lint、94 项测试及普通 `npm run build` 均通过；真实问题 PDF 在网页构建和本机安装版资源副本的浏览器测试中均从 551.7 KB 降至 539.4 KB，显示保留可搜索文字。另用 Poppler/Pillow 核对该文件的两页渲染逐像素一致，并用 pypdf 核对文字、目录及无障碍标签。
- 本机安装目录已应用经副本验证的局部热修补；原有文件备份位于本次工作区 `output/installed-backup`。安装包重新安装可能覆盖热修补。源码修复未发布到生产环境。
- 推送 `codex/windows-dev` 到 GitHub 时，自动审批因无法确认远端仓库归属而拒绝；不要绕过该拒绝。当前源码提交保留在隔离工作区，待用户明确批准推送。

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

## 2026-11-13 浏览器 AI 验证与 PDF 修复整合

- 在 5179 暂停、5174 保持运行的情况下，用 The Met Open Access 的 MET-697703 384×384 裁切样本，在网页选择“AI 清晰”并实际完成 2 倍放大，生成 768×768 PNG，页面显示“处理结果”，浏览器控制台无错误。这证明浏览器本地 AI 回退路径能完成该样本的处理；尚未记录 WebGPU 与 WASM 的具体后端标签、整图耗时或 50 张逐张视觉评分。
- 浏览器测试后仅恢复本项目 5179 服务。PDF 修复从本机隔离副本的 9227bf7、d2f3810 两个提交整合到 D 盘 codex/windows-dev，保留本分支画质基线提交和交接记录。源码未进入 main，未部署线上。
- 停止本项目服务后，在 D 盘缓存及临时目录下执行 npm ci 成功；npm run lint 通过、npm test 94/94 通过、npm run build 通过。构建提示部分静态块超过 500 KB；新增 PDF 结构优化块约 395 KB，按需加载。
- 重新启动后 5174 返回 HTTP 200；5179 的 pythonRuntime、models.scunet、models.drunet、upscale 全为 true；PDF worker 的 .mjs 请求返回 HTTP 200 和 text/javascript。
- PDF 功能改动包含复杂交叉引用安全处理、无损结构优化回退、页数及文字校验、签名文件保护；其他会话已用用户问题 PDF 在隔离副本验证约 551.7 KB 降至 539.4 KB。本次 D 盘整合仅复跑自动测试和本地服务检查，没有重复读取该用户 PDF。
- 不提交模型、ZIP、原图、.venv、node_modules、dist 或用户 PDF。下一步仍是候选模型许可与同图质量对比，摩尔纹专项排后。

## 2026-11-14 候选放大模型评估

- 已完成 50 张固定裁切的 AMD SESR-M7 FP32/INT8 与 nunif photo 2× 同图输出，以及 7 张插画的 nunif art 2× 输出；模型、原图、结果和逐张哈希均留在仓库外 `D:\TU-Scale-QA\candidate-models`。
- AMD 模型官方页面标明 Apache-2.0，nunif 作者确认仓库和 Release 权重适用 MIT；本地许可副本已留档。nunif 只从官方 Release ZIP 提取两个条目并校验 ZIP CRC、长度及本地 SHA；未下载完整 ZIP。
- nunif photo 已在独立浏览器测试页通过合成输入的 WebGPU 和 WASM 推理，包括 400×400 模型输入到 768×768 输出。该测试页仅用于 QA，端口 5180 已关闭。
- 指标及少量目视抽查尚不足以认定画质升级；AMD 与当前结果接近，nunif 边缘更强但有过锐化风险。没有更换产品模型或前端处理流程。详见 [MODEL_CANDIDATE_AUDIT.md](MODEL_CANDIDATE_AUDIT.md)。
- 后续优先进行 50 张人工盲评和整图/透明图/大图资源/浏览器回退验证；彩色摩尔纹专项后置。替换 waifu2x 前须按 AGENTS.md 获得用户明确确认。

## 2026-11-15 候选模型原尺寸抽查

- 已查看 50 张固定样本四列缩略图总览，并在 768×768 原输出尺寸逐对检查 L33、L01、L09、T07、MET-365764。仅 L33 车胎字母在 nunif photo 中略清楚；其余样本未见稳定显著提升，T07 彩色摩尔纹仍在。详见 MODEL_CANDIDATE_AUDIT.md。
- 当前结论仍为保留 waifu2x。AMD 暂不推进接入；nunif 留作研究候选。抽查不能代替完整盲评和整图浏览器验收。
