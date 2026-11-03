# Rest In Prompts

> RIP — 收录被 AI 浪潮冲击而倒闭、裁员或转型的公司，每条记录都附公开来源与归因置信度。

追踪 AI 产品与项目的关停记录。每条记录都必须附带可核查的来源（链接 + 原文引用）与归因置信度评级。

当前进度：**T3 数据模型 + 管理后台**。应用骨架、Drizzle 迁移流程、邮箱密码认证（T2）之上，
已按 ZCZ-2 数据字典落地 `company` / `ai_impact` / `source` 三张表，以及 `/admin` 下的录入、
审核与发布流程。公开前台（列表、筛选、公司详情、仪表盘）在 T5；种子数据在 T4。

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
| `/` | 首页。只显示 `record_status = 'published'` 的记录；完整前台在 T5 实现 |
| `/register` | 注册（T2 阶段开放自助注册，T4 会收紧为邀请制） |
| `/login` | 登录 |
| `/admin` | 后台首页：各状态记录数与入口。**以下全部需登录**，未登录跳 `/login` |
| `/admin/records` | 记录列表：按状态 / 关键词筛选，分页（每页 20 条） |
| `/admin/records/new` | 新建记录：公司字段 + 事件字段 + 可增删的多条来源 |
| `/admin/records/[id]` | 编辑 + 审核：发布 / 下架 / 拒收 / 删除草稿，并展示已存来源与原文引述 |

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
| `npm run verify:records` | 对**已启动**的服务跑录入 / 发布 / 筛选 / 下架全链路检查（38 项） |
| `npm run verify:db` | 不启服务：在临时 PGlite 库上跑迁移并直接用 SQL 验证数据库约束（26 项） |
| `npm run verify:pg` | 不启服务：验证 `DATABASE_URL` 这条路径能建表（走真实 `pg` 驱动） |

`verify:auth` 与 `verify:records` 走真实 HTTP 请求（cookie、重定向、server action 都会被验证），每次用新的临时邮箱与唯一 slug，可重复执行：

```bash
npm run dev                                   # 另开一个终端
BASE_URL=http://127.0.0.1:3000 npm run verify:auth
BASE_URL=http://127.0.0.1:3000 npm run verify:records
```

`verify:db` 与 `verify:pg` 自带临时数据库，不需要先启服务，也不会动 `./.pglite`。

## 环境变量

复制 `.env.example` 为 `.env.local` 后按需填写。`.env.local` 已被 git 忽略，**真实密钥一律不进仓库**。

| 变量 | 本地必填 | 线上必填 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 否 | **是** | 托管 Postgres 连接串。**本地留空则使用 PGlite**，这是切换驱动的唯一开关。线上必须填（见下方「生产环境禁用 PGlite」）。Vercel 上填 Neon 的 **pooled** 连接串。 |
| `PGLITE_DATA_DIR` | 否 | 否 | PGlite 数据目录，默认 `.pglite`（已 gitignore）。仅本地有意义。 |
| `DATABASE_SSL` | 否 | 否 | node-postgres 是否用 TLS，默认开启**且校验证书**。只有连私网内可信 Postgres 时才设 `false`；Neon 不属于此类。 |
| `DATABASE_POOL_MAX` | 否 | 否 | 连接池上限，默认 `1`。serverless 下每个实例各有一个池，调大会按实例数翻倍。 |
| `DATABASE_IDLE_TIMEOUT_MS` | 否 | 否 | 空闲连接回收时间，默认 `10000`。 |
| `PGLITE_ALLOW_PRODUCTION` | 否 | 否 | 仅用于本地 `npm run build && npm start` 冒烟测试，**不要在部署环境设置**。 |

T6 的 Stripe 变量（全部测试模式）见 [`.env.example`](./.env.example) 与 [`DEPLOY.md`](./DEPLOY.md)，代码里还没读取。

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

### 生产环境禁用 PGlite

PGlite 把数据写到磁盘，而 serverless 函数的文件系统是只读的。为避免线上以一个难读的 `EROFS` 堆栈收场，`resolveDbTarget()` 在 `NODE_ENV=production` 且没有 `DATABASE_URL` 时**直接抛错**，并在错误信息里说明该填什么。

驱动本身用动态 `import()` 加载，加上 `next.config.ts` 里的 `outputFileTracingExcludes`，PGlite 那 27MB 的 wasm 不会进 serverless 产物（构建后 trace 里只剩一个 219 字节的 external 存根，`.next` 下没有任何 `.wasm`）。

需要在本地跑生产构建做冒烟测试时，用 `PGLITE_ALLOW_PRODUCTION=true npm start`。

> 注意：`@electric-sql/pglite` 虽然放在 `devDependencies`，但它同时是 `drizzle-orm` 的 optional peer，所以 `npm install --omit=dev` **仍会装上它**（实测如此）。真正起作用的是上面两道闸：trace 排除 + 生产抛错。

### 连接池为什么默认只给 1 条

部署目标是 Vercel Serverless + Neon 免费档。每个函数实例都会各自初始化一个连接池，池大小 `n` 实际等于 `实例数 × n` 条服务端连接，很容易在流量还没起来时就把免费档的连接数吃满。多路复用交给 Neon 的 pooled endpoint（主机名带 `-pooler`）去做，`pg` 这边每个实例只需要握住一条、空闲就尽快放掉。长驻服务器部署可以用 `DATABASE_POOL_MAX` 调大。

同理，`connectionTimeoutMillis` 设成 15 秒而不是 `pg` 默认的 0（永久等待）：Neon 免费档空闲后会 autosuspend，冷启动要几秒，但「等不到就报错」比「挂住一个请求」好排查。

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

## 数据库结构

Schema 的唯一来源是 `src/db/schema.ts`；枚举取值从 `src/lib/enums.ts` 用 `Object.keys()` 派生，
保证数据库取值与界面标签不会漂移。字段口径照抄 ZCZ-2 数据字典，**不要在这里自行增删枚举值**。

### 认证（T2）

- `users` — `id`、`email`（唯一索引，存小写规范化后的值）、`password_hash`、时间戳。
- `sessions` — `id`（token 的 SHA-256）、`user_id`（级联删除）、`expires_at`。

### 业务表（T3）

```
company 1 ──< ai_impact 1 ──< source
                 └─ is_primary = true 的那条用于榜单（每公司至多一条，靠部分唯一索引保证）
```

- `company` — 公司本身**不带归因结论**。`region` 由 `country_code` 推导后落库，
  国家用 `char(2)` + 应用层白名单，不做枚举。
- `ai_impact` — 一次「AI 影响事件」。一家公司可以有多条（Chegg 2023 / 2025 各一条）。
  `impact_type` 与 `attribution_confidence` **都没有数据库默认值**：没人工选过就建不出这行。
- `source` — 一条来源引述，挂在 `ai_impact` 上。`url` / `media_name` / `published_at` / `quote`
  全部 NOT NULL。

### 「每条记录至少一条来源」是怎么保证的

三层，任何一层单独都拦得住，顺序是从便利到权威：

| 层 | 位置 | 拦的是什么 |
| --- | --- | --- |
| 1 表单 | `src/app/admin/records/record-form.tsx` | 浏览器原生 `required` / `minlength`；最后一条来源不给「移除」按钮 |
| 2 服务端 | `src/lib/records/validation.ts`（zod）+ `src/lib/records/publish.ts` | 绕过表单直接 POST 也会被拒，并返回**具体原因** |
| 3 数据库 | `drizzle/0002_record_integrity.sql` | 延迟约束触发器；直接连库跑 SQL 也插不进没有来源的记录 |

第 3 层用的是 `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`：
外键只能保证「每条来源都指向一个真实事件」，方向正好相反，表达不了「至少一条子记录」。
触发器在 **COMMIT 时**而不是每条语句后检查，所以「先插事件、再插它的来源」这个必经顺序是合法的，
而「提交一条没有来源的事件」会整笔回滚。写入因此必须在一个事务里完成，见 `saveRecord`。
删掉某条记录的最后一条来源同样会被拒；删整条记录则级联带走来源，是允许的。

### 发布门禁（数据字典 §3 的四条业务校验）

数据库约束表达不了的部分在 `src/lib/records/publish.ts`，发布时与**编辑已发布记录**时都会跑：

1. 至少一条来源；
2. 置信度为 `high` 时，至少一条 `primary_company` 或 `tier1_media` 来源；
3. 每条来源的 `url` / `media_name` / `published_at` / `quote` 四项非空；
4. 不得所有来源的 `link_health` 都是 `dead`；
5. （§1.9）`link_health = 'bot_blocked'` 的来源必须 `manually_verified = true`。

任一条不满足就拒绝发布，并在界面上逐条列出原因与补救办法。
这些规则校验的是「**所声称的**置信度有没有证据支撑」，不替录入人判断归因：
置信度只能由人工选择，降档也只能由人工决定。

**本代码库不含任何自动推断「是否因 AI 倒闭」的逻辑**，归因只来自人工标注 + 来源留痕。

### 删除与下架

数据字典 §0 规定不做物理删除：下架用 `record_status = 'archived'`，行与来源留痕都保留在库里。
唯一的例外是**从未发布过的草稿**可以真删（录入手误），后台只在 `draft` 状态下显示「删除草稿」。

## 部署

**尚未部署。** 托管数据库与 Vercel 账号授权还没拿到，本任务范围内不注册任何第三方账号、不产生任何真实支出。

代码侧已经为部署做好准备：设置 `DATABASE_URL` 即切到 node-postgres，无需改代码。拿到授权后需要补的是托管库上的 `npm run db:migrate`、平台环境变量配置与域名，这些留到对应任务。

具体步骤、环境变量清单与当前授权状态见 [`DEPLOY.md`](./DEPLOY.md)；验收清单见 [`docs/ACCEPTANCE.md`](./docs/ACCEPTANCE.md)。

## 已知取舍

- **没有装 `tw-animate-css`。** shadcn/ui 默认会让你 `@import "tw-animate-css"`，但它只通过 `style` export 条件暴露自身，而 Turbopack 的 CSS 解析器不套用该条件，裸包名与 `dist/` 深路径都解析不了。当前这几个组件（button / input / label / card）都不需要动画工具类，所以直接移除了。等要加 dialog / sheet 这类依赖 `animate-in` 的组件时再处理。
- **`postcss.config.mjs` 不能删。** Tailwind v4 在本项目仍需 `@tailwindcss/postcss`；删掉之后 `npm run build` 依然会成功，但产出的 CSS 只剩变量、没有任何工具类（约 3KB 对 18KB），是静默失效。改样式构建链路后请复核产物：`grep -o 'bg-primary' .next/static/chunks/*.css`。
- **`next.config.ts` 里设了 `agentRules: false`。** 否则 Next 16 每次启动都会在仓库根目录重写一个 `AGENTS.md`，既在 git 里反复产生改动，也会覆盖团队自己写的同名文件。
