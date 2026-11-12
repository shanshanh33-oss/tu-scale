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
- `npm ci`、lint、测试和构建已通过。
- `codex/windows-dev` 无已跟踪源码修改。
- 模型 ZIP 和 `.sha256` 在应用目录中，是本地转移文件，不得提交。

## 模型包

- 文件：`TU-Scale-Windows-AI-Models-20261112.zip`
- 正确 SHA-256：
  `c4d18c8f24061065c674e3057648fd817de2368b986f49521743e2bd179aa8db`
- ZIP 内含 SCUNet 两个模型文件、SCUNet 许可证和 DRUNet 模型。
- ZIP 外层 SHA-256 已通过；已解压到项目并通过四个文件的
  `windows\verify-models.ps1` 校验。这些模型和 ZIP 仍不得提交。

## 当前故障

Python 项目虚拟环境创建后无法启动，首次调用 `.venv` 内 pip 时返回：

```text
No Python at '"D:\Programs\Python31210\python.exe'
```

这表明 `.venv` 记录的基础 Python 路径多了引号，不是模型、npm 或源码故障。
`windows\setup-python.ps1` 已增加自动修复：它使用明确、去除外层引号的 Python
路径，只重建不可用的项目内 `.venv`，然后安装依赖并验证导入。
开发服务当前已停止，Python 依赖尚未安装。

## Windows Codex 下一步

Windows Codex 直接负责以下工作，不要让用户在两台电脑之间传递例行输出：

1. 确认工作区没有需要保留的本地修改，拉取最新 `codex/windows-dev`，阅读根目录
   `AGENTS.md` 和本文件。
2. 在 `D:\Projects\tu-scale\saas\ecommerce-img` 运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\windows\setup-python.ps1 -PythonPath 'D:\Programs\Python31210\python.exe'
   ```

   该脚本可以删除并重建仅限项目内、已损坏且被 Git 忽略的 `.venv`；不得
   删除模型、ZIP、源码或其他本地文件。
3. 运行 `windows\dev-stop.ps1` 和 `windows\dev-start.ps1`，验证：
   - `http://127.0.0.1:5174/` 返回 HTTP 200；
   - 5179 状态的 `pythonRuntime`、`models.scunet`、`models.drunet`、`upscale` 全部为 `true`。
4. 如有常规错误，先在 Windows 端自主诊断、修复和重试，并保留原始错误与修复记录；
   不要让用户转述过程日志。
5. 更新本文件，记录命令、验证结果、遗留问题和最新提交；只提交与当前任务有关的文件，
   推送 `codex/windows-dev`。

## 必须向用户请示的情形

- 需要管理员权限、关闭/排除安全软件、重启 Windows 或停止归属不明的进程。
- 需要密钥、账号、敏感文件或生产配置。
- 需要删除不可重建的文件、更换技术栈、修改产品行为或触发生产部署。

其他常规诊断、重建、测试、开发分支提交和推送，由 Windows Codex 自主完成。
