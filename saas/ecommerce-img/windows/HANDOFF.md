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

## 2026-11-16 V2.0 浏览器图像保真修复

- 按 V2.0 的“忠实原图 / 纹理保护与浏览器优化”继续，不替换未证明更优的候选模型。仅局部修改 `src/App.jsx` 两处预处理像素回写：把经过自动色阶/自然饱和度/文字清理或预锐化后的 ImageData 直接写回源画布，避免将半透明内容再次 `drawImage` 到自身导致 alpha 重复合成。没有更换模型、依赖、Functions、KV 或部署。
- 浏览器实测：仅启动前端 `dev-start.ps1 -SkipAi`，5179 未运行；The Met Open Access 的 MET-697703 384×384 样本在浏览器 WebGPU AI 模式完成 2 倍放大，输出 768×768。另以仓库外合成 128×128 透明 PNG 复现旧问题：中心 alpha 原为 128，旧导出为 192；修复后 AI 导出 256×256 的全部 65,536 个 alpha 值与原图最近邻 2 倍映射完全一致。普通非 AI 模式同时开启自动色阶与智能锐化，中心 alpha 保持 128、透明角落保持 0。
- 输入及修复前后 PNG 均保存在仓库外 `D:\TU-Scale-QA\browser-regression-20261116`，不得提交。针对当前变更运行 `npm run lint` 通过、`npm test` 94/94 通过、`npm run build` 通过。未在本轮测批量、裁切、JPEG/WebP、Safari 或大图内存；上线前仍需跨浏览器回归。
- 5174 本地前端服务在测试后保持运行；5179 没有为本轮测试启动。生产 `main` 和线上配置未触动。

## 2026-11-16 画质、浏览器回退与商业化规划

- 50 张固定裁切完成 A/B/C 随机匿名比较；本轮自动化审查者在原尺寸局部与整图总览中 50/50 均未选出稳定胜者。评价先于解盲保存，证据仅在仓库外 `D:\TU-Scale-QA\blind-review-20261116`。这不是独立人工用户验收，不支持替换现有 waifu2x；织物摩尔纹专项仍后置。
- 浏览器 WebGPU 实测 2100×1050 大图 2× 输出 4200×2100、600×400 图居中 1:1 裁切后输出 1080×1080、两图批量 ZIP 内容及尺寸均通过检查。合成图与公开 CC0 样本及输出保存在仓库外 `D:\TU-Scale-QA\browser-acceptance-20261116`。详细范围和局限见 [QUALITY_BROWSER_ACCEPTANCE_20261116.md](QUALITY_BROWSER_ACCEPTANCE_20261116.md)。
- 发现禁用 WebGPU 且跨源隔离时，浏览器 WASM 多线程模型初始化在本机内置 Chromium 卡住；临时 QA 页面单线程可运行。局部将 `src/ai/waifu2x.js` 的 WASM 线程数固定为 1，重建后仅在 QA 页面禁用 WebGPU，状态显示 WASM 模型已就绪，透明 PNG AI 放大完成。可能影响无 WebGPU 设备速度，尚待普通 Chrome/Edge、Mac Safari 和低内存机器测量。临时 5180/5181 服务已停止；5174 本地服务保持运行，5179 未启动。
- 本轮 `npm run lint` 通过、`npm test` 94/94 通过、`npm run build` 通过。没有修改模型、Functions、KV、生产 `main` 或线上部署。
- 竞品官方价格与商业化门槛见 [COMMERCIAL_READINESS_20261116.md](COMMERCIAL_READINESS_20261116.md)；会员系统仅为 [MEMBERSHIP_PLAN_20261116.md](MEMBERSHIP_PLAN_20261116.md) 草案，没有账号、订单、支付或额度代码。下一步先确定经证实值得收费的云能力、单位成本、地区与支付方案，再进行隔离环境原型；不得把草案价格变成收费配置。

## 2026-11-16 会员权益离线原型

- 在用户指出此前只有文档、缺少实际实现后，新增 `src/membership/entitlementLedger.js` 和 `tests/membership-ledger.test.mjs`。这是未接入产品的可运行状态转换：虚构额度发放、任务预占、成功结算、失败释放、重复事件幂等、余额不足拒绝、单进程并发串行化；对无法安全自动撤销的授权要求人工核对。
- 没有新增依赖，没有接入前端、Functions、KV、账号、订单、真实价格或支付；未创建用户数据。单进程内存执行器不能替代跨进程事务数据库，代码不得用于实际收费。方案状态见 [MEMBERSHIP_PLAN_20261116.md](MEMBERSHIP_PLAN_20261116.md)。
- 专项 7 项测试通过；全量 lint、测试、构建通过。仅提交源码、测试与交接文档到 `codex/windows-dev`，不碰 `main` 或线上环境。

## 2026-11-16 Better Auth 账号系统（开发分支）

- 用户确认 Better Auth 作为正式账号底层。新增 `/member` 会员页、`/api/auth/*` Pages Function、Better Auth 1.7.25 和 D1 建表脚本。实现邮箱验证码注册/登录、已登录账号的手机短信验证绑定、服务端会话及退出；仅开放所需的六个认证接口。
- 会员库使用独立 `MEMBER_DB` D1，统计/反馈 KV 和免费图片工具未改。要求 `MEMBER_AUTH_SECRET`、`MEMBER_AUTH_URL`、邮箱及短信每日预算，以及 `MEMBER_DELIVERY` 发送服务绑定；任何缺项均返回 503。未配置真实数据库、发送服务、密钥、生产 Pages 项目或部署，当前不可供真实用户注册。
- 服务端邮箱验证码哈希存储；验证码有效期 10 分钟，按 D1 记录每客户端限流与全局每日发送预算。发送方拒绝或预算耗尽时页面不会显示成功。未登录不能触发短信发送或绑定。测试使用模拟 D1 和发送方，不包含真实邮件或短信投递。
- D1 schema 从当前 Better Auth 配置生成，并通过库的迁移检测确认无差异。`tests/member-auth.test.mjs` 覆盖注册、绑手机、退出、越权、发送失败及预算；`tests/member-api.test.mjs` 覆盖前端映射。官方 Wrangler 4.163.0 在本机用 `nodejs_compat` 成功打包 Pages Functions，未部署。
- 5174 的 Vite 本地服务会对不存在的 `/api/auth/*` 返回 HTTP 200 的 HTML 回退页；前端现将非 JSON 响应视作服务未启用，不会误报验证码已发送。只启动 Vite 不等于启动会员后端。
- 启用前的配置、个人信息处理、清理和腾讯云迁移前置条件见 [MEMBER_SETUP.md](MEMBER_SETUP.md)。账号删除/数据保留、供应商选择、真实投递及预发布浏览器验收仍需完成。没有订单、支付、会员价格或权益启用。

## 2026-11-17 本机会员交互演示

- 用户希望在现有 TU Scale 本地页面查看完整会员流程。新增 `windows/member-preview.vite.config.js`，在 5184 加载同一 React/Vite 应用，并把 `/api/auth/*` 接到内存 SQLite 模拟 D1 和只接受虚构联系方式的模拟发送方。5174 网页及 5179 AI 服务保持运行，没有触碰真实 D1、邮件、短信、生产配置或 `main`。
- `/member` 在演示模式显示测试说明、预填邮箱/手机号和“填入演示验证码”按钮；该入口只在 Vite 开发模式启用。演示仅允许 `demo@example.test` 和 `+8613800138000`，重启后测试账号清空。启动方式和限制见 [MEMBER_SETUP.md](MEMBER_SETUP.md)。
- 5184 页面及认证接口返回 HTTP 200；通过本机 HTTP 实测邮箱发码与验证、会话、手机发码与绑定、退出及会话失效。浏览器确认演示提示和表单可见。还需以真实服务在预发布环境验收投递和 Cloudflare D1 行为。
- 用户随后发现 5184 进程已退出；新增 `windows/member-preview-start.ps1` 并创建当前用户桌面独立“TU Scale 会员版”快捷方式。脚本在 5184 空闲时启动本机演示，只认可明确属于本项目的现有进程；保留原“TU Scale”快捷方式及 5174/5179 服务。重启后可直接双击新快捷方式。桌面 `.lnk` 未入库。
- 用户要求另建网址供朋友真实注册，已确认 Wrangler 尚未登录 Cloudflare；等待用户在浏览器完成 Wrangler 授权，并确定独立测试域名与真实邮件/短信发送服务。不能将内存模拟发码或测试账号库部署给朋友。不得改现有 Pages 项目或 `main`。

## 2026-11-17 独立公网会员测试准备

- 用户选择独立 `*.pages.dev`，先仅开放真实邮箱注册，短信后续接入；当前没有自有发信域名。Cloudflare Wrangler 本机未登录；本轮两次本机回调及一次设备码授权均超时，未创建云资源或部署。重试设备授权时应在用户确认可立即操作后生成新码，不能沿用过期码。
- 新增 `npm run build:member-test` 生成独立 `dist-member-test`，与普通 `dist` 分开。会员测试包不含本地模拟验证码入口和手机号表单，移除旧站 canonical/OG URL 与 sitemap，写入 noindex/robots 阻止收录。服务端 `MEMBER_EMAIL_ONLY=1` 时禁止手机路由，测试覆盖无短信发送。普通构建不变。
- 本轮 lint、113 项测试、普通构建及会员测试构建通过；检查测试包无本地演示入口、无手机 UI，存在 noindex 头和 robots 禁止抓取。真实邮件供应商、发件身份验证、Cloudflare D1、独立 Pages 项目、站点 Secret 和在线验收仍未完成。切勿把当前包误称可供朋友真实注册。

## 2026-11-18 独立 Cloudflare 项目与邮件适配

- 用户在 Gmail 的 Cloudflare 通知中确认原站账号线索；Wrangler 设备授权后核对登录邮箱为 `shanshanh33@gmail.com`，Pages 项目列表包含原站 `tu-scale`。没有改动原站。
- 在同一账号新建 `tu-scale-member-test` Pages 项目（独立 `*.pages.dev`，Direct Upload）及同名 D1 数据库。D1 ID 仅在 `wrangler.member-test.jsonc` 中作资源绑定，不是密钥。新库迁移 9 条 SQL 成功，未写入用户账号。为新 Pages 项目生成独立随机 `MEMBER_AUTH_SECRET`，仅存于 Cloudflare Secret，未在日志或仓库输出。
- 用户选择邮箱先上线、短信后续接入，并同意 SendGrid 单发件人做小范围测试。服务端新增 SendGrid Mail Send 适配器，仅在测试站 `MEMBER_EMAIL_ONLY=1` 且配置受限 API Key 与已验证发件人时启用；未配置则认证接口 503。短信接口返回 404。当前没有 SendGrid Key、真实发件验证或邮件投递，**不要向朋友宣称站点可注册**。
- 新站首次 Direct Upload 已完成：`https://tu-scale-member-test.pages.dev/` 与 `/member` 均 HTTP 200 且 `X-Robots-Tag: noindex, nofollow`；认证会话接口因缺少 SendGrid 配置返回 HTTP 503，符合关闭策略。默认配置 `wrangler.member-test.jsonc` 绑定新库和测试 URL。Wrangler Pages 不接受自定义配置路径；部署时临时复制为根目录 `wrangler.jsonc`，部署后已移除，Git 工作区干净。原 `tu-scale.pages.dev` 项目未改。
- 会员测试页新增邮箱/会话数据去向说明。下一步用户须在 SendGrid 验证单个发件人并创建仅有 Mail Send 权限的 API Key；密钥只录入新 Pages 项目的 Secret（不发聊天、不入 Git），配置发件地址后重新部署并做真实邮件注册/退出测试，才能把链接发给朋友。
