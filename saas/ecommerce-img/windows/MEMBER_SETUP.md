# Better Auth 会员账号（开发分支）

状态：代码与本地模拟 D1 测试已完成；**没有配置线上 D1、邮件、短信或生产密钥，也没有部署**。当前 `/member` 页面在缺少配置时显示“尚未启用”。免费图片工具继续匿名可用。

## 代码与功能

- `src/membership/MemberPage.jsx`：邮箱验证码注册/登录，登录后绑定手机号，退出。
- `functions/api/auth/[[path]].js`：只暴露六个必需的 Better Auth 路由；手机号发码和绑定要求现有邮箱账号会话。
- `server/member-auth.js`：Better Auth 1.7.25 原生 D1、数据库限流、验证码发送预算和服务绑定；邮件验证码哈希存储。
- `migrations/0001_members.sql`：与当前 Better Auth 配置一致的 D1 schema，另有每日发送预算表。只可用于新建的隔离数据库，不能直接对已有数据库执行。
- `tests/member-auth.test.mjs`：内存 SQLite 模拟 D1，覆盖 schema、邮箱注册、手机号绑定、退出、越权、服务失败与预算耗尽。

## 将来启用所需配置

须先经用户批准生产设置、发送服务、隐私条款和部署。本分支没有执行以下操作。

1. 创建独立 D1 数据库，将其绑定名设为 `MEMBER_DB`；在隔离环境应用 `migrations/0001_members.sql`，复核表和索引。
2. 设置 `MEMBER_AUTH_URL` 为实际站点的单一 origin（例如 `https://example.com`，不带结尾 `/`）；设置至少 32 字符的高熵 `MEMBER_AUTH_SECRET`，只放服务端 Secret。页面与 Functions 必须同源。
3. 设置正整数 `MEMBER_EMAIL_DAILY_LIMIT`、`MEMBER_SMS_DAILY_LIMIT`；数据库限流另设每分钟最多 20 次请求。预算按 UTC 日期记账，发送服务失败仍占用名额，以控制重试成本。
4. 提供 `MEMBER_DELIVERY` Worker service binding。它接收 POST JSON `{kind, contact, code}`，`kind` 为 `email` 或 `phone`；仅在邮件或短信服务**接受发送**时返回 2xx，其余返回非 2xx。验证码只在服务端传递，禁止记入日志或前端。这里没有选择服务商，也没有接入实际密钥。
5. Pages Functions 运行环境要支持 Node 兼容 API（`nodejs_compat`），并用对应的兼容日期测试。当前只做了本地 Wrangler 打包，尚未配置任何 Pages 项目。

## 数据与后续门槛

账号库保存邮箱、已绑定手机号、会话及必要的限流记录；验证码有效期 10 分钟。Better Auth 手机插件的临时验证码默认存在其 verification 表中，应限制 D1 访问并安排过期记录清理。需要在开放前确定隐私告知、账号注销与数据删除流程、记录保留期限、发送服务商和区域合规。不得把匿名图片历史与账号自动关联。

目前没有支付、会员额度、订单、套餐或权益发放。未来迁移到腾讯云时，应在测试环境迁移 Better Auth 表结构和用户记录，验证唯一约束、会话失效/重新登录、发送接口与数据删除流程，再确定切换方案；当前没有跨云迁移脚本。

## 本地验证

`npm run lint`、`npm test`、`npm run build`；本地 Pages Functions 可用官方 Wrangler `pages functions build functions --compatibility-date 2026-11-16 --compatibility-flags nodejs_compat` 打包。真实注册必须使用经批准的 D1 和发送服务进行预发布环境验收，当前模拟测试不代表邮件或短信实际投递成功。

### 本机交互演示

在 `saas/ecommerce-img` 目录运行：

```powershell
node .\node_modules\vite\bin\vite.js --config .\windows\member-preview.vite.config.js --host 127.0.0.1 --port 5184 --strictPort
```

打开 `http://127.0.0.1:5184/member`。这个入口加载与 5174 相同的 TU Scale 页面，但通过本地专用 Vite 配置将会员接口接到内存 SQLite 模拟 D1。它只监听回环地址，不改变现有 5174 或 5179 服务；重启即清空测试账号。使用预填的 `demo@example.test` 和 `+8613800138000`，点击发送验证码后点击“填入演示验证码”，即可操作注册、手机绑定和退出。验证码只用于这两个虚构联系方式，不会发送真实邮件或短信，也不写入日志或磁盘。终端按 Ctrl+C 停止该演示服务。

本机演示不代表 Cloudflare D1、真实邮件/短信投递、生产 Cookies 或账号数据保留策略已通过验收。演示专用提示通过 Vite 开发模式开启，生产构建不包含验证码查看入口。

Windows 桌面另有独立的“TU Scale 会员版”快捷方式，运行 `windows/member-preview-start.ps1`：5184 未运行时启动，再打开会员页；现有“TU Scale”快捷方式仍启动原版。5184 被其他进程占用时脚本会停止并报错，不会结束其他进程。此快捷方式只在当前 Windows 电脑上，不随 Git 提交。

### 独立公网测试包（尚未部署）

`npm run build:member-test` 生成 `dist-member-test`，只供新建的独立 Pages 项目使用。该包关闭手机号入口，移除指向原站的 canonical/OG URL 和站点地图，写入 `robots.txt` 与 `X-Robots-Tag: noindex, nofollow`；不会改变普通 `npm run build` 的 `dist`。服务端还必须设置 `MEMBER_EMAIL_ONLY=1`，否则不能保证手机 API 被关闭。

不要把 5184 的内存 SQLite、模拟发送方或取演示验证码接口部署到公网。独立站点启用真实注册前，须有 Cloudflare 登录授权、独立 Pages 项目与 D1 绑定、有效发送服务及发件身份、服务端 Secret、真实投递与浏览器验收。当前用户选择先仅开放邮箱，暂不接短信；没有自有发信域名，供应商方案仍待确认。新站点不应连接现有生产 Pages 项目或 KV。
