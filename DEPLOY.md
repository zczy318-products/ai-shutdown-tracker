# 部署手册（Rest In Prompts）

目标形态：代码放在**用户自己的 GitHub 仓库** → 用户在 **Vercel** 控制台导入该仓库 → 之后每次 push 自动部署；
线上数据库用 **Neon 免费档**。

**花钱口径：只用免费额度，不产生任何真实付费支出。Stripe 全程测试模式，不接真实收款。**

> 本文件记录"怎么部署"。实际执行需要用户的账号授权，授权状态见文末 §8。

> **站点已经上线：https://restinprompts.vercel.app**（用户已在 Vercel 导入仓库，push 即部署）。
> 代码线已通，**数据库线一步都没走**，所以现在是「有站点、没数据库」。实测状态与接通步骤见 §2。

---

## 1. 环境变量清单

### 1.1 现在代码里真实读取的变量

| 变量 | 本地 | 线上（Vercel） | 该填什么 / 从哪里拿 | 漏了会怎样 |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | 不设 | **必填** | Neon 控制台的 **pooled** 连接串（主机名带 `-pooler`）。不设时本地自动走 PGlite，零外部依赖即可开发。 | **线上第一次访问数据库就 500**，函数日志里是一句明确的 `DATABASE_URL is required in production...`（不是 EROFS 堆栈）。首页本身就是榜单、要读库，所以**首页打不开就是库没通**（这条自 T5 起变了，早前首页确实不查库）。 |
| `PGLITE_DATA_DIR` | 可选 | 不设 | PGlite 数据目录，默认 `.pglite`。仅本地有意义。 | 无影响，用默认值。 |
| `DATABASE_SSL` | 不设 | **不要设** | 默认开启并**校验**服务端证书。只有数据库证书不是公共 CA 签发时才设 `false`——Neon 不属于这种情况。 | 不设才是对的。设成 `false` 会关掉 TLS 校验，等于把到数据库的那一跳暴露给 MITM。 |
| `DATABASE_POOL_MAX` | 不设 | 不设 | 连接池上限，默认 `1`（理由见 §1.4）。 | 不设才是对的。设大了会按函数实例数翻倍，吃满 Neon 免费档连接数，表现为间歇性 `too many connections`。 |
| `DATABASE_IDLE_TIMEOUT_MS` | 不设 | 不设 | 空闲连接回收时间，默认 `10000`。 | 无影响，用默认值。 |
| `PGLITE_ALLOW_PRODUCTION` | 仅冒烟测试时 | **绝对不要设** | 只为本地 `npm run build && npm start` 临时放行 PGlite。 | 不设才是对的。线上设了会让函数去写只读文件系统，拿到 EROFS 而不是上面那句清楚的报错。 |

驱动选择逻辑在 `src/db/config.ts`，应用、迁移脚本、`drizzle.config.ts` 共用同一份解析，不会各自为政。

**当前线上只需要填 `DATABASE_URL` 一个变量**，其余全部留空（默认值就是为这个部署形态挑的）。
会话用的是存在数据库里的不透明 token，不依赖任何签名密钥变量，所以没有 `AUTH_SECRET` 之类的东西要配。
T6 引入 Stripe 测试模式变量时，**必须同步更新本节的表、`.env.example`，并标明哪些必填、哪些可留空**
（§1.2 已经先列了清单）。

### 1.4 两处和 Neon 免费档直接相关的默认值

**连接池默认 `max: 1`，`idleTimeoutMillis: 10000`。** 这里在 PM 给的两条路里选了 **(a) pooled 连接串 + `pg` 收紧池子**，没有选 (b) `@neondatabase/serverless` + `drizzle-orm/neon-http`。理由：

- `neon-http` 走的是 HTTP 单条查询通道，**不支持事务**。T4 的后台录入要「记录 + 来源」一起写，这是产品负责人定的硬要求（每条记录至少一个来源），必须在一个事务里；
- 选 (b) 等于让本地 PGlite 和线上用两套不同的 drizzle 驱动入口，`db.transaction()` 在两边语义不一致，**这正是「schema 不许分叉」要避免的那种分叉**，只是挪到了驱动层；
- 选 (a) 不增加依赖，`pg` 本来就在依赖里；连接数问题本质上由 Neon 的 pooled endpoint 解决，`pg` 这边只要别自己攒连接。

`connectionTimeoutMillis` 设成 15 秒而不是 `pg` 默认的 0（永久等待），是为了配合下面的 autosuspend：等不到连接就报错，比挂住一个请求好排查。

**PGlite 不会进生产产物。** 三道闸：驱动用动态 `import()` 加载；`next.config.ts` 里 `outputFileTracingExcludes` 把 `@electric-sql/pglite` 从函数 trace 里排掉（那 27MB wasm 否则很容易顶穿 Vercel Hobby 的解压体积上限）；`NODE_ENV=production` 且无 `DATABASE_URL` 时 `resolveDbTarget()` 直接抛错。构建后可以这样复核：

```bash
find .next -name '*.wasm'                      # 应当无输出
grep -rho 'node_modules/@electric-sql[^"]*' .next --include='*.nft.json' | sort -u
```

当前构建的实测结果：`.next` 下没有任何 `.wasm`，trace 里只剩一个 219 字节的 external 存根。

> 已核实的一个反直觉点：`@electric-sql/pglite` 放在 `devDependencies` 里**不足以**让它不被安装——它同时是 `drizzle-orm` 的 optional peer，`npm ci --omit=dev` 照样会装。所以真正起作用的是 trace 排除 + 生产抛错，不是依赖分类。

### 1.5 冷启动与首屏查询

Neon 免费档的 compute 空闲后会 autosuspend，冷启动有几百毫秒到数秒延迟。因此**首屏不要在 server component 里串行打多次数据库**。当前状态：

- 首页匿名访问：鉴权 0 次查询（`getCurrentUser()` 先看 cookie，没有就直接返回），但榜单本身要读已发布记录；
- 已登录时 **1 次**查询：session 和 user 是一条 `innerJoin`，不是两跳；
- `/admin` 的鉴权在 layout 里做 **1 次**查询，页面本身 0 次。

T5 的榜单和仪表盘要守住这条线：合并成尽量少的查询，需要并行时用 `Promise.all`，不要一个指标一个 `await`。

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

## 2. 线上现状与接通数据库的三步

### 2.1 实测状态（2026-11-03 15:10 探测，**线上已完全打通**）

| 探测 | 结果 |
| --- | --- |
| `GET /`（无 cookie） | **200**，榜单 **30 条**，`第 1 / 3 页` |
| `GET /?confidence=high` 等筛选 | **200**，条数与侧栏 facet 完全一致（见 §2.5） |
| `GET /company/<slug>`（29 个全测） | **200 × 29**，54 条来源的 URL 与原文引述 **54/54** 全部渲染 |
| `GET /stats` | **200**，已发布 30 条 / 公司 29 家 / 来源 54 条 |
| `GET /pricing` | **200** |
| `GET /account`、`GET /admin` | **307 → `/login`**（这两个本来就该要账号） |
| `GET /api/export/records`（匿名） | **401** `account_required` |
| `GET /api/v1/records`（无 key） | **401** `missing_key` |
| 任一公开页的 `Set-Cookie` | **无** —— 浏览既不需要、也不会创建会话 |

> 两句已经过期的判据，留在这里免得有人照旧版排查：
> 1. 最早写的「首页匿名访问不碰数据库，所以打得开不代表库连通」——自 `5d9ae61` 起首页就是榜单、要读库，已不成立；
> 2. 紧接着写的「首页 500 本身就是库没通的信号」——现在库已通、数据已导，**首页 200 且有 30 条才是正常态**。
>    首页若再出现 500，是真的回归，不要再当成「库还没接」。

构建侧一直没有问题：构建期不查库（§6.3），所以 `DATABASE_URL` 缺失**不会**让部署失败，
只会在运行时炸。这正是为什么「部署成功」和「站点可用」在本项目里是两件事。

### 2.2 `main` 已经包含全部功能（2026-11-03 15:05 合并）

本文件早前记录「线上跑的是 `main`，而功能都在分支上」。**这一条已经解决**：
PR #1 已合并，`main` = `abd3206`，`feat/zcz-7-saas-tiering`（`c404f8a`）是
`feat/zcz-5-seed-dataset` 的祖先，所以**一次合并就同时带上了 T4 数据集、T5 前台、T6 SaaS 层与 T7 产出**，
不需要分两次合。合并前已跑 `npm run typecheck`（0 错）与 `env -u DATABASE_URL NODE_ENV=production npm run build`（通过）。

**合并与接库的先后顺序是有讲究的，照这个顺序做：**
分支带了两个 `main` 上没有的迁移（`0003_saas_plans_api_keys`、`0004_subscriber_double_optin`），
而线上当时只应用到 `0002`。所以**先对线上跑迁移、再合并**：两个迁移都是纯增量
（新建类型/表、给 `users` 加带默认值的列），对合并前的旧代码无害；
反过来先合并，线上就会出现「代码引用 `api_keys` / `subscriber`，而表还不存在」的窗口。

### 2.3 接通数据库是三步，不是一步（**已全部完成**，保留作排查参照）

下面三步线上都已做完（§2.4 是执行记录）。表格留着是因为三步的**症状各不相同**，
以后换环境重建时，混在一起就会把「表还没建」误判成「环境变量没填」：

三步的症状各不相同，混在一起就会把「表还没建」误判成「环境变量没填」：

| # | 做什么 | 做对了会看到 | 漏了会看到什么症状 |
| --- | --- | --- | --- |
| **①** | 给线上一个 `DATABASE_URL`（§3），**并重新部署一次** | 首页从 500 变成**另一种** 500：函数日志里不再是 `DATABASE_URL is required in production`，而是 `relation "ai_impact" does not exist` | 函数日志里始终是 `DATABASE_URL is required in production...`。注意 Vercel 的环境变量**只注入到之后的部署**，填完不重新部署等于没填 |
| **②** | 跑一次迁移建表（§4） | 首页 **200**，榜单显示空状态；`/register` 能注册、`/login` 能登录 | 500 + 日志 `relation "..." does not exist`。**这一步最容易被当成已经完成**——环境变量填对了、部署也成功了，但表并不会自己出现 |
| **③** | 导入种子数据（§5） | 榜单 **30 条**记录，详情页有来源链接与原文引述 | 站点完全正常，只是榜单空着 —— 没有任何报错，所以只能靠「榜单有没有数据」判断 |

**Vercel 导入 GitHub 仓库不会附带数据库。** 托管 Postgres 要在 project → Storage 里手动挂
（或者把 Neon 控制台给的连接串手填进 Environment Variables），挂上之后还要再部署一次才会注入变量。
这是上面第 ① 步「并重新部署一次」的由来。

### 2.4 线上实际是怎么接通的（执行记录）

最终走的既不是 A 也不是 B：用户给 Paperclip 绑定了 Vercel 凭据，Master PM 经 Vercel Marketplace
直接开通并挂上了 Neon，连接串以环境变量形式存在 Vercel 项目里，**我们从那里读，不另外建库**。
因此 §10 的 bootstrap 路由**不需要、也没有实现**——线上不留任何可以重建数据库的端点。

| 步 | 执行 | 结果 |
| --- | --- | --- |
| ① 挂库 + 注入 `DATABASE_URL` + 重新部署 | Master PM（Vercel Marketplace → Neon） | store `restinprompts-db`，production/preview 均已注入，`iad1` 同区 |
| ② 迁移 | `0000`–`0002` 由 Master PM；**`0003`/`0004` 由本任务补**（见 §2.2 的顺序说明） | `drizzle.__drizzle_migrations` 共 **5** 条；`public` 下 9 张表齐全 |
| ③ 种子导入 | 本任务，`npm run db:seed` | 新增 30 条；29 公司 / 30 记录 / 54 来源；高 11 中 12 低 7；重跑「新增 0、更新 30」条数不变 |

连接串的取法（**不写进仓库、不写进提交、不写进任务评论**）：

```bash
# 从 Vercel 项目环境变量读，decrypt 需要单条 env 的接口
curl -s -H "Authorization: Bearer $VERCEL" \
  "https://api.vercel.com/v1/projects/$PROJECT_ID/env/$ENV_ID?decrypt=true"
```

**项目 env 列表接口（`/v10/projects/{id}/env?decrypt=true`）返回的 `value` 仍然是密文**，
`type` 显示 `encrypted`、`decrypted: false`。要拿明文必须按 **单条** env 的
`/v1/projects/{id}/env/{envId}?decrypt=true` 取。这一点踩过一次，记在这里。

迁移与种子导入都用 **`DATABASE_URL_UNPOOLED`**（直连）临时覆盖 `DATABASE_URL`：

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:migrate
DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:seed
```

原因见 §4：DDL 与 drizzle 的迁移锁放在 PgBouncer 后面不可靠。运行时仍然用 pooled 那条
（Vercel 上的 `DATABASE_URL` 本身就是 pooled，主机名含 `-pooler`，已核对）。

### 2.5 匿名访客全链路实测（2026-11-03 15:10）

产品负责人定稿「默认不需要注册也能浏览」，所以这条必须用**不带 cookie** 的客户端验证，
而且不能只看状态码——下面每个数字都与库里的真实数据逐项对过：

| 筛选 | 线上返回条数 | 侧栏 facet / 库内 |
| --- | --- | --- |
| 无筛选 | 30（3 页：12 + 12 + 6） | 30 |
| `confidence=high` | 11 | 11 |
| `confidence=high&year=2025` | 7 | — |
| `impactType=ai_cost_cutting_layoff` | 13 | 13 |
| `year=2025` | 15 | 15 |
| `industry=software_saas` | 8 | 8 |
| `country=DE` | 3 | 3 |
| `q=uber` | 1 | — |

- 29 个公司详情页**全部**取回并与库内逐条比对：**54/54 条来源 URL、54/54 条原文引述**都在页面上，
  没有截断、没有「登录后可见」、没有任何一页被重定向到 `/login`；
- `/stats` 的三个总数（30 / 29 / 54）与库内 `count(*)` 一致；
- 所有公开响应**都没有 `Set-Cookie`**。这是「浏览不需要注册」的证据：
  不是「我们没看到登录墙」，而是连会话都不曾创建。
- 参数名是从页面表单里读出来的，不是猜的：`q`、`year`、`industry`、`country`、
  **`impactType`**（不是 `impact`）、`confidence`、`sort`。用错名字时页面会**照常返回 30 条**，
  看起来像「筛选没生效」，实际是参数被忽略了——排查时先核对参数名。

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

### 手写迁移

`drizzle/0002_record_integrity.sql` 是**手写**的（`drizzle-kit generate --custom` 建的空文件），
里面是「每条记录至少一条来源」的 plpgsql 延迟约束触发器——`pgEnum`/`check()` 表达不了这条，
所以 drizzle-kit 不会生成它，改 `schema.ts` 也不会把它删掉或重写。它写成可重复执行的
（`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS`），所以对一个被手工改过的库再跑一次也会收敛。
需要改这条约束时直接编辑该文件或再加一个 custom 迁移，**不要**指望 `db:generate` 处理它。

### 迁移路径怎么验证

`npm run db:migrate` 不设 `DATABASE_URL` 时走的是 PGlite 分支，和线上那条**不是同一段代码**。
两条都有脚本覆盖，改完 schema 后都跑一遍：

```bash
npm run verify:db     # PGlite 分支：空库 → 最新，再跑一次确认幂等，并逐条验证约束
npm run verify:pg     # DATABASE_URL 分支：真实 pg 驱动 + Postgres 线协议
```

`verify:pg` 的服务端是用 `@electric-sql/pglite-socket` 把 PGlite 挂到一个 TCP 端口上
（这台机器上没有 Postgres 守护进程，也没有容器运行时）。客户端那一侧是真的：TCP、`pg` 的握手、
预处理语句、以及 node-postgres 版 migrator。**没有覆盖**的是 Neon 特有的行为——TLS 终止与
pooled endpoint，那些只能在首次对真实库跑 §4 时才算验过。

---

## 5. ③ 种子数据导入

**脚本已落地：`src/db/seed.ts`，入口 `npm run db:seed`。** 已对本地 PGlite 实跑通过，
导入结果与 `docs/SEED_VERIFICATION.md` 完全对上（29 家公司 / 30 条记录 / 54 条来源，
置信度 high 11、medium 12、low 7）。

```bash
npm run db:seed -- --dry-run     # 只校验不写库，用来先看数据集能不能过
npm run db:seed                  # 本地 PGlite
DATABASE_URL='<direct 连接串>' npm run db:seed    # 线上（direct，不是 pooled）
SEED_FILE=path/to/other.json npm run db:seed
```

落实的几条口径：

- **幂等**：按业务键 `(company.slug, event_date, impact_type)` 匹配已有记录并原地更新，
  公司按 `slug` upsert，来源由 `saveRecord` 整组替换。实测连跑两次：第一次「新增 30 条」，
  第二次「新增 0 条，更新 30 条」，`ai_impact` 始终 30 条、`source` 始终 54 条；
- **复用后台的服务端校验，没有另写一份**：`recordInputSchema`（`src/lib/records/validation.ts`）
  + `checkPublishable`（`src/lib/records/publish.ts`）。种子记录直接以 `published` 落库，
  所以发布闸门（high 必须有一手/主流媒体来源、不得全是死链等）同样适用；
- **先全量校验，再统一写入**：任何一条不过就整批不写，退出码非零。缺来源 URL 或缺原文引述时
  打印「第几条 — 哪家公司/事件日期 — 缺什么字段」。**脚本不会为了让导入跑通而放宽校验**，
  数据有问题就改数据。实测注入四种故障（删 quote、清空 url、清空 sources、写一个与国家矛盾的 region），
  四条都被按条点名拒绝且一条未写入；
- 另外两道数据集专属的检查，是后台表单不会遇到、只会出现在批量数据里的情况：
  **未知字段**（数据集多了一个导入器不认识的键）与 **`region` 与 `country_code` 推导结果不一致**
  都按硬失败处理，而不是静默丢弃——`region` 是派生字段，两者矛盾说明其中一个是错的；
- 写入是**整条记录一个事务**（公司 + 事件 + 全部来源），走 `saveRecord`，
  否则会撞上「每条记录至少一条来源」的延迟约束触发器；
- 结束时打印库内核对：company / ai_impact / source 条数、`record_status` 分布、置信度分布，
  以及两个必须为 0 的违例计数（无来源记录数、high 缺一手来源数）。**任一不为 0 则脚本报错退出**。

核对查询（导入后手动确认一遍）：

```sql
select count(*) from ai_impact;                                         -- 总条数
select record_status, count(*) from ai_impact group by 1 order by 1;    -- 状态分布
select attribution_confidence, count(*) from ai_impact
  group by 1 order by 1;                                               -- 置信度分布

select count(*) from ai_impact i                                       -- 必须为 0
  where not exists (select 1 from source s where s.ai_impact_id = i.id);

-- 必须为 0：置信度为 high 却没有一手 / 主流媒体来源
select count(*) from ai_impact i
  where i.attribution_confidence = 'high'
    and not exists (
      select 1 from source s
       where s.ai_impact_id = i.id
         and s.source_type in ('primary_company', 'tier1_media'));
```

第三条查询返回 0 是硬性要求：每条记录至少一个来源，这是产品负责人定的数据完整性底线。
正常情况下它**插不进**违反这条的数据（触发器会拒），这条查询是用来确认触发器真的在线上库里生效了
——`verify:pg` 会检查它存在，但线上库是另一个实例。

---

## 6. 推 GitHub 与 Vercel 导入

### 6.1 推代码（已打通）

GitHub 已通过 Paperclip 托管连接接通，仓库已建好并完成首次推送，`origin` 已配置且跟踪 `origin/main`：

| 项 | 值 |
| --- | --- |
| 仓库 | `zczy318-products/rest-in-prompts`（私有） |
| 默认分支 | `main` |
| 首次推送的提交 | `a0a7bad`（T2 脚手架 + 数据库生产路径加固） |

> **表里的仓库名是改名后的目标值，GitHub 上的实际改名要由用户在 Settings → General → Repository name 里操作。**
> 改名后 GitHub 会自动重定向旧路径，本地 `origin` 继续可用；想清理的话再跑
> `git remote set-url origin https://github.com/zczy318-products/rest-in-prompts.git`。

**推送约定：每个任务做完、提交之后立刻 push，不要攒到最后一次性推。**

```bash
git add -A
git commit -m "<type>: <what changed>"
git push          # origin/main 已跟踪，不需要再 -u
```

**由此产生一条硬性要求：`main` 上的每个提交都必须是能构建通过的状态。**
Vercel 导入之后 push 即部署，一个构建不过的提交就是一次失败的线上部署。推之前至少跑：

```bash
npm run typecheck && npm run build
```

### 6.2 Vercel 导入（由用户在控制台操作，我们不碰 Vercel API）

1. Vercel → Add New → Project → 选刚才那个 GitHub 仓库；
2. Framework Preset 会自动识别为 Next.js，**Build / Output 设置全部保持默认**。本项目不需要 `vercel.json`：构建命令、输出目录、Node 版本都走 Vercel 对 Next.js 的默认约定，手写一份只会多一个会过期的配置文件；
3. Environment Variables 按 §1 填入（Production + Preview 都要填，否则 Preview 部署会连不上库）：
   - `DATABASE_URL` = Neon 的 **pooled** 连接串 —— 这是唯一必填项
   - 其余变量**一个都不要设**，默认值就是为这个部署形态挑的（§1.1 最后一列说明了设错的后果）
   - T6 合并后再加 Stripe 的那几个（全部 test 模式）
4. Deploy。之后往 `main` push 即自动部署，Preview 分支自动出预览环境。

### 6.3 构建期不碰数据库（必须保持的不变量）

Vercel 的**第一次**构建发生在用户填环境变量之前，所以构建必须在没有 `DATABASE_URL` 的情况下成功。
这条已实测通过：

```bash
env -u DATABASE_URL NODE_ENV=production npm run build
```

当前输出里 `/`、`/admin`、`/login`、`/register` 全部是动态渲染 `ƒ`，只有 `/_not-found` 是静态 `○`，
构建期一次库都没查。

**往后加页面时要守住这条**：榜单页、公司详情、仪表盘**不要在构建期预渲染时查库**——那会让 Vercel
首次构建直接失败在「环境变量还没填」上。需要缓存/静态化时用 ISR（`export const revalidate = N`）或
`unstable_cache`，让查询发生在运行时的第一次请求，而不是构建期。
加完页面后用上面那条命令复核一遍：**新路由如果出现在 `○ (Static)` 一侧且它要读库，就是踩了这条线。**

迁移同理不在构建期跑：`build` 脚本就是 `next build`，DDL 只在 `npm run db:migrate` 手动执行（§4）。
所以即使 `DATABASE_URL` 填错构建也会成功——错误要到运行时才暴露，看 §6.4 的自查。

### 6.4 部署后自查

按这个顺序逐条过，每条都对应 §2.3 里的一步，**不要跳着看**：

- [ ] **首页 `/` 返回 200**。首页就是榜单、要读库，所以它 500 就说明 §2.3 的第 ① 或第 ② 步没完成；
      第一次打开可能有 Neon 冷启动延迟，但那表现为慢，不是 500
- [ ] **榜单不是空的**，读到的是种子数据（30 条）；空榜单 + 无报错 = 第 ③ 步没做
- [ ] `/register` 能注册、`/login` 能登录；cookie 的 `Secure` 标记在线上生效（`NODE_ENV=production` 时自动打开）
- [ ] 匿名（无 cookie）能走通榜单 → 筛选 → 公司详情 → 仪表盘，**浏览不需要注册**（计划修订 5 的访问模型）
- [ ] Vercel 的 Function 日志里三条都没有：`DATABASE_URL is required in production`（变量没填，或没填到对应
      environment，或填完没重新部署）、`relation "..." does not exist`（表没建）、`too many connections`（池子设大了）

---

## 7. 免费额度红线

只用免费额度，不产生任何真实付费支出。因此**不引入**下列能力，需要时先找 Master PM 走授权卡片：

| 不用 | 替代做法 |
| --- | --- |
| Vercel Postgres / KV / Blob | 数据库只用 Neon 免费档；暂时不需要 KV 和对象存储 |
| Edge Config | 配置走环境变量 |
| Vercel Cron | 过期 session 在读取时顺手清理（`src/lib/auth.ts`），不需要定时任务 |
| Image Optimization 超额 | 目前没有需要优化的远程图片；真要加先算额度 |
| Stripe 真实收款 | 全程测试模式，`sk_test_` / `pk_test_`，不接真实支付 |

本项目也**不需要 `vercel.json`**：构建命令、输出目录、Node 版本全部走 Vercel 对 Next.js 的默认约定，手写一份只会多一个会过期的配置文件。

## 8. 授权状态

| 事项 | 需要什么 | 状态 |
| --- | --- | --- |
| 推代码到 GitHub | GitHub 连接 | ✅ **已接通**（账号 `andrewdeng318` / ZCZY318），仓库见 §6.1 |
| Vercel 导入仓库 | 用户自己在控制台操作 | ✅ **已完成** —— https://restinprompts.vercel.app ，push 即部署 |
| 线上有一个数据库（§2.3 第 ① 步） | 用户绑定 Vercel 凭据 | ✅ **已完成** —— Master PM 经 Vercel Marketplace 开通并挂上 Neon，`DATABASE_URL` 已注入 |
| 跑迁移 + 导种子数据（§2.3 第 ②③ 步） | 从 Vercel 项目环境变量读连接串 | ✅ **已完成**（§2.4）。A/B 两条路都没用上，**§10 的 bootstrap 路由不需要、未实现** |

**计费口径（重要，与早前的「免费档」不同）**：这个 Neon 是经 Vercel Marketplace 开的，
该 installation 处于 Neon 的 **Launch 付费档**（存储 $0.35/GB-月，计算 $0.106/CU-小时），**不是免费档**。
免费档 `free_v3` 在 Vercel 侧是 **installation 级**的，切过去会把用户另外 4 个在产数据库一起降档，所以没有动。
由此两条硬要求：**不要**为了方便再开新库或新分支；**不要**跑长时间大查询或轮询——计算按 CU-小时计费。
§7 里「只用 Neon 免费档」的表述按此理解为「不新增付费面、把用量压到最小」。

---

## 9. 已知问题与未完成项

- ~~线上首页 500~~ **已解决**：库已挂、迁移已跑到 `0004`、种子已导入，首页匿名 200 且 30 条（§2.1）。
- **node-postgres 这一侧已经真实连过线上 Neon 了**（此前只验证到「配置解析 + `pg.Pool` 接受参数」）：
  迁移（direct 串）、种子导入与重跑（direct 串）、运行时查询（pooled 串，线上函数）三条路径均实测通过。
- **线上库里有一个验收用的测试账号**（`acceptance+<时间戳>@example.com`，`plan=pro`，
  `billing_events.source='simulated'`）。那是 §2.5 / `docs/ACCEPTANCE.md` 的 05–08 步留下的，
  **不是真实付费用户，也没有发生任何扣款**。看用户表时请按此理解；要清掉的话删该账号即可，
  但下次重跑验收还会再生成一个。
- **Stripe 相关环境变量还没进线上**：Vercel 项目里目前**没有任何 `STRIPE_*`**，所以线上的升级动作
  落在 T6 的 `simulated` 模式（页面上明示「不是真实交易、没有扣款」）。要切到 Stripe 测试模式，
  按 §1.2 补变量并同步 `.env.example`。
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
- 线上验收材料见 `docs/ACCEPTANCE.md`（§2.3 三步已完成，截图与实测输出已对线上重拍）。

---

## 10. bootstrap 路由：**不需要，也没有实现**（本节保留为历史决定）

这个路由只在「数据库挂在 Vercel Storage、连接串不给我们」那条路上才需要。
**实际没有走那条路**（§2.4）：连接串在 Vercel 项目环境变量里可读，迁移与种子导入都在本地执行完了，
所以线上**不存在**任何可以重建数据库的端点，也没有新增任何环境变量。产品负责人亦已明确不要加。

**不实现是有意的。** 一个常驻的「知道令牌就能重建数据库」的端点，不该在没人要它的时候存在于线上代码里。

以下要求留档，仅当将来真的没有别的路可走时才参照（届时同一个 PR 里就要备好删除它的后续提交）：

| 要求 | 为什么 |
| --- | --- |
| 令牌只从环境变量读，且与请求值做**定长时间比较**（`crypto.timingSafeEqual`，先比长度再比内容） | `===` 比较会按首个不同字节提前返回，可被逐字节试探 |
| 路由必须**幂等** | 迁移本身幂等（drizzle 记录已执行的文件），种子导入也幂等（§5）。用户多点一次不该产生重复数据 |
| 响应里**不回显令牌**，也不回显连接串 | 返回体会进浏览器历史、代理与 Vercel 日志 |
| 只接受 `POST`，并带 `noindex` | 避免被预取、被爬到 |
| 执行完**立刻删除该路由**（同一个 PR 的后续提交，push 即生效） | 这是一次性引导，不是运维后门 |
| 失败时返回可诊断的信息（哪一步、什么错），但不含凭据 | 否则在那个环境里没有第二种排查手段 |

此外要注意：Vercel 函数有执行时长上限，迁移 + 30 条记录的导入（每条一个事务）在冷启动的
Neon 上并非瞬时完成。路由要分两个动作（先迁移、再导入）分别触发，而不是一次请求干完两件事。
