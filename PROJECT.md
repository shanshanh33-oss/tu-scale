# TU Scale 项目说明

## 项目目标

TU Scale 是一个以浏览器本地处理为主的图片工具箱，面向需要快速处理图片的普通用户、自媒体、电商卖家和批量图片处理场景。

当前主要目标包括：

1. 提供无需登录的图片放大、图片压缩、裁切和常用格式输出功能。
2. 尽可能在浏览器本地完成图片处理，减少图片上传和隐私风险。
3. 提供淘宝、拼多多、抖店、京东、1688、快手、Amazon 等平台的商品图尺寸规范化能力。
4. 测试 AI 放大、AI 抠图、批量商品图处理等高级功能的实际需求。
5. 通过匿名产品事件、用户反馈和需求问卷判断后续开发优先级。
6. 在不破坏现有免费功能的前提下，逐步验证可持续的产品和商业模式。

需要注意：

- 普通图片放大、压缩、裁切和商品图尺寸规范化主要在浏览器本地完成。
- 用户主动使用第三方 AI 抠图时，图片会发送到对应抠图服务。
- 当前支付、积分、账号和正式批量 AI 抠图尚未实现。

## 当前技术栈

### 前端

- React 19
- React DOM 19
- JavaScript / JSX
- Vite 8
- Tailwind CSS 4
- Lucide React
- JSZip
- 浏览器 Canvas、ImageData、Blob、FileReader、History API

项目没有使用 TypeScript，也没有使用 React Router。页面路由由 `src/App.jsx` 使用浏览器 History API 管理。

### AI 和图片处理

- 浏览器 Canvas 图片缩放和像素处理
- ONNX Runtime Web
- 浏览器端 waifu2x ONNX 模型
- 可选的本地 `waifu2x-ncnn-vulkan` 服务
- Node.js + Sharp 本地图片处理服务
- Python + PyTorch 模型转换脚本

### 服务端和数据存储

- Cloudflare Pages Functions
- Cloudflare KV
- remove.bg API
- 预留的 PhotoRoom API 代理
- 本地开发环境使用 JSONL 文件保存问卷、联系反馈和抠图调用记录

### 工程工具

- npm
- package-lock.json
- ESLint 10
- Git

当前没有自动化测试、CI/CD、Docker 或 Wrangler 配置。

## 当前完成状态

### 已完成

#### 图片放大

- 单图和批量上传
- 文件夹递归选择
- 倍数放大和目标尺寸输出
- 1080、2K、4K、8K 预设
- PNG、JPEG、WebP 导出
- 多种比例裁切
- 智能锐化、自动色阶、自然饱和度和抗锯齿
- 浏览器端 AI 放大
- 原图和结果对比
- 单图下载和 ZIP 批量下载
- 设置保存和键盘快捷键
- 大尺寸输出风险提示

#### 图片压缩

- 多图和文件夹上传
- JPG、WebP、PNG、AVIF 输出
- 目标 KB 压缩尝试
- 常用网页、社媒和证件照尺寸预设
- 自定义尺寸
- 裁切、缩放和面部参考线
- 单图下载和 ZIP 下载

#### 商品图规范化

- 多电商平台尺寸预设
- 批量识别图片比例、体积、白底和主体占比
- 单张确认裁切、补背景、主体范围和位置
- 批量生成规范图
- 免费纯色背景清理
- remove.bg AI 抠图
- 抠图前预处理
- 结果画笔编辑
- 白底合成、阴影和主体占比调整
- AI 抠图付费及批量需求问卷

#### 运营功能

- 产品事件埋点
- 30 日统计看板
- 联系反馈表单和反馈看板
- 抠图需求问卷和问卷看板
- SEO 元信息、结构化数据、站点地图和 SPA 回退
- 微信赞赏入口

### 部分完成

- AI 放大仍处于 Beta 状态。
- 本地原生 AI 服务依赖仓库外的 waifu2x 可执行文件和模型。
- 目标 KB 压缩是尽力而为，不能保证一定达到目标。
- 商品图文件大小限制不能在所有图片上保证达到。
- HEIC、HEIF、TIFF 等格式的支持取决于浏览器解码能力。
- PhotoRoom 服务端代理已经存在，但没有接入当前前端流程。
- Sharp 放大接口仍存在，但当前前端没有调用。
- 下载统计已经区分成功下载操作、首次成功导出图片和旧版下载事件；2026-07-12 的旧版 ZIP 重复数据保留并标记为异常。
- 管理看板只有部分接口支持访问口令。
- 部署依赖 Cloudflare 控制台手工配置，尚未完全代码化。

### 尚未完成

- 自动化测试
- CI/CD
- 正式管理后台权限系统
- 完整隐私政策和数据删除机制
- 账号、支付、订单、积分和额度
- 正式批量 AI 抠图
- 生产错误监控和告警
- 完整部署配置和项目文档
- Web Worker 图片处理
- 未知路由 404 页面

## 本地运行方式

主项目目录：

```bash
cd saas/ecommerce-img
```

### 安装依赖

建议使用满足 Vite 8 要求的 Node.js：

```text
Node.js ^20.19.0 或 >=22.12.0
```

安装锁文件指定的依赖：

```bash
npm ci
```

### 启动前端

```bash
npm run dev
```

Vite 开发服务器会将以下请求代理到 `127.0.0.1:5180`：

- `/api/remove-bg`
- `/api/survey`
- `/api/contact`

### 启动本地抠图和反馈服务

在 `saas/ecommerce-img/.env.local` 中配置：

```dotenv
REMOVE_BG_API_KEY=你的_remove_bg_key
REMOVE_BG_PORT=5180
PHOTOROOM_API_KEY=可选的_photoroom_key
```

启动服务：

```bash
npm run remove-bg-server
```

本地服务可能生成以下被 Git 忽略的数据文件：

```text
tmp-survey.jsonl
tmp-contact.jsonl
tmp-removebg-usage.jsonl
```

这些文件可能包含用户反馈、联系方式、IP 或文件名，不得提交到 Git。

### 可选的本地原生 AI 服务

```bash
npm run ai-server
```

该服务还需要自行准备：

```text
waifu2x/waifu2x-ncnn-vulkan
waifu2x/models-upconv_7_photo/
```

仓库当前不包含这些文件。未准备依赖时，浏览器会尝试使用 `public/models/waifu2x.onnx`。

### 代码检查和构建

```bash
npm run lint
npm run build
```

预览构建结果：

```bash
npm run preview
```

构建产物位于：

```text
saas/ecommerce-img/dist/
```

## 部署方式

当前代码设计目标是部署到 Cloudflare Pages。

建议的 Cloudflare Pages 配置：

```text
Root directory: saas/ecommerce-img
Build command: npm run build
Build output directory: dist
```

Cloudflare Pages 会读取项目根目录下的 `functions/` 作为 Pages Functions。

### 必需绑定和密钥

KV namespace binding：

```text
TUSCALE_ANALYTICS
```

remove.bg 密钥：

```text
REMOVE_BG_API_KEY
```

可选 PhotoRoom 密钥：

```text
PHOTOROOM_API_KEY
PHOTOROOM_SANDBOX_API_KEY
```

管理看板访问口令：

```text
CONTACT_ADMIN_TOKEN
STATS_ADMIN_TOKEN
```

生产环境应强制配置管理访问口令，并对统计、问卷和联系数据接口实施统一访问控制。`STATS_ADMIN_TOKEN` 未配置时统计接口保持兼容开放，但只返回按天散列的访客键；配置后 `/api/stats` 和 `/api/stats-data` 均要求 Bearer Token 或 `token` 查询参数。

### SPA 路由

`public/_redirects` 包含：

```text
/* /index.html 200
```

该文件会被复制到构建目录，用于 Cloudflare Pages 的前端路由回退。

### 当前部署限制

仓库没有 Wrangler、Docker、GitHub Actions 或其他基础设施配置。

因此，KV 绑定、API Secret 和构建目录目前需要在 Cloudflare 控制台中手工配置。部署前必须确认：

1. KV 已正确绑定。
2. remove.bg 接口的成本限制已启用。
3. 管理和数据接口已启用访问控制。
4. Secret 没有写入前端代码或提交到 Git。
5. `npm run lint` 和 `npm run build` 已成功执行。

## 数据流和主要模块

### 图片放大数据流

```text
用户选择图片
  -> FileReader 读取为 Data URL
  -> 浏览器 Image 解码
  -> 可选裁切
  -> Canvas / ONNX Runtime Web 处理
  -> Canvas 导出 Blob
  -> 单图下载或 JSZip 批量打包
```

普通放大流程不需要上传原始图片。

浏览器 AI 放大优先检查本地 `localhost:5179` 服务；服务不可用时，再尝试加载浏览器 ONNX 模型。

主要文件：

- `src/App.jsx`
- `src/ai/waifu2x.js`
- `public/models/waifu2x.onnx`
- `server/ai-server.cjs`

### 图片压缩数据流

```text
用户选择多张图片或文件夹
  -> 浏览器解码图片
  -> 根据预设计算目标尺寸
  -> 可选裁切和证件照参考线
  -> Canvas 重绘
  -> 按输出质量或目标 KB 多次编码
  -> Blob 下载或 ZIP 打包
```

主要文件：

- `src/tools/FormatConverter.jsx`
- `src/tools/shared.js`

### 商品图规范化数据流

免费本地规范化：

```text
选择多张图片
  -> 分析比例、体积、背景和主体占比
  -> 用户逐张或批量确认
  -> Canvas 裁切、补背景和调整主体范围
  -> 压缩到平台预设
  -> ZIP 下载
```

AI 抠图：

```text
用户选择图片并主动点击 AI 抠图
  -> 浏览器生成预处理图片
  -> POST /api/remove-bg/removebg
  -> Cloudflare Function 检查密钥和每日额度
  -> 图片发送到 remove.bg
  -> 返回透明背景结果
  -> 浏览器合成白底、阴影和主体比例
  -> 用户编辑和下载
```

主要文件：

- `src/tools/BackgroundTool.jsx`
- `functions/api/remove-bg/removebg.js`
- `server/remove-bg-server.cjs`

### 统计数据流

```text
前端 trackEvent
  -> 浏览器内事件队列
  -> POST /api/track
  -> 下载成功事件按 eventId 幂等去重
  -> Cloudflare Pages Function
  -> TUSCALE_ANALYTICS KV
  -> /api/stats-data 分页读取
  -> 访客标识转换为仅当天有效的散列键
  -> /api/stats 展示统计看板
```

主要文件：

- `src/tools/shared.js`
- `functions/api/track.js`
- `functions/api/stats-data.js`
- `functions/api/stats.js`

### 反馈和问卷数据流

```text
联系页面或商品图问卷
  -> POST /api/contact 或 /api/survey
  -> Cloudflare KV
  -> 对应管理看板读取和展示
```

本地开发环境由 `server/remove-bg-server.cjs` 写入 JSONL 文件代替 KV。

主要文件：

- `src/tools/ContactPage.jsx`
- `src/tools/BackgroundTool.jsx`
- `functions/api/contact.js`
- `functions/api/contact-results.js`
- `functions/api/survey.js`
- `functions/api/survey-results.js`
- `functions/api/survey-results-json.js`
