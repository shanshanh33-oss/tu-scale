# TU Scale Windows 开发交接

> 更新日期：2026-11-12（Asia/Shanghai）
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

## 必须向用户请示的情形

- 需要管理员权限、关闭/排除安全软件、重启 Windows 或停止归属不明的进程。
- 需要密钥、账号、敏感文件或生产配置。
- 需要删除不可重建的文件、更换技术栈、修改产品行为或触发生产部署。

其他常规诊断、重建、测试、开发分支提交和推送，由 Windows Codex 自主完成。
