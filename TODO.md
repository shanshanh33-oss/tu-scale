# TU Scale 开发任务

任务按照 P0、P1、P2、P3 排列。P0 代表上线前必须优先处理的问题。

每项任务开始前应重新检查相关代码和生产配置，确认实际状态没有变化。

## P0：安全、隐私和成本控制

### P0-1：KV 未配置时禁止调用付费抠图 API

目标：

防止 `TUSCALE_ANALYTICS` 未绑定时跳过每日额度限制，从而导致 remove.bg API 被无限调用。

涉及文件：

- `saas/ecommerce-img/functions/api/remove-bg/removebg.js`
- `saas/ecommerce-img/server/remove-bg-server.cjs`
- `saas/ecommerce-img/ANALYTICS.md`
- `saas/ecommerce-img/.env.example`

验收标准：

- 未配置 KV 时，Cloudflare remove.bg 接口返回明确的配置错误，不调用第三方 API。
- KV 正常时，每个 IP 每日额度限制仍然有效。
- 第三方调用失败时不消耗本地额度。
- 前端能显示用户可理解的错误。
- 文档说明 KV 是付费 API 的必要成本保护条件。

风险：

- 修改限流逻辑可能阻止当前线上试用。
- KV 最终一致性可能导致极短时间内的并发穿透。
- IP 识别会影响共享网络用户。

### P0-2：保护问卷、联系和统计数据接口

目标：

防止联系方式、需求备注、IP、文件名和运营数据通过公开接口泄露。

涉及文件：

- `saas/ecommerce-img/functions/api/contact-results.js`
- `saas/ecommerce-img/functions/api/survey-results.js`
- `saas/ecommerce-img/functions/api/survey-results-json.js`
- `saas/ecommerce-img/functions/api/stats.js`
- `saas/ecommerce-img/functions/api/stats-data.js`
- Cloudflare `CONTACT_ADMIN_TOKEN` 或新的统一管理 Token 配置

验收标准：

- 未提供有效 Token 时不能读取包含联系方式或明细的数据。
- JSON 和 HTML 接口使用一致的认证规则。
- 不在 URL、响应或日志中泄露 Token。
- 普通前端页面不受影响。
- 已配置和未配置 Token 的行为有测试或明确验证记录。

风险：

- 现有运营人员使用的看板地址可能失效。
- URL 查询参数中的 Token 可能进入浏览器历史或访问日志。
- 引入新的认证方式可能影响 Cloudflare 缓存。

### P0-3：限制未使用的 PhotoRoom 代理

目标：

避免公开、无产品入口且没有限流的 PhotoRoom 代理消耗 API 费用。

涉及文件：

- `saas/ecommerce-img/functions/api/remove-bg/photoroom.js`
- `saas/ecommerce-img/server/remove-bg-server.cjs`
- `saas/ecommerce-img/.env.example`

验收标准：

满足以下方案之一：

1. 未启用功能时接口明确关闭；或
2. 接口具备与 remove.bg 等价的认证、限流、大小限制和成本保护。

同时确认当前前端没有依赖该接口。

风险：

- 直接删除可能影响仓库外调用方。
- 继续保留会扩大密钥和费用风险。

### P0-4：增加图片 API 输入校验

目标：

限制 Base64 请求体、像素规模、MIME 和文件名，降低内存、滥用和异常文件风险。

涉及文件：

- `saas/ecommerce-img/functions/api/remove-bg/removebg.js`
- `saas/ecommerce-img/functions/api/remove-bg/photoroom.js`
- `saas/ecommerce-img/server/remove-bg-server.cjs`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`

验收标准：

- 超过规定大小的请求返回 413。
- 非允许 MIME 返回 415 或明确的 400。
- 文件名经过清理，不进入危险路径或控制字符。
- 第三方 API 调用有超时。
- 前端能区分文件过大、格式错误、额度不足和服务异常。

风险：

- 限制设置过低会阻断正常商品图。
- Cloudflare 和本地 Node 环境的请求处理能力不同。

## P1：修复现有功能和数据链路

### P1-1：统一统计工具名称（已完成，2026-07-14）

目标：

修复压缩工具使用 `compressor`、服务端只接受 `converter`，导致数据归入 `unknown` 的问题。

完成情况：

- 图片压缩前端统一发送 `converter`。
- 服务端继续兼容历史客户端发送的 `compressor`，并归入 `converter`。
- 统计页面显示名称已从“格式转换”更新为“图片压缩”。
- 旧记录中已经写成 `unknown` 的数据不做破坏性迁移。

涉及文件：

- `saas/ecommerce-img/src/tools/FormatConverter.jsx`
- `saas/ecommerce-img/src/tools/shared.js`
- `saas/ecommerce-img/functions/api/track.js`
- `saas/ecommerce-img/functions/api/stats-data.js`
- `saas/ecommerce-img/functions/api/stats.js`

验收标准：

- 图片压缩事件归入 `converter`。
- 图片放大事件归入 `upscale`。
- 商品图事件归入 `product_image`。
- 旧数据仍能正常显示为 `unknown`，不做破坏性迁移。

风险：

- 修改服务端名称可能影响历史数据兼容。
- 前端显式传入的 `tool` 会覆盖路径推断结果。

### P1-2：修复无效埋点事件

目标：

处理 `crop_preset_selected` 和 `batch_normalize` 等未在服务端允许列表中的事件。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- `saas/ecommerce-img/functions/api/track.js`
- `saas/ecommerce-img/functions/api/stats-data.js`
- `saas/ecommerce-img/functions/api/stats.js`

验收标准：

- 所有前端发送的事件都被服务端接受，或者明确删除无用事件。
- 统计看板能够展示新增指标。
- 不破坏已有事件记录。
- 非法事件仍然被拒绝。

风险：

- 增加事件种类会增加 KV 写入量。
- 删除事件可能失去产品分析数据。

### P1-3：在 SPA 路由变化时记录页面访问

目标：

修复应用首次加载后切换工具页面不重新记录 `page_view` 的问题。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- `saas/ecommerce-img/src/tools/shared.js`

验收标准：

- 首次打开页面记录一次访问。
- 在四个主页面之间切换时分别记录访问。
- 浏览器前进和后退同样记录。
- 同一次路由变化不会重复记录两次。

风险：

- React StrictMode 和 effect 依赖可能导致开发环境重复事件。
- 页面访问数量会与旧统计口径发生变化。

### P1-4：修复问卷假报成功

目标：

Cloudflare KV 未配置或接口返回错误时，不再向用户显示“已记录”。

涉及文件：

- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- `saas/ecommerce-img/functions/api/survey.js`

验收标准：

- 只有服务端确认已持久化时显示提交成功。
- KV 未配置时显示明确提示，并按产品决定保存到本机或引导联系。
- 非 2xx 响应进入失败流程。
- 重复点击不会产生不必要的重复提交。

风险：

- 当前线上如果没有 KV，用户会开始看到错误提示。
- 本地保存的数据需要明确后续是否补传。

### P1-5：明确目标 KB 和平台体积是否达标

目标：

当压缩结果没有达到目标 KB 或平台文件上限时，向用户显示真实状态。

涉及文件：

- `saas/ecommerce-img/src/tools/FormatConverter.jsx`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- `saas/ecommerce-img/src/tools/shared.js`

验收标准：

- 每个结果显示“已达到”或“未达到”。
- 未达到目标时提供调小尺寸、降低质量或更换格式的建议。
- ZIP 中的文件状态可在下载前查看。
- 不再把无法保证的结果描述为一定符合平台要求。

风险：

- 用户可能认为功能效果变差，实际上只是提示更加准确。
- PNG 自动转 JPG 会丢失透明背景，需要明确提示。

### P1-6：统一 ONNX 模型下载文件名和加载路径

目标：

修复下载脚本生成 `waifu2x_v3.onnx`，运行时读取 `waifu2x.onnx` 的不一致。

涉及文件：

- `saas/ecommerce-img/download_model.sh`
- `saas/ecommerce-img/convert_waifu2x.py`
- `saas/ecommerce-img/src/ai/waifu2x.js`
- `saas/ecommerce-img/public/models/waifu2x.onnx`
- 项目文档

验收标准：

- 下载、转换和运行时使用同一个明确的文件名。
- 模型升级不会静默覆盖现有生产模型。
- 模型输入输出和 2 倍放大行为经过验证。
- 模型文件缺失时前端有明确错误。

风险：

- 模型来源或架构不一致会导致输出错误。
- 替换二进制模型可能改变图片效果和构建体积。

### P1-7：消除 ONNX Runtime WASM 硬编码哈希

目标：

避免依赖升级或重新构建后 WASM 文件名变化导致 AI 加载失败。

涉及文件：

- `saas/ecommerce-img/src/ai/waifu2x.js`
- `saas/ecommerce-img/vite.config.js`
- `saas/ecommerce-img/package.json`
- `saas/ecommerce-img/package-lock.json`

验收标准：

- WASM 路径由构建系统或 ONNX Runtime 稳定解析。
- 开发和生产构建均能加载模型。
- 浏览器控制台无 WASM 404。
- 非 AI 模式不受影响。

风险：

- ONNX Runtime 不同入口的打包行为不同。
- 修改 WASM 加载方式可能增加构建体积。

## P2：测试、文档和工程稳定性

### P2-1：补充真实项目 README

目标：

替换当前 Vite 模板说明，记录真实的安装、运行、API、环境变量和部署方式。

涉及文件：

- `saas/ecommerce-img/README.md`
- `PROJECT.md`
- `saas/ecommerce-img/.env.example`
- `saas/ecommerce-img/ANALYTICS.md`

验收标准：

- 新开发者可在新环境按文档启动前端。
- 文档区分浏览器本地处理和第三方 AI 上传。
- 所有环境变量和 Cloudflare 绑定都有说明。
- 标明本地原生 AI 服务的额外依赖。

风险：

- 文档可能与 Cloudflare 控制台实际配置不一致，需要部署负责人确认。

### P2-2：建立纯函数单元测试

目标：

优先覆盖不依赖 DOM 的尺寸、裁切、格式和统计逻辑。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- `saas/ecommerce-img/src/tools/FormatConverter.jsx`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- 新增测试文件
- 可能新增测试脚本和测试依赖

验收标准：

至少覆盖：

- 保持比例尺寸计算
- 固定比例裁切
- 最大 10000px 限制
- 目标 KB 选择逻辑
- 平台预设和文件上限
- 埋点事件归一化
- KV 记录汇总

所有测试能通过统一命令运行。

风险：

- 当前纯函数嵌套在大型组件中，可能需要小范围抽取。
- 抽取时必须保持原行为。

### P2-3：增加核心流程端到端测试

目标：

自动验证四个主页面的关键用户流程。

涉及文件：

- 新增 E2E 配置和测试文件
- `saas/ecommerce-img/package.json`
- 可能需要固定测试图片

验收标准：

至少覆盖：

1. 单图放大和下载。
2. 批量压缩和 ZIP。
3. 商品图本地规范化。
4. 联系表单错误和成功状态。
5. 页面路由和浏览器前进后退。

风险：

- 浏览器下载和 Canvas 编码存在平台差异。
- AI 和第三方接口需要 mock，不能在 CI 中消耗真实额度。

### P2-4：建立 CI 构建门禁

目标：

每次提交自动执行安装、lint、测试和构建。

涉及文件：

- 新增 CI 配置
- `saas/ecommerce-img/package.json`
- 测试配置

验收标准：

CI 至少执行：

```bash
npm ci
npm run lint
npm test
npm run build
```

失败时禁止发布。

风险：

- 原生 Sharp 安装可能受 CI 平台影响。
- Node 版本必须与 Vite 8 要求一致。

### P2-5：增加未知路由页面

目标：

避免任意未知 URL 静默显示图片放大首页。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- SEO 和站点地图文件

验收标准：

- 未知路由显示明确的未找到页面。
- 可以返回首页或其他工具。
- 已知四个路由行为不变。
- Cloudflare SPA 回退仍然正常。

风险：

- 当前某些外部链接可能依赖未知路径回退首页。

## P3：性能、结构和后续产品能力

### P3-1：将重图片处理迁移到 Web Worker

目标：

减少大图锐化、滤波、纯色抠图和批量处理对 UI 主线程的阻塞。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- 新增 Worker 文件
- Vite 构建配置

验收标准：

- 处理期间页面仍能响应滚动和取消操作。
- 单图和批量输出与迁移前一致。
- Worker 错误能回传到 UI。
- Object URL、Canvas 和数组内存能及时释放。

风险：

- ImageData 在线程间传输可能产生额外内存。
- Safari、移动端和 OffscreenCanvas 支持需要验证。
- 这是高风险改动，必须有测试后再实施。

### P3-2：收紧图片内存预算

目标：

降低 80MP 输出和批量 Data URL 导致浏览器崩溃的风险。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- `saas/ecommerce-img/src/tools/FormatConverter.jsx`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`

验收标准：

- 根据输入、输出和滤镜数量估算峰值内存。
- 超过安全阈值时阻止或降级处理。
- 移动端使用更低阈值。
- 批量流程及时释放已下载或删除项目的资源。

风险：

- 限制过严会影响 8K 功能。
- 不同浏览器的实际内存上限不同。

### P3-3：逐步拆分大型组件

目标：

降低 `App.jsx` 和 `BackgroundTool.jsx` 的维护成本，同时保持行为不变。

涉及文件：

- `saas/ecommerce-img/src/App.jsx`
- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- `saas/ecommerce-img/src/tools/FormatConverter.jsx`
- 新增 hooks、组件和图片处理模块

验收标准：

- 拆分前先有对应测试。
- 每次只拆一个清晰模块。
- 用户界面和输出结果不变化。
- 不同时进行技术栈迁移或视觉重做。
- 每一步均能单独构建和回退。

风险：

- 闭包状态和回调依赖复杂，容易引入行为变化。
- 大规模一次性重写风险不可接受。

### P3-4：处理未使用代码和依赖

目标：

在确认没有外部使用后，清理旧服务、模板资产和未使用状态。

候选范围：

- `jimp` 依赖
- `src/assets/react.svg`
- `src/assets/vite.svg`
- `src/assets/hero.png`
- `local-server.cjs`
- 未实际处理的 `deblur`
- 未实际处理的 `smartDenoise`
- 未实际处理的 `edgeInterpolation`
- 未实际处理的 `clahe`
- 独立的 `saas/service-card.html`

验收标准：

- 逐项确认没有运行时或部署依赖。
- 清理后 lint 和 build 通过。
- 主页面功能和构建产物不受影响。
- 独立原型的删除或接入必须先获得确认。

风险：

- `local-server.cjs` 可能仍被仓库外部署脚本使用。
- 未使用状态可能是计划中的未完成功能，不应直接删除。

### P3-5：评估正式批量 AI 抠图

目标：

根据真实问卷、使用量和第三方成本决定是否开发批量 AI 抠图。

涉及文件：

- `saas/ecommerce-img/src/tools/BackgroundTool.jsx`
- `saas/ecommerce-img/functions/api/remove-bg/`
- 问卷和统计接口
- 尚未设计的任务、额度和支付模块

验收标准：

开发前先明确：

- 真实月处理量
- 单张第三方成本
- 失败和重试成本
- 批量任务上限
- 用户额度和退款规则
- 图片保留和删除策略
- 是否需要账号和支付

只有获得产品和成本确认后才能进入实现。

风险：

- 第三方 API 成本不可控。
- 批量图片涉及更高隐私和存储风险。
- 当前项目没有账号、订单和任务队列基础设施。

### P3-6：账号、积分和支付系统

目标：

仅在商业模式确认后设计正式付费能力。

涉及文件：

当前尚未确定。该任务不能直接基于现有问卷价格开始编码。

验收标准：

开始开发前必须完成：

- 产品需求确认
- 支付平台选择
- 用户身份设计
- 订单状态机
- 服务端回调验签
- 幂等处理
- 退款和异常补偿
- 积分账本
- 数据安全和隐私评审
- 生产密钥管理方案

风险：

- 涉及资金和用户数据，属于高风险功能。
- 未经用户明确确认禁止修改或实现。
