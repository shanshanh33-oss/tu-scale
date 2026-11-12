# TU Scale 画质升级第一阶段技术审计

> 核查日期：2026-11-12（Asia/Shanghai）
> 开发分支：`codex/windows-dev`
> 范围：Windows 源码、GitHub 分支、公开站点静态资源与画质基线准备。未更改生产环境。

## 已确认的基线

- Windows 源码位于 `D:\Projects\tu-scale`，Web 项目在 `saas/ecommerce-img`。React、Vite、`src`、`public`、`functions`、`server`、`package.json` 和锁文件齐全。Windows 本地完整服务已在前一阶段验证：5174 返回 HTTP 200；5179 的 Python、SCUNet、DRUNet 和 upscale 状态均为 true。
- 核查时远端 `main` 为 `e0697dbe41c9e55df48548b3a0c665662000fa9a`（2026-10-20），`codex/windows-dev` 为 `7a287dd7f7b86fb8d21f467c780a7d1343aba208`（2026-11-12）。后者领先 6 个提交，`main` 没有独有提交。两个分支的 `src`、`package.json`、`vite.config.js` 和 `index.html` 没有差异；开发分支增加 Windows 工具、交接文件和一个浏览器增强模型。
- 公开站点 `https://tu-scale.pages.dev/`、`/format-converter`、`/product-image`、`/contact` 均返回 HTTP 200。公开首页的 JS、CSS 与当前 Windows 构建产物逐字节一致；HTML 忽略换行符后内容一致。公开 `models/waifu2x.onnx` 与本地同名模型 SHA-256 一致。
- 开发分支中的 `models/waifu2x-enhance.onnx` 尚未在线上提供：同路径请求得到 HTTP 200 的 HTML 回退页，而非 ONNX 文件。不能把这个 200 当成模型已部署。

## 不能由本次核查证明的事项

- 静态资源匹配说明当前公开前端与本地构建一致，但不能证明 Cloudflare 实际部署的 Git 提交号、Functions/KV 配置或运行时密钥状态。
- 四个路由返回 200 只证明 SPA 入口可达，不等于页面交互、图片输出或数据接口回归通过。
- 尚无约 50 张固定原图和旧版输出，因此没有完成画质保真、彩色摩尔纹、纹理、人物/车辆身份或性能基线的同图对比。不得据此声称新模型优于现有方案。
- 现有局部摩尔纹回归测试只检查尺寸、透明度和遮罩外 RGB 不变；它不衡量彩色波纹消除程度或遮罩内纹理损失。

## 固定画质测试集的建立方式

1. 原图与输出放在仓库外的 D 盘目录，保持用户授权、来源和文件哈希记录；不提交照片或用户数据。
2. 目标约 50 张，覆盖人像、商品/汽车、建筑/自然纹理、彩色摩尔纹和插画。每张保留原图，记录尺寸、格式、色彩/透明信息及具体缺陷。
3. 对同一原图以相同设置保存当前线上版、本地当前版和候选版输出，并记录版本、参数、处理时间、峰值内存/显存及错误或回退。
4. 人工评价优先检查人物身份、车辆和文字形状、真实纹理、彩色波纹和过度平滑。新方案明显损害原图结构时不得替换现有放大基准。
5. 候选方案先在 `codex/windows-dev` 评估，不改 `main`。浏览器 WebGPU/WASM、失败回退及 Mac 的 Safari/Chrome 回归通过后再讨论发布。

## 下一步

- 收集有使用权的固定原图并形成可重复的旧版输出档案；先针对彩色摩尔纹建立专项样图。
- 将现有 `src/ai/adaptiveMoire.js`、`localizedChromaMoire.js` 与真实失败样图逐一对照，再决定是否需要局部算法修改。
- 另行评估候选模型的画质、速度、内存、模型体积、浏览器兼容性和商用许可。当前不替换现有模型。
