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
| `DATABASE_URL` | 不设 | **必填** | Neon 控制台的 **pooled** 连接串（主机名带 `-pooler`）。不设时本地自动走 PGlite，零外部依赖即可开发。 | **线上第一次访问数据库就 500**，函数日志里是一句明确的 `DATABASE_URL is required in production...`（不是 EROFS 堆栈）。注意首页匿名访问不碰数据库，所以可能看起来「能打开」，一到登录/榜单就炸。 |
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

- 首页匿名访问 **0 次**查询（`getCurrentUser()` 先看 cookie，没有就直接返回）；
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

### 2.1 实测状态（2026-11-03 14:18 探测）

| 探测 | 结果 | 说明 |
| --- | --- | --- |
| `GET /` | **500** | 首页会读已发布记录（`listPublishedRecords`），所以它现在**也是一个查库页面** |
| `GET /login`、`GET /register` | 200 | 纯表单，GET 不查库 |
| `GET /admin` | 307 | 无 session，重定向到 `/login`，鉴权查询还没发出 |
| `POST /login`（任意邮箱） | **500** | 第一个真正读库的动作 |

> 本文件早前写着「首页匿名访问不碰数据库，所以打得开不代表库连通」。**这句现在已经过期**：
> 自 `5d9ae61` 起首页就是榜单，要读已发布记录。现在的判据反过来了——**首页 500 本身就是库没通的信号**。

构建侧没有问题：构建期不查库（§6.3），所以 `DATABASE_URL` 缺失**不会**让部署失败，
只会在运行时炸。这正是为什么「部署成功」和「站点可用」在本项目里是两件事。

### 2.2 接通数据库是三步，不是一步

三步的症状各不相同，混在一起就会把「表还没建」误判成「环境变量没填」：

| # | 做什么 | 做对了会看到 | 漏了会看到什么症状 |
| --- | --- | --- | --- |
| **①** | 给线上一个 `DATABASE_URL`（§3），**并重新部署一次** | 首页从 500 变成**另一种** 500：函数日志里不再是 `DATABASE_URL is required in production`，而是 `relation "ai_impact" does not exist` | 函数日志里始终是 `DATABASE_URL is required in production...`。注意 Vercel 的环境变量**只注入到之后的部署**，填完不重新部署等于没填 |
| **②** | 跑一次迁移建表（§4） | 首页 **200**，榜单显示空状态；`/register` 能注册、`/login` 能登录 | 500 + 日志 `relation "..." does not exist`。**这一步最容易被当成已经完成**——环境变量填对了、部署也成功了，但表并不会自己出现 |
| **③** | 导入种子数据（§5） | 榜单 **30 条**记录，详情页有来源链接与原文引述 | 站点完全正常，只是榜单空着 —— 没有任何报错，所以只能靠「榜单有没有数据」判断 |

**Vercel 导入 GitHub 仓库不会附带数据库。** 托管 Postgres 要在 project → Storage 里手动挂
（或者把 Neon 控制台给的连接串手填进 Environment Variables），挂上之后还要再部署一次才会注入变量。
这是上面第 ① 步「并重新部署一次」的由来。

### 2.3 第 ②③ 步由谁执行，取决于用户选哪条路

迁移与导数据需要一个能连到那个库的地方。两条路，等用户在 ZCZ-1 的卡片上选：

- **A：用户在 neon.tech 建库并把连接串授权给我们** → 我们在本地按 §4 → §5 执行，用 direct 连接串，
  不需要新代码，也不需要在线上留任何额外端点。
- **B：用户在 Vercel Storage 里挂数据库、但不把连接串给我们** → 线上函数里有 `DATABASE_URL`、
  我们本地没有，因此需要一个一次性的 bootstrap 路由在 Vercel 内部执行迁移与导入，用完立刻删除。
  **该路由尚未实现，等用户选定 B 之后再写**，要求见 §10。

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

按这个顺序逐条过，每条都对应 §2.2 里的一步，**不要跳着看**：

- [ ] **首页 `/` 返回 200**。首页就是榜单、要读库，所以它 500 就说明 §2.2 的第 ① 或第 ② 步没完成；
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
| 线上有一个数据库（§2.2 第 ① 步） | 用户在 Vercel Storage 挂 Neon，或在 neon.tech 建库 | **未完成** —— 线上还没有 `DATABASE_URL`，首页因此 500 |
| 跑迁移 + 导种子数据（§2.2 第 ②③ 步） | 走 A 路需要把连接串授权给我们；走 B 路需要先实现 §10 的 bootstrap 路由 | **等用户在 ZCZ-1 的卡片上选 A 还是 B** |

在用户选定之前：**不注册任何第三方账号、不建任何库、不发生任何支出，也不实现 §10 的路由**；
代码该推照推（§6.1）。

---

## 9. 已知问题与未完成项

- **线上首页 500**，因为线上没有 `DATABASE_URL`、也还没有表（§2）。这是目前唯一的阻塞主线。
- **Stripe 相关环境变量还没进代码**：依赖 T6（§1.2）。
- **node-postgres 这一侧还没有真实连过一个 Postgres。** 线上库还不存在（§8），所以只做到了
  「配置解析 + `pg.Pool` 接受这些参数」级别的验证。生产抛错、trace 排除、PGlite 冒烟、以及
  §6.3 的无 `DATABASE_URL` 生产构建都是本地实测过的；首次部署时请按 §6.4 逐条核对，
  真连上之后才算验证完整。
- **代码推送与 Vercel 导入都已完成**（§6.1、§8）。剩下的阻塞是「线上有没有一个连得上的库」。
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
- 线上验收截图要等 §2.2 三步做完（现在线上首页还是 500），落在 `docs/ACCEPTANCE.md`。

---

## 10. bootstrap 路由（选 B 路才写，目前**未实现**）

只有在用户选择「数据库挂在 Vercel Storage、连接串不给我们」时才需要它：线上函数里有
`DATABASE_URL`，我们本地没有，所以迁移与种子导入得在 Vercel 内部跑一次。

**现在不实现是有意的。** 一个常驻的「知道令牌就能重建数据库」的端点，不该在没人要它的时候存在于
线上代码里。等用户选定 B 之后再加，并且同一个 PR 里就把删除它的后续提交准备好。

真要实现时，这几条是硬要求：

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
