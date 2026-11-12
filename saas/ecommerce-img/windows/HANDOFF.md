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
- `codex/windows-dev` 在故障前无已跟踪源码修改。
- 模型 ZIP 和 `.sha256` 在应用目录中，是本地转移文件，不得提交。

## 模型包

- 文件：`TU-Scale-Windows-AI-Models-20261112.zip`
- 正确 SHA-256：
  `c4d18c8f24061065c674e3057648fd817de2368b986f49521743e2bd179aa8db`
- ZIP 内含 SCUNet 两个模型文件、SCUNet 许可证和 DRUNet 模型。
- ZIP 已经通过外层 SHA-256，但尚未解压；不要重新下载不明来源的模型。

## 当前故障

`npm ci` 在清理旧依赖时失败：

```text
EPERM: operation not permitted, unlink
D:\Projects\tu-scale\saas\ecommerce-img\node_modules\lightningcss-win32-x64-msvc\lightningcss.win32-x64-msvc.node
```

日志确认 Node/npm 版本、工作目录和 D 盘 npm 缓存正确。失败发生在 npm
清理旧 `node_modules` 阶段，尚未进入正常安装。最可能是仍在运行的
Vite/TU Scale Node 进程加载了 Lightning CSS 原生模块；也需排除编辑器或安全软件短暂占用。

## Windows Codex 下一步

Windows Codex 直接负责以下工作，不要让用户在两台电脑之间传递例行输出：

1. 检查 5174/5179 监听端口及 `node.exe` 命令行，只停止命令行明确指向
   `D:\Projects\tu-scale\saas\ecommerce-img` 的 Vite 或 TU Scale AI 进程。禁止批量结束所有
   Node 进程。
2. 确认 `git diff --quiet` 和 `git diff --cached --quiet` 都通过。先重试 `npm ci`；
   若仍对同一文件报 EPERM，核对绝对路径后只删除可重建的 `node_modules`，
   不得删除项目、ZIP、校验文件或源码。
3. 使用 `D:\Caches\npm`、`D:\Caches\pip` 和 `D:\Temp`，完成 `npm ci`、
   `npm run lint`、`npm test`、`npm run build`。
4. 重新校验 ZIP，解压到应用根目录，运行 `windows\verify-models.ps1`。
5. 在 D 盘项目中创建 `.venv`，安装 `windows\requirements-windows.txt`。
6. 运行 `windows\dev-stop.ps1` 和 `windows\dev-start.ps1`，验证：
   - `http://127.0.0.1:5174/` 返回 HTTP 200；
   - 5179 状态的 `pythonRuntime`、`models.scunet`、`models.drunet`、`upscale` 全部为 `true`。
7. 更新本文件，记录命令、验证结果、遗留问题和最新提交；只提交与当前任务有关的文件，
   推送 `codex/windows-dev`。

## 必须向用户请示的情形

- 需要管理员权限、关闭/排除安全软件、重启 Windows 或停止归属不明的进程。
- 需要密钥、账号、敏感文件或生产配置。
- 需要删除不可重建的文件、更换技术栈、修改产品行为或触发生产部署。

其他常规诊断、重建、测试、开发分支提交和推送，由 Windows Codex 自主完成。
