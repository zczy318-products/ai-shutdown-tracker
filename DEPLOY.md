# 部署手册（AI Shutdown Tracker）

目标形态：代码放在**用户自己的 GitHub 仓库** → 用户在 **Vercel** 控制台导入该仓库 → 之后每次 push 自动部署；
线上数据库用 **Neon 免费档**。

**花钱口径：只用免费额度，不产生任何真实付费支出。Stripe 全程测试模式，不接真实收款。**

> 本文件记录"怎么部署"。实际执行需要用户的账号授权，授权状态见文末 §7。

---

## 1. 环境变量清单

### 1.1 现在代码里真实读取的变量

| 变量 | 本地 | 线上（Vercel） | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 不设 | **必填** | 不设时自动走 PGlite（内嵌 Postgres，存在 `./.pglite`），本地零外部依赖即可开发。设置后走 `node-postgres`。 |
| `PGLITE_DATA_DIR` | 可选 | 不设 | PGlite 数据目录，默认 `.pglite`。仅本地有意义。 |
| `DATABASE_SSL` | 不设 | 不设 | 默认开启并**校验**服务端证书。只有数据库证书不是公共 CA 签发时才设 `false` 关掉 TLS——Neon 不属于这种情况，线上请勿设置。 |

驱动选择逻辑在 `src/db/config.ts`，应用、迁移脚本、`drizzle.config.ts` 共用同一份解析，不会各自为政。

### 1.2 T6（SaaS 分档 + Stripe 测试模式）落地后会新增

以下变量**代码里还没有**，列在这里是为了建站时一次性配齐，等 T6 合并后再填：

| 变量 | 说明 |
| --- | --- |
| `STRIPE_SECRET_KEY` | 测试模式密钥，必须以 `sk_test_` 开头。出现 `sk_live_` 即为配置错误，应当拒绝启动。 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 测试模式公钥，`pk_test_` 开头。 |
| `STRIPE_PRICE_ID_PRO` | 付费档价格 ID（测试模式下创建的 price）。 |
| `STRIPE_WEBHOOK_SECRET` | webhook 签名密钥，本地用 `stripe listen` 产出的那个。 |
| `NEXT_PUBLIC_APP_URL` | Checkout 回跳地址的基准 URL，例如 `https://<project>.vercel.app`。 |

### 1.3 本地怎么填

```bash
cp .env.example .env.local   # .env.local 已在 .gitignore 中，不会被提交
```

真实密钥只进 Vercel 的 Environment Variables 和本地 `.env.local`，**不进仓库**。

---

## 2. 操作顺序（总览）

必须按这个顺序，否则第一次部署会打到一个空库上：

```
① Neon 建项目拿连接串
      ↓
② 本地用 Neon 的 direct 连接串跑 migration
      ↓
③ 本地跑种子导入脚本，核对条数与置信度分布
      ↓
④ 推代码到用户的 GitHub 仓库
      ↓
⑤ 用户在 Vercel 控制台导入仓库 + 填环境变量 → 首次部署
      ↓
⑥ 走全链路验收并截图（见 docs/ACCEPTANCE.md）
```

---

## 3. ① Neon 建库

1. 在 Neon 控制台新建 project，region 就近选（用户在亚太则选 Singapore，减少冷启动延迟）。
2. 免费档默认即可，**不要**开启任何付费加购项。
3. Neon 会给出两种连接串，两者都要留着，用途不同：

   - **Pooled**（主机名里带 `-pooler`）：给线上应用用。Vercel 是 Serverless，实例会被频繁拉起，直连容易把 Neon 免费档的连接数吃满，必须走连接池。
   - **Direct**（不带 `-pooler`）：给 migration 和一次性脚本用。建表这类 DDL 不适合走 PgBouncer 的 transaction 模式。

   即：

   ```
   Vercel 的 DATABASE_URL  = pooled   连接串
   本地跑 migration 的 DATABASE_URL = direct 连接串
   ```

4. 免费档的 compute 会在空闲后自动挂起，第一个请求有几百毫秒到数秒的冷启动，这是预期行为，不是 bug。验收时第一次打开页面偏慢属正常。

---

## 4. ② 迁移线上库

迁移在本地执行，推送到 Vercel 的构建流程里**不跑** migration（构建环境跑 DDL 会在多实例并发时互相打架，也会让一次失败的构建留下半套 schema）。

```bash
# 用 Neon 的 direct 连接串，临时注入，不写进文件
DATABASE_URL='postgres://...neon.tech/neondb?sslmode=require' npm run db:migrate
```

预期输出：

```
[migrate] target: node-postgres (DATABASE_URL)
[migrate] done
```

改了 `src/db/schema.ts` 之后要先生成 SQL 再迁移：

```bash
npm run db:generate   # 产出 drizzle/NNNN_*.sql，需要提交进仓库
npm run db:migrate
```

`drizzle/` 目录下的 SQL 和 `drizzle/meta/` 必须一起提交——迁移记录是靠它判断哪些已经执行过的。

---

## 5. ③ 种子数据导入

**现状：脚本尚未落地**，因为它依赖 T3 的领域表和 T4 的数据集，两者都还没合并。下面是已经定好的契约，T4/T5 一到就能直接实现。

- 入口：`npm run db:seed`，脚本位置 `src/db/seed.ts`；
- 输入：T4 产出的 `seed/companies.json`；
- **幂等**：同一条记录重跑不新增。靠业务唯一键做 upsert（公司 + 停运事件维度），不靠自增 id，允许对 Neon 重复执行；
- **复用后台的服务端校验**：缺来源 URL 或缺原文引述（verbatim quote）的记录直接拒绝，并打印是第几条、哪家公司、缺什么字段。
  **不会为了让导入跑通而放宽校验**——校验失败就退出非零，由数据侧改数据，而不是由脚本降低门槛；
- 导入结束打印：成功条数、拒绝条数、按置信度分档的分布，用于和 T4 的说明逐项核对。

核对查询（导入后手动确认一遍）：

```sql
select count(*) from shutdown_records;                                  -- 总条数
select attribution_confidence, count(*) from shutdown_records
  group by 1 order by 1;                                                -- 置信度分布
select count(*) from shutdown_records r                                 -- 必须为 0
  where not exists (select 1 from sources s where s.record_id = r.id);
```

最后一条查询返回 0 是硬性要求：每条记录至少一个来源，这是产品负责人定的数据完整性底线。

---

## 6. ④⑤ 推 GitHub 与 Vercel 导入

### 6.1 推代码（需要用户授权，见 §7）

```bash
git add -A
git commit -m "feat: AI shutdown tracker"
git remote add origin git@github.com:<user>/<repo>.git
git push -u origin main
```

### 6.2 Vercel 导入（由用户在控制台操作，我们不碰 Vercel API）

1. Vercel → Add New → Project → 选刚才那个 GitHub 仓库；
2. Framework Preset 会自动识别为 Next.js，**Build / Output 设置全部保持默认**。本项目不需要 `vercel.json`：构建命令、输出目录、Node 版本都走 Vercel 对 Next.js 的默认约定，手写一份只会多一个会过期的配置文件；
3. Environment Variables 按 §1 填入（Production + Preview 都要填，否则 Preview 部署会连不上库）：
   - `DATABASE_URL` = Neon 的 **pooled** 连接串
   - T6 合并后再加 Stripe 的那几个（全部 test 模式）
4. Deploy。之后往 `main` push 即自动部署，Preview 分支自动出预览环境。

### 6.3 部署后自查

- [ ] 首页能打开（第一次可能有 Neon 冷启动延迟）
- [ ] `/register` 能注册、`/login` 能登录，cookie 的 `Secure` 标记在线上生效（`NODE_ENV=production` 时自动打开）
- [ ] 榜单读到的是 Neon 里的种子数据，不是空列表
- [ ] Vercel 的 Function 日志里没有数据库连接错误

---

## 7. 授权状态（当前卡在这里）

| 事项 | 需要什么 | 状态 |
| --- | --- | --- |
| 推代码到用户 GitHub | GitHub 连接授权卡片 | **待用户批准** |
| 建 Neon 库 | Neon 连接授权卡片 | **待用户批准** |
| Vercel 导入仓库 | 用户自己在控制台操作（其 GitHub 已关联 Vercel） | 等 ①④ 完成后由用户执行 |

在授权到位之前：本文档、构建验证、脚本契约这些准备工作照做；**不执行** `git push`、不建 Neon 项目、不注册任何第三方账号、不发生任何支出。

---

## 8. 已知问题与未完成项

- **种子导入脚本还没写**：依赖 T3 领域表 + T4 数据集（§5）。
- **Stripe 相关环境变量还没进代码**：依赖 T6（§1.2）。
- `npm run build` 当前通过。修掉的两个会影响线上的问题：
  - `globals.css` 引了 `tw-animate-css` 导致构建失败。**最终处理是移除该依赖与那行 `@import`**，不是补装：
    该包只通过 `style` export 条件暴露自身，而 Turbopack 的 CSS 解析器不套用这个条件，裸包名和
    `dist/` 深路径都解析不了（`resolveAlias` 也绕不过去）。T2 的 button / input / label / card
    都不需要动画工具类。等 T4/T5 加 dialog、sheet 这类需要 `animate-in` 的组件时再处理，
    届时可考虑把那份 MIT 的 CSS 直接 vendor 进仓库。
  - 数据库连接此前用 `rejectUnauthorized: false`，等于 TLS 形同虚设。已改为校验证书，需要关掉校验的场景走 `DATABASE_SSL`（§1.1）。
- Tailwind v4 必须保留 `postcss.config.mjs` + `@tailwindcss/postcss`。去掉之后 `npm run build`
  **仍然成功**，但产出的 CSS 只有变量、没有任何工具类（约 3KB 对 18KB），属于静默失效。
  改动样式构建链路后请用 `grep -o 'bg-primary' .next/static/chunks/*.css` 复核。
- 迁移不在构建期执行，是有意为之（§4）。换成自动迁移前请先想清楚并发构建的问题。
- 线上验收 URL 和全链路截图在首次部署之后补，落在 `docs/ACCEPTANCE.md`。
