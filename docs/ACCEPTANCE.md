# 验收材料（T7 / ZCZ-8）

状态：**线上已打通并完成验收实测**

- 线上地址 **https://restinprompts.vercel.app** ，**匿名**访问首页 200、榜单 **30 条**；
- 种子数据已导入**线上 Neon** 并核对（§3：29 公司 / 30 记录 / 54 来源 / 高 11 中 12 低 7，重跑幂等）；
- **匿名全链路已对线上逐项实测**（§7）：榜单 → 筛选 → 详情（29 页全测，54/54 来源与原文引述）→ 仪表盘；
- 全链路 8 步截图见 §2。

> 本节先前写着「线上首页仍是 500，线上还没有数据库」。**那已经过期**：数据库已挂、
> 迁移已到 `0004`、种子已导入、`main` 已包含全部功能（见 `DEPLOY.md` §2.1–§2.4）。

截图统一放 `docs/acceptance/` 下，命名即顺序，由 `npm run capture:acceptance` 产出（见 §1），不手工截。

> **编号在本次更新里变了。** 产品负责人定稿「默认不需要注册也能浏览」（计划修订 5 的访问模型），
> 所以验收演示不再从注册开始：**01–04 是匿名路径**（无账号、无 cookie 走通榜单 / 筛选 / 详情 / 仪表盘），
> **05–08 才是注册之后多出来的能力**。原来的 `01-register.png` / `02-login.png` 相应改名为
> `05-register.png` / `06-login.png`，并在本轮随整批一起重拍了一次。

---

## 1. 环境与命令（实际执行的命令，照抄即可）

```bash
npm install
npm run db:migrate           # 本地：不设 DATABASE_URL，自动走 PGlite，建表
npm run db:seed              # 导入 seed/companies.json（幂等，可重复跑）
npm run dev                  # 本地起服务
npm run build                # 产物验证
npm run capture:acceptance   # 截图（另开一个终端，dev 跑着的时候执行）
```

线上的迁移与导数据见 `DEPLOY.md` §2.3（**接通数据库是三步，症状各不相同**）与 §4 / §5。

### 截图是脚本产出的，不是手工截的

`scripts/capture-acceptance.mjs`（Playwright + Chromium）把全链路跑一遍并逐步截图到
`docs/acceptance/`。这样做的理由：验收材料要能**重跑**——前台改了版、或者要对线上环境再出一份，
重跑一次就行，不用人再点一遍八个步骤。

```bash
BASE_URL=https://restinprompts.vercel.app npm run capture:acceptance   # 对线上出一份
```

脚本分两个**场景**，顺序就是验收演示的顺序：

1. **匿名**（01–04）：一个全程不被塞 cookie 的浏览器上下文。每张截图前都断言
   `context.cookies()` 为空——这才是「浏览不需要注册」这句话的证据，而不是「我们相信它不需要」。
   若某页偷偷下了会话 cookie，脚本会直接失败而不是照常出图；
2. **账号**（05–08）：注册 → 登录 → 升级（Stripe 测试模式）→ 导出 CSV。
   每次运行注册一个带时间戳的新账号（`acceptance+<yyyymmddhhmmss>@example.com`），
   所以对同一个库可以反复执行，不会撞已存在的邮箱。

未上线的路由按**待补**处理而不是失败：每次运行末尾打印「还缺哪几张、各自阻塞于谁」，
避免文档与实际产出悄悄脱节。截图的清理也改成**跑完才扫**——只删本次没拍到的旧图，
这样一次失败的运行不会把已有材料清空，而一张旧版本界面的图也不会被当成新证据留下。

### 浏览器与中文字体（无 root 的沙箱）

正常机器上 `npx playwright install --with-deps chromium` 就够了。本项目的运行环境没有 root，
且 **`$HOME` 每个会话重建**，所以浏览器、系统库、中文字体每次都得重新取——已经写成脚本：

```bash
bash scripts/setup-acceptance-browser.sh      # 约 5 分钟，全部装在 $HOME 下，不需要 root
source "$HOME/.acceptance-browser-env"        # LD_LIBRARY_PATH + FONTCONFIG_FILE
npm run capture:acceptance
```

脚本里固化了两个踩过的坑：

1. `--with-deps` 会调 sudo 直接失败，所以改用 `apt-get download` + `dpkg-deb -x` 把
   27 个依赖包解到用户目录，运行时带 `LD_LIBRARY_PATH`。包名不是猜的：脚本每次都用 `ldd`
   复核两个浏览器二进制，**把还缺的库一次性全部列出来**，而不是让 playwright 一次只报一个；
2. **界面全是中文，不装 CJK 字体截出来整页都是豆腐块**（第一次就是这样）。而且只把
   `fonts-noto-cjk` 的字体文件放进用户目录**不生效**——fontconfig 只扫配置里列过的目录，
   必须用 `FONTCONFIG_FILE` 指一份把该目录 `<dir>` 进去的 `fonts.conf`。
   脚本最后会在浏览器里把「一」和「鑫」各画一遍、数着墨像素做自检：字体装上了两者差一个量级
   （实测 1911 / 9555），没装上则**两个都是同一个豆腐块、像素数相同**。
   量文字宽度是查不出来的——豆腐块的 advance 宽度和真字形一样。

| 项 | 值 |
| --- | --- |
| 本地地址 | http://localhost:3000 |
| 代码仓库 | `zczy318-products/ai-shutdown-tracker`（私有，默认分支 `main`；GitHub 侧改名由用户操作） |
| 线上地址 | **https://restinprompts.vercel.app** —— 已部署、库已通、数据已导，匿名首页 200 / 30 条 |
| 线上 `main` | `abd3206`（PR #1 已合并，含 T4 数据集 + T5 前台 + T6 SaaS 层 + T7 产出） |
| Node 版本 | 本地验证用 v24.22.2；Vercel 用其 Next.js 默认 Node |
| 数据库 | 本地 PGlite / 线上 Neon（经 Vercel Marketplace 开通，**Launch 付费档**，非免费档，见 `DEPLOY.md` §8） |
| Stripe | 测试模式口径；线上目前**没有任何 `STRIPE_*` 变量**，升级动作落在 `simulated` 模式，不接真实收款 |

### 构建结果（最近一次本地验证）

按 Vercel 首次构建的条件验证，即 `NODE_ENV=production` 且**不设** `DATABASE_URL`：

```bash
env -u DATABASE_URL NODE_ENV=production npm run build
```

```
✓ Compiled successfully in 10.0s
Route (app)
┌ ƒ /                        ├ ƒ /api/v1/records
├ ○ /_not-found              ├ ƒ /company/[slug]
├ ƒ /account                 ├ ƒ /login
├ ƒ /admin                   ├ ƒ /pricing
├ ƒ /admin/records           ├ ƒ /register
├ ƒ /admin/records/[id]      ├ ƒ /stats
├ ƒ /admin/records/new       ├ ƒ /subscribe/confirm
├ ƒ /api/billing/webhook     └ ƒ /subscribe/unsubscribe
├ ƒ /api/export/records
```

**含 T5 / T6 / T10 全部新路由在内，17 条路由里只有 `/_not-found` 是静态 `○`，其余全是动态 `ƒ`，
构建期一次库都没查。** 这是 Vercel 构建（环境变量可能还没填）能过的前提，加新页面时要守住，
判据与做法见 `DEPLOY.md` §6.3。

> 这次构建是在工作区的一份临时副本里跑的（`/tmp` 下，`node_modules` 硬链接过去），
> 为的是不覆盖同事 dev server 正在用的 `.next`。同一棵源码树，结论一致。

### 自动化检查（T3 起可跑）

截图之外，这四条命令的输出可以直接贴进验收材料：

| 命令 | 覆盖 | 要先启服务 |
| --- | --- | --- |
| `npm run verify:auth` | 注册 / 登录 / 登出 / session 吊销 | 是 |
| `npm run verify:records` | 录入含 2 条来源的记录并发布、5 条失败路径、筛选分页、下架、删除、鉴权（38 项） | 是 |
| `npm run verify:public` | 公开前台：筛选组合条数、分页、排序、可见性、详情页全部来源、仪表盘数字（86 项） | 否（自带临时库与服务） |
| `npm run verify:db` | 迁移从空库跑通 + 幂等 + 数据库层约束（26 项） | 否 |
| `npm run verify:pg` | `DATABASE_URL` 这条路径能建表（真实 `pg` 驱动 + 线协议） | 否 |

后三条自带临时数据库，不会动 `./.pglite`；`verify:public` 另需先 `npm run build`，它serve 的是生产构建。

---

## 2. 全链路步骤（逐步截图）

### 场景一：匿名（无账号、无 cookie）

浏览默认不需要注册，所以演示从这里开始。每一步都在一个从未拿到 cookie 的上下文里跑。

| # | 步骤 | 截图要体现什么 | 状态 |
| --- | --- | --- | --- |
| 01 | 匿名浏览榜单（首页） | 列表有数据，条数与 §3 对得上；页面上**没有**「请先登录」之类的门槛 | ✅ `01-list.png` |
| 02 | 匿名筛选 | 筛选生效（置信度 = 高），URL 上带筛选参数 | ✅ `02-filter.png` |
| 03 | 匿名看公司详情 | **必须露出来源链接与原文引述**，以及置信度分档 | ✅ `03-detail.png` |
| 04 | 匿名看统计仪表盘 | 图表 + 置信度分布 | ✅ `04-dashboard.png` |

这四张都是在**从未拿到 cookie** 的浏览器上下文里拍的，脚本每张截图前都断言过 `cookies()` 为空。

### 场景二：账号（注册之后多出来的能力）

| # | 步骤 | 截图要体现什么 | 状态 |
| --- | --- | --- | --- |
| 05 | 注册 | 填写表单 + 注册成功后的落地页 | ✅ `05-register.png` / `05b-register-success.png` |
| 06 | 登录 | 登录表单 + 登录态下的用户标识 | ✅ `06-login.png` / `06b-signed-in.png` |
| 07 | 升级到付费 | 定价页 + 升级后的账户页，**能看出没有真实扣款** | ✅ `07-upgrade.png` / `07b-upgraded.png` |
| 08 | 导出 CSV | 付费档的导出入口 + 实际导出的 CSV 内容（含表头） | ✅ `08-export.png` + `08-export-head.csv` |

免费档与付费档的对照在**线上**也复核过，而且是在服务端挡的、不只是文案差别：
匿名 / 免费档请求 `GET /api/export/records` 被挡下（匿名实测 **401 `account_required`**，
文案明确写着浏览榜单与筛选是免费的）；升级之后同一个接口返回 **55 行 CSV**（表头 + 54 条来源，
每行一条来源，含 URL、媒体、发布日期、原文引述、置信度），行数与线上库里的 `source` 条数一致。

**07 的升级是 `simulated` 模式，不是 Stripe 测试结账**：线上 Vercel 项目里**没有任何 `STRIPE_*` 变量**，
T6 因此落到模拟分支，页面上明确写着「不是一笔真实交易，也没有任何扣款」，
`billing_events` 里记的是 `simulated.upgrade`（已在线上库里核对到）。
要出真正的测试模式结账页，需要先配 `sk_test_` 等变量，这需要用户授权（见 §4）。
**全程没有任何真实收款，没有注册任何支付账号，没有任何支出。**

### 这批截图是在什么环境下拍的（重要）

**已经是线上的了。** 先前这一节写的是本地 dev + PGlite，本轮已按
`BASE_URL=https://restinprompts.vercel.app npm run capture:acceptance` 整批重拍：

| 项 | 值 |
| --- | --- |
| 地址 | **https://restinprompts.vercel.app**（线上，Vercel 生产部署） |
| 代码 | **`main` = `abd3206`**，部署 `dpl_9SBkFfpSTH9Hx9j6CjXsiQ9otZi5`（READY） |
| 数据库 | **线上 Neon**，内容是 `npm run db:seed` 导入的那 30 条（与 §3 线上那一列同源） |
| 验收账号 | `acceptance+20261103150708@example.com`（本次运行新注册） |
| 计费 | `simulated` 模式 —— 线上**没有配任何 `STRIPE_*`**，不是真实交易，无扣款 |

**怎么证明这批图确实来自线上而不是本地**：08 导出的 CSV 里那几条 `ai_impact_id`
（`728b8216…` / `24aa81a9…` / `096f5224…`）拿回**线上库**里查，**3/3 命中**，
分别对应 `rws-holdings` / `uber` / `verizon`；线上 `users` 表里也确实只有上面那一个验收账号
（`plan=pro`、`plan_source=simulated`），`billing_events` 里是一条 `simulated.upgrade`。

> 01–04、07 这几张与上一轮本地截图**字节完全相同**，一开始我以为是没重拍。核对后不是：
> 同一份代码、同一批 30 条数据、同一视口与字体，渲染本来就是确定性的，而截图里不含地址栏。
> 变的是 05 / 06 / 08（账号邮箱带时间戳）与 CSV（`exported_at` 与线上 UUID）。

另外说明一个容易被误读的细节：01 截图里关键词框显示的 `chegg` 是 **placeholder 示例文字**
（HTML 上是 `placeholder="chegg"`、`value=""`），不是被预填的筛选条件——
所以那一页同时显示「全部记录 30 条」是对的，不是筛选失灵。

---

## 3. 数据库核对

两列都是 `npm run db:seed` 结束时**自己打印**出来的，不是手抄的。
线上那一列的连接串用 `DATABASE_URL_UNPOOLED`（直连）临时覆盖 `DATABASE_URL`，口径见 `DEPLOY.md` §2.4。

| 项 | 期望 | 本地实测（PGlite） | **线上实测（Neon）** |
| --- | --- | --- | --- |
| 记录总条数 | ≥ 30 | **30**（`ai_impact`） | **30** |
| 公司数 / 来源数 | 与 T4 说明一致（29 / 54） | **29 / 54** | **29 / 54** |
| 置信度分布 | 与 T4 说明一致（高 11 / 中 12 / 低 7） | **high=11  medium=12  low=7** | **high=11  medium=12  low=7** |
| `record_status` | 全部 `published` | **published=30** | **published=30** |
| 每条记录至少一个来源 | 违例数 = 0 | **0** | **0** |
| high 级别缺一手/主流媒体来源 | 违例数 = 0 | **0** | **0** |
| 来源缺 `quote` / 缺 `url` | 0 / 0 | — | **0 / 0**（直接 SQL 复核 54 行） |
| 导入脚本重跑后条数 | 不变（幂等） | **不变**：第二次「新增 0 条，更新 30 条」 | **不变**：第二次「新增 0 条，更新 30 条」，29 / 30 / 54 与置信度分布全部一致 |

线上首次导入的实际输出：

```
[seed] target: node-postgres (DATABASE_URL)
[seed] 数据集：29 家公司 / 30 条记录
[seed] 写入完成：新增 30 条，更新 0 条，拒绝 0 条。
[seed] 库内核对
  company            29
  ai_impact          30
  source             54
  record_status      published=30
  置信度分布         high=11  low=7  medium=12
  无来源记录数       0  (必须为 0)
  high 缺一手来源    0  (必须为 0)
```

导入时另有 **11 条非阻塞提示**（「只有一条来源」），不影响入库，是数据集的已知状态：
`commerzbank`、`uber`、`workday`、`accenture`、`intuit`、`dropbox`、`rackspace`、`microsoft`、
`verizon`、`the-planet-d`、`rws-holdings`。这 11 条都满足「至少一个来源 + 原文引述」的硬门槛，
提示的意思是「两条以上互相独立的来源会让记录更结实」，属于 ZCZ-5 后续可加强项，不是缺陷。

与 `docs/SEED_VERIFICATION.md` §0 的结论逐项一致（29 家公司 / 30 条记录 / 54 条来源 / 高 11 中 12 低 7）。
核对口径与 SQL 见 `DEPLOY.md` §5；上面这些数字是 `npm run db:seed` 结束时自己打印出来的，不是手抄的。

### 校验没有被放宽——这是实测过的

往数据集里注入四种故障，再跑导入（`SEED_FILE=` 指向改坏的副本）：

| 注入的故障 | 结果 |
| --- | --- |
| 删掉第 1 条记录某个来源的 `quote` | 拒绝：`第 1 条 — chegg / 2025-10-27 — 第 1 条来源缺少必填项：原文引述（quote）` |
| 清空某条来源的 `url` | 拒绝并点名是哪条记录的第几条来源 |
| 把某条记录的 `sources` 清成空数组 | 拒绝：`没有任何来源。每条记录至少需要一条来源…` |
| 把 `region` 改成与 `country_code` 矛盾的值 | 拒绝：`region 是派生字段，两者不一致说明其中一个写错了` |

四条全部被按条点名拒绝，且**整批一条都没有写入**（退出码非零）。
脚本不会为了让导入跑通而降低门槛——有问题就改数据集。

---

## 4. 已知问题与未完成项

如实列出，不隐瞒：

- ~~线上首页 500 / 线上没有数据库~~ **已解决**：库已挂、迁移已到 `0004`、种子已导入，
  匿名首页 200 且 30 条（§7、`DEPLOY.md` §2.1）。
- ~~线上跑的是 `main`，而功能都在分支上~~ **已解决**：PR #1 已合并，`main` = `abd3206`。
  因为 `feat/zcz-7-saas-tiering`（`c404f8a`）是 `feat/zcz-5-seed-dataset` 的祖先，
  **一次合并同时带上了 T4/T5/T6/T7**。
- ~~种子导入只对本地 PGlite 跑过~~ **已解决**：已对线上 Neon 实跑并重跑验证幂等（§3）。
- **线上升级仍是 `simulated`，不是 Stripe 测试结账**：Vercel 项目里目前**没有任何 `STRIPE_*` 变量**。
  页面明示「不是一笔真实交易，也没有任何扣款」，`billing_events.source='simulated'`。
  要出真正的测试模式结账页，需按 `DEPLOY.md` §1.2 配 `sk_test_` 等变量——这需要用户授权
  （注册/连接 Stripe 账号不在本任务已有授权范围内），**我没有自行注册任何支付账号，也没有任何支出**。
- **线上库里存在验收用的测试账号**：`acceptance+<时间戳>@example.com`，`plan=pro`，
  来源记为 `simulated.upgrade`。**不是真实付费用户**。看用户表 / 账号数时请按此理解。
- 线上 Neon 处于 **Launch 付费档**（经 Vercel Marketplace 开通），不是免费档；
  不要为了方便新开库或新分支，也不要跑长查询/轮询（计算按 CU-小时计费）。详见 `DEPLOY.md` §8。
- 此前已修复两个会直接影响线上部署的问题：`tw-animate-css` 的 `@import` 无法被 Turbopack 解析导致
  `npm run build` 失败（处理方式是移除该依赖，而非补装）；数据库 TLS 连接未校验证书。详见 `DEPLOY.md` §9。

---

## 5. T5 前台实现约束（可复核）

以下几条来自 ZCZ-6 上与设计方的约定，列在这里是为了**能被独立复核**，而不是只留在任务评论里。
每条都给了核对方式。

### 5.1 构建期不碰数据库

用户在 Vercel 填好 `DATABASE_URL` **之前**的首次构建必须能过。仪表盘最容易为了静态化而引入
build-time 聚合查询，那样首次构建会直接挂。

| 约束 | 核对方式 |
| --- | --- |
| `/`、`/company/[slug]`、`/stats` 均显式 `export const dynamic = "force-dynamic"`，不依赖 Next 的推断 | `grep -rn "force-dynamic" src/app` 应命中这三个路由 |
| `/stats` 的聚合查询在请求期执行 | 不存在 `generateStaticParams` 或模块顶层的查询调用 |
| 未设 `DATABASE_URL` 时 `npm run build` 仍通过 | `env -u DATABASE_URL npm run build` |

### 5.2 颜色一律走 token，不内联字面量

shadcn 的 token 体系（light + dark 双套 + `@theme inline` 映射）继续使用。组件里**不得**出现
内联 hex 或 `text-red-500` 这类字面量——那会绕过 token 体系，dark mode 直接失效。

设计方已在 `globals.css` 的 `:root` 与 `.dark` 中各落一组语义 token（随改名提交 `5d9ae61`），
**实际交付的名字与我先前提的草案不同**，以下是前台在用的这一组：

| 用途 | token | 用在哪 |
| --- | --- | --- |
| 影响类型（字典 §1.5 四个固定值） | `--chart-1` … `--chart-4` | 影响类型徽章的圆点、影响类型图的条 |
| 单系列图表 | `--chart-1` | 年度趋势、行业分布、国家分布 |
| 图表骨架 | `--chart-grid` / `--chart-axis` | 网格发丝线、基线、详情页引文竖线 |
| 置信度（序数，无彩） | `--conf-high` / `--conf-medium` / `--conf-low` | 置信度徽章圆点、置信度分布图 |

槽位比最初估的少：分类色只有影响类型一个维度在吃（4 个固定值），**行业** 21 值 → 前 8 + 「其他」
且全部同色，**国家** 约 250 值 → 按已存储的 `company.region` 聚合（6 项）且全部同色。
所以不需要 `--chart-5..8`，也不存在需要 21 色的图。

核对方式（`verify:public` 的最后两项已经自动化了这条）：

```bash
grep -rnE "#[0-9a-fA-F]{3,8}|(bg|text|border)-(red|green|blue|amber|emerald|rose)-[0-9]" \
  "src/app/(public)" src/components/public src/components/charts   # 零命中
```

范围就是设计规范 §7 说的「页面和图表」：`globals.css` 是 token 的**定义处**（注释里带 hex 是说明值，
不是绕过 token），后台 `/admin` 的成功 / 警示横幅沿用 emerald / amber——规范第 2 条正是把状态色
留给后台表单与错误态的。公开页面一个都不用，这一条也进了自动检查。

### 5.3 配色不得代替平台做出断言

置信度与结局标注的是**真实公司**，配色属于归因表达而非装饰。若「倒闭 + 高置信度」渲染成强红色警示徽章，
页面在视觉上就替平台做出了断言，而这是计划明确禁止的。

- 置信度色阶传达**证据强度**，不是谴责强度：低饱和，靠明度/字重分层；
- `--destructive` 只留给真正的错误态，不参与结局与置信度徽章；
- 详情页来源引述区块在视觉上必须明显是「引用他人」，不是平台自己的结论。

这一口径在数据层已经是结构化的，视觉层只是不能把它拆掉：`impact_type` 与 `attribution_confidence`
刻意无数据库默认值（记录不可能缺人工判断而存在）；`summary` 为转述口径；`source.quote` 要求逐字原文，
译文另存 `quote_translation_zh` 并标注为译文。

### 5.4 图表库：最终没装

**结论：不引入图表库，`recharts` 不装**，这也是设计规范 §5 两条路里设计方倾向的那条。

四张图全是「分类轴上的计数」——年度柱状、行业条形、国家条形、影响类型条形。一根条就是一个
百分比宽度的 `<div>`，实现成本低于接一个库，并且换来三件事：

- **零 bundle 成本**：Vercel Hobby 有体积上限，Recharts 会把 D3 子集拖进来；
- **不需要 `ssr: false` 懒加载**，因而 `/stats` 连一个 client component 都没有（原计划的
  「每张图一个 `"use client"` 叶子」在不装库之后就没有存在理由了，这是对先前那条约定的有意简化）；
- 图表直接在 server component 里渲染，首屏即是最终内容。

实现在 `src/components/charts/bars.tsx`（`HorizontalBars` / `YearColumns` / `StatTable`）。
若将来要做时间刷选、缩放这类真交互，再引库，只动这一个文件。

图表 / 表格切换也因此是一个**链接**（`/stats?view=table`）而不是组件状态：无 JS 可用，
而且这个视图本身可以被分享。表格视图是设计规范 §4.5 的硬要求（也是两个槽位色对浅色底
不足 3:1 的豁免前提），不是加分项。

---

## 6. T5 实测结果（`npm run verify:public`，93/93 通过）

ZCZ-6 的完成标准要求「附上实测的筛选组合与结果条数」。下面整张表是脚本跑出来的，不是手填的：

```bash
npm run build          # verify:public serve 的是生产构建
npm run verify:public  # 自带临时库 .pglite-public-check，跑完即删
```

脚本做了四件事，让这些数字有意义：

1. 用真正的导入脚本（`npm run db:seed`）把 T4 的 `seed/companies.json` 灌进一个**一次性** PGlite 库，
   不碰开发用的 `./.pglite`；
2. **故意把一条记录改成 `archived`**（`workday`，按字典序确定性选取），这是证明可见性规则的唯一方法——
   库里确实存在一条非 `published` 记录，而每个公开界面都必须当它不存在；
3. 期望条数**由数据集在脚本里独立算出**，再跟页面给的数字比。所以「对」的含义是页面与数据集一致，
   而不是页面自己自洽；
4. 先用一个**只迁移、没导数据**的空库跑一遍（见 §6.5），再跑有数据的那一轮。

因此下表的基数是 **29 条可见记录 / 28 家公司 / 53 条来源**（= 数据集 30 / 29 / 54 减去被下架的那一条）。
线上把 30 条全部发布时，相关数字各自 +1。

### 6.1 筛选组合与结果条数（实测）

| 筛选（URL） | 条数 | 首页卡片数 |
| --- | --- | --- |
| `/`（无筛选） | 29 | 12 |
| `?confidence=high` | 11 | 11 |
| `?confidence=medium` | 11 | 11 |
| `?confidence=low` | 7 | 7 |
| `?impactType=ai_cost_cutting_layoff` | 13 | 12 |
| `?impactType=replaced_by_ai_product` | 5 | 5 |
| `?impactType=voluntary_pivot` | 7 | 7 |
| `?impactType=mentioned_in_coverage` | 4 | 4 |
| `?year=2025` | 14 | 12 |
| `?year=2023` | 6 | 6 |
| `?industry=software_saas` | 7 | 7 |
| `?industry=it_services` | 4 | 4 |
| `?country=US` | 17 | 12 |
| `?country=GB` | 2 | 2 |
| `?q=chegg` | 2 | 2 |
| `?year=2025&confidence=high` | 7 | 7 |
| `?industry=software_saas&impactType=ai_cost_cutting_layoff` | 2 | 2 |
| `?country=US&year=2025&confidence=medium` | 1 | 1 |
| 六项全开（关键词 + 年份 + 行业 + 国家 + 影响类型 + 置信度） | 1 | 1 |
| `?industry=bogus&confidence=nope&year=abcd&country=qq&sort=hack&page=-1` | 29（参数被忽略，不报错） | 12 |

> `country=zz` 不在上表里是有原因的：`ZZ` 是字典里「跨国 / 无法归属」的**合法**取值，
> 所以它会筛出 0 条而不是被忽略——这不是 bug。无效取值用的是 `qq`。

### 6.2 分页与排序（实测）

| 项 | 结果 |
| --- | --- |
| 每页条数 / 总页数 | 12 / 3（29 条） |
| 第 1 / 2 / 3 页卡片数 | 12 / 12 / 5 |
| 三页合计去重 | 29（无重复、无遗漏） |
| `?page=99` | 收敛到第 3 页，不报错 |
| `?sort=date_desc` 首条 | 2026-10-27（最新） |
| `?sort=date_asc` 首条 | 2023-04-27（最早） |
| `?sort=name_asc` / `name_desc` 首条 | `accenture` / `verizon` |
| 分页链接 | 带上当前全部筛选与排序（`?country=US&sort=name_asc&page=2`） |

### 6.3 可见性、详情页、仪表盘（实测）

| 项 | 结果 |
| --- | --- |
| 已下架记录出现在榜单任何一页 | 否（榜单共 28 个 slug） |
| `/company/workday`（已下架） | 404 |
| 未知 slug | 404 |
| 28 个公司详情页 | 全部 200 |
| 详情页渲染的来源条数 | **53 = 数据集条数**，无截断 |
| 每条来源的逐字引述 / 媒体名 / 原文链接缺失数 | 0 / 0 / 0 |
| 多事件公司 `chegg` 时间线 | 2 个事件，各自带自己的来源 |
| 仪表盘记录数 / 公司数 / 来源数 | 29 / 28 / 53（与榜单一致） |
| 四张图 + 置信度分布的每一项 | 与数据集逐项相符（含行业前 8 + 「其他」合并 4 条） |
| 表格视图 `?view=table` | 与图表同一组数字 |
| 口径与免责声明 | 「只统计已发布记录」「不构成对任何公司的结论」均在页面上 |

行业并列时的名次由**枚举声明顺序**决定（Postgres 对 enum 列按声明顺序排序，也就是数据字典的顺序），
不是按字母。本数据集有 5 个行业并列 1 条，第 8 个槽位因此是 `translation_localization`——
脚本从 `src/lib/enums.ts` 读出这个顺序来对期望值，不另抄一份。

### 6.4 空数据状态（实测）

完成标准里单列的一条：数据还没导进去时，页面要给空状态而不是报错。这也是线上 `db:migrate` 之后、
首次导入之前的真实状态，所以它是访客可能看到的第一屏。

| 项 | 结果 |
| --- | --- |
| 空库 `/` | 200，条数 0，显示「还没有已发布的记录」并说明草稿 / 待审稿不公开 |
| 空库 `/?confidence=high&year=2025` | 200（带筛选参数也不报错） |
| 空库 `/stats` | 200，显示「还没有已发布的记录，暂无可统计数据」 |
| 空库 `/company/anything` | 404 |

### 6.5 构建期不碰数据库（实测）

```
env -u DATABASE_URL NODE_ENV=production npm run build   # ✓ Compiled successfully
┌ ƒ /
├ ƒ /company/[slug]
└ ƒ /stats
```

三条路由都是动态 `ƒ`，且都显式写了 `export const dynamic = "force-dynamic"`，不依赖 Next 的推断。
§1「构建结果」里的完整路由表要等 T6 / T10 的路由落地后由 T7 重跑一次再更新。

### 6.6 匿名可读（实测命令与输出）

完成标准要求「用无 cookie 的请求实测过榜单 / 详情 / 仪表盘三类页面」。下面是对本地生产构建
（`next start`，库里 30 条全部已发布）直接跑 `curl` 的结果——`curl` 默认不带任何 cookie，
所以这就是匿名访客的视角：

```
### 匿名请求（不带任何 cookie）
/                            -> 200
/?confidence=high&year=2025  -> 200
/company/rws-holdings        -> 200
/stats                       -> 200
/stats?view=table            -> 200
/company/does-not-exist      -> 404
/admin（对照：后台仍然要登录）-> 307

### 匿名响应的内容是否完整
/ : 无 Set-Cookie（匿名请求不会被种 cookie）
/ 榜单总条数            : data-result-total="30"
/ 卡片数                : 12
/ 置信度标签出现次数    : 27
/company/<slug> 来源条数 : 1（= 该记录的全部来源）
/company/<slug> 原文外链 : 1
/company/<slug> 逐字引述块: 1
/stats 图表条数          : 23（4 年 + 4 影响类型 + 8 行业 + 其他 + 3 地区 + 3 置信度）
/stats 免责声明          : 「不构成对任何公司的结论」
```

> 数一数时要先把 RSC flight payload（`<script>` 里那一份转义过的同构树）去掉，否则每个
> `data-*` 属性都会被数两遍。上面的数字是去掉之后的。

公开路由里 `grep -rn "requireSession|redirect(\"/login\")" "src/app/(public)"` 零命中；
唯一读 session 的地方是页眉（决定显示「编辑登录」还是「进入后台」），不决定任何内容是否可见。

### 6.7 数据库读不到时的状态（实测）

把 `DATABASE_URL` 指向一个不存在的库再跑一遍：

```
/               -> 200  ✓ 渲染「数据暂时读取失败」
/company/<slug> -> 200  ✓ 渲染「数据暂时读取失败」
/stats          -> 200  ✓ 渲染「数据暂时读取失败」
误把失败显示成「没有记录」? 否 —— 空状态文案一次都没出现
页眉仍然渲染（session 读失败不拖垮页面）? 是
```

两点说明：

- **为什么不只靠 `error.tsx`**：Next 会先把页面外壳 flush 出去，所以查询抛错是交给**客户端**
  的边界处理的。拿一个坏 `DATABASE_URL` 实测过：HTML 里只有页眉加一个 `__next_error__` 标记，
  没有 JS 的访客看到的是页眉下面一片空白。所以三个页面各自还会在服务端渲染一份同文案的
  `DataUnavailable`，`error.tsx` 留作兜底。两条路都不会退化成空列表，读失败也不会把公司页变成
  404——「没查到」不等于「不存在」。
- **HTTP 状态码是 200 而不是 503**：服务端组件没有设置状态码的接口（只有 route handler /
  middleware 有）。走 `error.tsx` 兜底的那条路是 500。如果验收要求失败必须是 5xx，
  需要改成在 middleware 或 route handler 层做探测，这是一处已知取舍，没有偷偷绕过。


---

## 7. 线上匿名全链路实测（2026-11-03 15:10，`main` = `abd3206`）

这一节是**对线上站点**的实测，不是本地。要点：产品负责人定稿「默认不需要注册也能浏览」，
所以全部请求都用**不带 cookie** 的客户端发出，而且**不只看状态码**——每个数字都与线上库里的
真实数据逐项比对过（库侧用 `DATABASE_URL_UNPOOLED` 直连读，口径见 `DEPLOY.md` §2.4）。

### 7.1 路由可达性（匿名，不跟随重定向）

| 路径 | 状态 | 判定 |
| --- | --- | --- |
| `/` | **200** | 榜单 30 条，`第 1 / 3 页` |
| `/?confidence=high` 等 7 组筛选 | **200** | 条数与 facet 一致，见 §7.2 |
| `/company/<slug>` × **29** | **200 × 29** | 无一例重定向到 `/login` |
| `/stats` | **200** | 30 / 29 / 54 |
| `/pricing` | **200** | — |
| `/login`、`/register` | **200** | — |
| `/subscribe/confirm`、`/subscribe/unsubscribe` | **200** | — |
| `/account`、`/admin` | **307 → `/login`** | 正确：这两个本来就要账号 |
| `/api/export/records`（匿名） | **401** `account_required` | 分档确实在服务端挡 |
| `/api/v1/records`（无 key） | **401** `missing_key` | — |
| `/company/does-not-exist` | **404** | 不存在就是 404，没有降级成空页 |
| `/?page=99`（越界页码） | **200** | 不报错 |

**所有公开响应都没有 `Set-Cookie`。** 这是「浏览不需要注册」的硬证据——
不是「我们没看见登录墙」，而是连会话都不曾被创建。
页面 HTML 里也检索不到「登录后 / 注册后可见 / 需要登录」这类文案（命中数 0）。

### 7.2 筛选条数 vs 库内条数

| 筛选 | 线上返回 | 侧栏 facet / 库内 |
| --- | --- | --- |
| 无筛选 | **30**（3 页：12 + 12 + 6，并集 29 家公司） | 30 |
| `confidence=high` | **11** | 11 |
| `confidence=high&year=2025` | **7** | — |
| `impactType=ai_cost_cutting_layoff` | **13** | 13 |
| `year=2025` | **15** | 15 |
| `industry=software_saas` | **8** | 8 |
| `country=DE` | **3** | 3 |
| `q=uber` | **1** | — |

> **排查提示**：参数名是从页面表单里读出来的，不是猜的——
> `q`、`year`、`industry`、`country`、**`impactType`**（不是 `impact`）、`confidence`、`sort`。
> 名字写错时页面会**照常返回 30 条**，看起来像「筛选没生效」，实际是参数被忽略了。
> 我第一次就用 `impact=` 试，得到 30 条，差点误判成 bug。

### 7.3 详情页是否露出**全部**来源与原文引述

这是数据完整性的核心一条，所以没有抽样，**29 个公司页全部取回**，
再把库里那 54 行 `source` 的 `url` 与 `quote` 逐条拿去页面里找：

```
company pages fetched : 29
non-200 pages         : none
redirected to /login  : none
set-cookie on page    : none
source URLs rendered  : 54/54
verbatim quotes shown : 54/54
```

引述的比对方式是把库里的 `quote` 规范化空白后取前 40 字到页面纯文本里找，
所以匹配上**意味着引述是逐字渲染的**，不是只渲染了媒体名或链接。
（抽查 `chegg` 4 条、`amazon` 3 条、`commerzbank` 1 条时还逐条打印了媒体名与引述开头核对。）

### 7.4 仪表盘

`/stats` 匿名可读，三个总数与库内 `count(*)` 一致：
**已发布记录 30 条 / 涉及公司 29 家 / 引用来源 54 条**。
年度分布 2023:6、2024:3、2025:15、2026:6（合 30）；
影响类型 5 / 13 / 8 / 4（合 30）；置信度分档与 §3 一致。
