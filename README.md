# AI Shutdown Tracker

追踪 AI 产品与项目的关停记录。每条记录都必须附带可核查的来源（链接 + 原文引用）与归因置信度评级。

当前进度：**T2 脚手架**。本仓库已包含可运行的应用骨架、Drizzle 迁移流程与邮箱密码认证。数据模型（关停记录、来源、归因评级）从 T3 开始按 ZCZ-2 数据字典落地。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router）+ React 19 |
| 语言 | TypeScript 5.9（strict） |
| 样式 | Tailwind CSS v4 + shadcn/ui（new-york / neutral） |
| ORM | Drizzle ORM（`drizzle-orm/pg-core`） |
| 数据库 | 本地 PGlite 内嵌 Postgres；线上托管 Postgres（node-postgres） |
| 认证 | 自建邮箱 + 密码 session（见下） |
| 图表 | Recharts（T5 再引入，当前未安装） |

## 快速开始

需要 Node.js 20+（开发机为 24.22）与 npm（**本项目用 npm，不用 pnpm**）。

```bash
npm install
npm run db:migrate   # 建表；默认写入本地 ./.pglite
npm run dev          # http://localhost:3000
```

不需要 Docker、不需要本地 Postgres、不需要任何第三方账号即可跑通。

然后在 `/register` 注册一个账号，会自动登录并跳转到 `/admin`。

### 页面

| 路由 | 说明 |
| --- | --- |
| `/` | 首页，显示登录状态 |
| `/register` | 注册（T2 阶段开放自助注册，T4 会收紧为邀请制） |
| `/login` | 登录 |
| `/admin` | 后台占位页，**需登录**；未登录会跳转到 `/login` |

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器（Turbopack） |
| `npm run build` | 生产构建（构建时会跑类型检查） |
| `npm start` | 运行生产构建 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | 改完 `src/db/schema.ts` 后生成迁移 SQL 到 `drizzle/` |
| `npm run db:migrate` | 把 `drizzle/` 里的迁移应用到当前数据库 |
| `npm run db:studio` | Drizzle Studio |
| `npm run verify:auth` | 对**已启动**的服务跑注册/登录/登出全链路检查 |

`verify:auth` 走真实 HTTP 请求（cookie、重定向、session 吊销都会被验证），每次用一个新的临时邮箱，可重复执行：

```bash
npm run dev                                   # 另开一个终端
BASE_URL=http://127.0.0.1:3000 npm run verify:auth
```

## 环境变量

复制 `.env.example` 为 `.env.local` 后按需填写。`.env.local` 已被 git 忽略，**真实密钥一律不进仓库**。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 否 | 托管 Postgres 连接串。**留空则使用本地 PGlite**，这是切换驱动的唯一开关。 |
| `PGLITE_DATA_DIR` | 否 | PGlite 数据目录，默认 `.pglite`（已 gitignore）。 |
| `DATABASE_SSL` | 否 | node-postgres 是否用 TLS，默认开启**且校验证书**。只有连私网内可信 Postgres 时才设 `false`。 |

## PGlite 与托管 Postgres 的切换

两种驱动**共用 `src/db/schema.ts` 这一份 `pg-core` 定义**，schema 不分叉。驱动选择集中在 `src/db/config.ts`：

```
DATABASE_URL 有值  ->  node-postgres 连托管 Postgres
DATABASE_URL 为空  ->  PGlite，数据落盘到 ./.pglite
```

应用、迁移脚本、drizzle-kit 都读同一个 `resolveDbTarget()`，不会出现三者连到不同库的情况。`src/db/index.ts` 用动态 `import()` 按需加载驱动，所以只用 PGlite 时不会把 `pg` 拉进运行时，反之同理。

切到托管库只需两步，**不改任何代码**：

```bash
echo 'DATABASE_URL=postgres://user:pass@host:5432/db' >> .env.local
npm run db:migrate
```

`/admin` 页面会显示当前进程实际连到哪个驱动，可据此确认切换生效。

### 本地重置数据库

PGlite 就是一个目录，删掉重建即可：

```bash
rm -rf .pglite && npm run db:migrate
```

## 认证方案

**自建 session，没有引入 Auth.js 或 better-auth。** 理由：当前只有邮箱 + 密码一种方式，session 直接存在项目已有的 Drizzle 连接里，少一层框架就少一处要适配 PGlite / 托管 Postgres 双驱动的地方。等需要接 OAuth 时再评估换成 Auth.js。

实现要点：

- 密码用 `node:crypto` 的 **scrypt**（N=16384, r=8, p=1）哈希，存储格式 `scrypt$N$r$p$salt$hash`，参数随行保存，以后调强度不会让旧账号失效。选 scrypt 而非 bcrypt/argon2 是为了**不引入原生编译依赖**，装包即用。
- 校验用 `timingSafeEqual`，避免时序比较泄漏。
- session token 为 32 字节随机数，**数据库里只存它的 SHA-256**；原值只存在于客户端 cookie。库被拖走也无法直接当登录态重放。
- cookie `aist_session`：`httpOnly`、`sameSite=lax`、生产环境 `secure`、有效期 30 天。
- 登录失败时，"邮箱不存在" 与 "密码错误" 返回**同一句提示**，不泄漏哪些邮箱已注册。
- `/admin` 的鉴权放在 `src/app/admin/layout.tsx`（服务端），**不用 middleware**：middleware 只能看到 cookie 存不存在，看不出 session 是否有效或已吊销。

相关文件：`src/lib/auth.ts`、`src/lib/password.ts`、`src/app/(auth)/actions.ts`。

## 数据库结构（T2）

只有认证需要的两张表，业务表在 T3 加：

- `users` — `id`、`email`（唯一索引，存小写规范化后的值）、`password_hash`、时间戳。
- `sessions` — `id`（token 的 SHA-256）、`user_id`（级联删除）、`expires_at`。

## 部署

**尚未部署。** 托管数据库与 Vercel 账号授权还没拿到，本任务范围内不注册任何第三方账号、不产生任何真实支出。

代码侧已经为部署做好准备：设置 `DATABASE_URL` 即切到 node-postgres，无需改代码。拿到授权后需要补的是托管库上的 `npm run db:migrate`、平台环境变量配置与域名，这些留到对应任务。

具体步骤、环境变量清单与当前授权状态见 [`DEPLOY.md`](./DEPLOY.md)；验收清单见 [`docs/ACCEPTANCE.md`](./docs/ACCEPTANCE.md)。

## 已知取舍

- **没有装 `tw-animate-css`。** shadcn/ui 默认会让你 `@import "tw-animate-css"`，但它只通过 `style` export 条件暴露自身，而 Turbopack 的 CSS 解析器不套用该条件，裸包名与 `dist/` 深路径都解析不了。当前这几个组件（button / input / label / card）都不需要动画工具类，所以直接移除了。等要加 dialog / sheet 这类依赖 `animate-in` 的组件时再处理。
- **`postcss.config.mjs` 不能删。** Tailwind v4 在本项目仍需 `@tailwindcss/postcss`；删掉之后 `npm run build` 依然会成功，但产出的 CSS 只剩变量、没有任何工具类（约 3KB 对 18KB），是静默失效。改样式构建链路后请复核产物：`grep -o 'bg-primary' .next/static/chunks/*.css`。
- **`next.config.ts` 里设了 `agentRules: false`。** 否则 Next 16 每次启动都会在仓库根目录重写一个 `AGENTS.md`，既在 git 里反复产生改动，也会覆盖团队自己写的同名文件。
