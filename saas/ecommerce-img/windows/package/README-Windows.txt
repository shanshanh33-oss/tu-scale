TU Scale Windows x64 本地版
===========================

系统要求
--------
- Windows 10 或 Windows 11，64 位 x86 电脑（Intel / AMD）。
- 建议使用最新版 Microsoft Edge 或 Google Chrome。
- 建议至少 8GB 内存；AI 大图处理建议 16GB 或更多。
- SCUNet/DRUNet 使用的 ONNX Runtime 需要 Microsoft Visual C++ x64 运行库。多数 Windows 10/11 电脑已安装；如果日志提示缺少 MSVCP140.dll，请只从微软官方地址安装：https://aka.ms/vc14/vc_redist.x64.exe

安装
----
1. 先把整个 ZIP 解压到普通文件夹，不要直接在压缩包预览里运行。
2. 双击 “Install TU Scale.cmd”。
3. 安装完成后会自动打开，并在桌面和开始菜单创建 TU Scale 快捷方式。

离线能力
--------
- 图片放大、压缩、商品图规范化、PDF/图片 OCR、PPT 导出都在本机浏览器处理。
- AI 放大、1x AI 增强、人脸保护、中文/英文 OCR 模型都已包含在安装包内。
- SCUNet 和 DRUNet 本地降噪模型也已包含；5179 服务只绑定 127.0.0.1。
- 不需要另装 Node.js、Python，也不需要联网下载模型。
- “联系反馈”在本地版不会直接上传，只会提供复制或邮件 App 操作。

使用和故障排查
--------------
- 网页地址：http://127.0.0.1:5174/
- 本地降噪服务：http://127.0.0.1:5179/
- 日志目录：%LOCALAPPDATA%\TU Scale\logs
- 如果 5174 或 5179 已被其他软件占用，请先关闭占用程序，再重新打开 TU Scale。
- 原生降噪服务不可用时，“智能降噪”仍会自动使用浏览器内置算法。
- AI 放大优先使用浏览器 WebGPU；显卡或浏览器不支持时自动回退到 WASM，速度会较慢。

停止与卸载
----------
- 如需停止后台本地服务，运行安装目录内的 “Stop TU Scale.cmd”。
- 如需卸载，运行安装目录内的 “Uninstall TU Scale.cmd”。
- 卸载不会自动清除浏览器中的 TU Scale 设置或可选历史记录；如需删除，请在浏览器站点数据中清理 127.0.0.1。

安全提示
--------
- 这是未签名的私人安装包，Windows 可能显示未知发布者提示。
- 安装脚本只写入当前用户的 %LOCALAPPDATA%\Programs\TU Scale，并创建当前用户快捷方式，不需要管理员权限。
- 图片、PDF、OCR 文字和 PPT 模板默认不上传；匿名在线统计和云端 Functions 在本地包中不可用。
