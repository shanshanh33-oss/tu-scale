# TU Scale Windows 本地安装包

此目录只保存 Windows 打包源码；生成物写入 `release/`，不会提交到 Git。

当前包目标是 Windows 10/11 x64：

- 使用内置 Node.js 运行只绑定 `127.0.0.1:5174` 的静态服务；
- AI 放大由 `127.0.0.1:5179` 使用内置 Python、ONNX Runtime 和 `dist/models/waifu2x.onnx` 在独立进程运行，避免长时间占用浏览器页面线程；
- SCUNet 和 DRUNet 也由同一个仅限本机访问的 5179 服务运行；
- 5179 服务不可用或模型缺失时，现有前端仍会自动选择浏览器 WebGPU/WASM AI 放大；1x AI 增强继续使用随包分发的浏览器 ONNX 模型；
- OCR、MediaPipe、人脸和 PDF 资源均来自正常的 Vite `dist/` 构建。

在 macOS/Linux 构建机上运行：

```bash
./windows/build-windows-package.sh
```

脚本会运行 `npm run build`，从官方来源下载固定版本的 Windows Node/Python 运行时和 Python wheels，复制当前本地模型，生成文件级 SHA-256 清单，再输出 ZIP 与 ZIP 哈希。

由于构建机不是 Windows，发布给其他人前仍需在真实 Windows 10/11 x64 上完成安装、启动、SCUNet/DRUNet、AI 放大、OCR 和卸载验收。安装包未签名，Windows 可能提示未知发布者。

ONNX Runtime 的 Windows DLL 依赖 Microsoft Visual C++ x64 运行库。多数 Windows 10/11 电脑已具备；缺失时应使用微软官方 `https://aka.ms/vc14/vc_redist.x64.exe`，不要从第三方 DLL 网站下载。该运行库不随本包再分发，以遵守微软的再分发许可边界。即使该运行库缺失，浏览器 AI 放大和浏览器智能降噪回退仍可使用。
