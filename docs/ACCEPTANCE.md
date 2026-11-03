# 验收材料（T7 / ZCZ-8）

状态：**进行中 — 8 步里 01/02 已出图（本地），03–08 待前置任务；线上 URL 待 Neon 授权**。

截图统一放 `docs/acceptance/` 下，命名即顺序：`01-register.png`、`02-login.png` …
由 `npm run capture:acceptance` 产出（见 §1），不手工截。

---

## 1. 环境与命令（实际执行的命令，照抄即可）

```bash
npm install
npm run dev                  # 本地：不设 DATABASE_URL，自动走 PGlite
npm run build                # 产物验证
npm run capture:acceptance   # 截图（另开一个终端，dev 跑着的时候执行）
```

迁移与导数据见 `DEPLOY.md` §4 / §5。

### 截图是脚本产出的，不是手工截的

`scripts/capture-acceptance.mjs`（Playwright + Chromium）把全链路跑一遍并逐步截图到
`docs/acceptance/`。这样做的理由：验收材料要能**重跑**——前台改了版、或者要对线上环境再出一份，
重跑一次就行，不用人再点一遍八个步骤。

```bash
BASE_URL=https://<project>.vercel.app npm run capture:acceptance   # 对线上出一份
```

每次运行注册一个带时间戳的新账号（`acceptance+<yyyymmddhhmmss>@example.com`），
所以对同一个库可以反复执行，不会撞已存在的邮箱。脚本里同时列着尚未实现的 03–08 步，
每次运行会把「还缺哪几张、各自阻塞于谁」打印出来，避免文档与实际产出悄悄脱节。

浏览器安装：`npx playwright install --with-deps chromium`。

> **无 root 的沙箱里要多做两步**（本次就是这种环境，记下来免得下次重趟一遍）：
> 1. `--with-deps` 会调 sudo 而失败，改用 `npx playwright install chromium`，再把缺的 11 个
>    系统库用 `apt-get download` + `dpkg-deb -x` 解到用户目录，运行时带 `LD_LIBRARY_PATH`；
> 2. **装中文字体**。界面全是中文，而最小镜像通常只有 DejaVu，**不装 CJK 字体截出来整页都是豆腐块**
>    （第一次就是这样）。装 `fonts-noto-cjk` 到 `~/.local/share/fonts`，并用 `FONTCONFIG_FILE`
>    指一份把该目录 `<dir>` 进去的 `fonts.conf`——只把字体文件放进去、不改 fontconfig 配置是不生效的。

| 项 | 值 |
| --- | --- |
| 本地地址 | http://localhost:3000 |
| 代码仓库 | `zczy318-products/ai-shutdown-tracker`（私有，默认分支 `main`） |
| 线上地址 | 待填（首次部署后） |
| Node 版本 | 本地验证用 v24.22.2；Vercel 用其 Next.js 默认 Node |
| 数据库 | 本地 PGlite / 线上 Neon 免费档 |
| Stripe | 测试模式，`sk_test_` / `pk_test_`，不接真实收款 |

### 构建结果（最近一次本地验证）

按 Vercel 首次构建的条件验证，即 `NODE_ENV=production` 且**不设** `DATABASE_URL`：

```bash
env -u DATABASE_URL NODE_ENV=production npm run build
```

```
✓ Compiled successfully in 257ms
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin
├ ƒ /login
└ ƒ /register
```

读库的路由全部是动态 `ƒ`，构建期零查询——这是 Vercel 首次构建（用户还没填环境变量）能过的前提，
加新页面时要守住，详见 `DEPLOY.md` §6.3。路由数会随 T5/T6 增加，验收前需重跑并更新这段输出。

---

## 2. 全链路步骤（逐步截图）

| # | 步骤 | 截图要体现什么 | 状态 |
| --- | --- | --- | --- |
| 01 | 注册 | 填写表单 + 注册成功后的落地页 | ✅ `01-register.png` / `01b-register-success.png` |
| 02 | 登录 | 登录表单 + 登录态下的用户标识 | ✅ `02-login.png` / `02b-signed-in-home.png` |
| 03 | 浏览榜单 | 列表有数据，条数与 §3 对得上 | 阻塞（T5） |
| 04 | 筛选 | 筛选条件生效前后的对比，URL 上带筛选参数 | 阻塞（T5） |
| 05 | 公司详情 | **必须露出来源链接与原文引述**，以及置信度分档 | 阻塞（T5） |
| 06 | 统计仪表盘 | 图表 + 置信度分布 | 阻塞（T5） |
| 07 | 升级到付费 | Stripe 测试模式的 Checkout 页面，能看出是 test mode | 阻塞（T6） |
| 08 | 导出 CSV | 导出动作 + 打开后的 CSV 内容（含表头） | 阻塞（T6） |

免费档与付费档的差异也要各截一张（同一个页面在两种档位下的对照），否则看不出分档真的生效。

**01/02 现有截图是本地（PGlite，`NODE_ENV=development`）跑出来的**，不是线上环境——
`01b` 右下角的「运行环境」卡片如实写着 `PGlite (.pglite)` / `development`。
线上部署完成后需要把 `BASE_URL` 指向线上再出一份覆盖，届时这一行删掉。

---

## 3. 数据库核对（导入后填写）

| 项 | 期望 | 实测 |
| --- | --- | --- |
| 记录总条数 | ≥ 30（若 T4 实际交付不足 30，按实际条数并在此注明原因） | 待填 |
| 每条记录至少一个来源 | 违例数 = 0 | 待填 |
| 置信度分布 | 与 T4 说明一致 | 待填 |
| 导入脚本重跑后条数 | 不变（幂等） | 待填 |

核对用的 SQL 见 `DEPLOY.md` §5。

---

## 4. 已知问题与未完成项

如实列出，不隐瞒：

- **T4 数据集、T5 前台、T6 SaaS 层尚未合并**，故步骤 03–08 的截图无法产出；截图工具链本身已经跑通，
  这几个页面一上线即可直接补拍；
- **01/02 的截图来自本地 PGlite，不是线上环境**（见 §2 末尾），线上部署后要重出一份；
- **种子导入脚本尚未落地**，依赖 T3 领域表 + T4 数据集。`src/db/schema.ts` 里的 `company` /
  `ai_impact` / `source` 三表已随 T3 写出（含 `drizzle/0001`、`0002` 迁移），但**尚未提交**，
  且查询层 `src/lib/records/store.ts` 还不存在，脚本暂无可写入的稳定目标；
- **GitHub 已接通**，仓库建好且首次推送完成；**Neon 授权仍未批准**，故线上库不存在，迁移与种子导入
  都无法执行，线上 URL 暂缺（授权状态见 `DEPLOY.md` §8）；
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

分类色/序数色由设计方在 `globals.css` 的 `:root` 与 `.dark` 中各补一组语义 token，本侧只引用名字：

| 用途 | 槽位 |
| --- | --- |
| 置信度（序数，含 `-foreground`） | `--confidence-high` / `-medium` / `-low` |
| 影响类型（字典 §1.5 四个固定值） | `--impact-1..4` |
| 图表分类色通用序列 | `--chart-1..8` |

分类色只需 8 槽，是因为聚合口径把基数压住了：**行业** 21 值 → Top 7 + 「其他」= 8 项；
**国家** 约 250 值 → 按已存储的 `company.region` 聚合 = 6 项；结局 7 值、影响类型 4 值同样在 8 以内。
不存在需要 21 色的图。

核对方式：`grep -rnE "#[0-9a-fA-F]{6}|text-(red|green|blue|amber)-[0-9]" src/components src/app` 应为零命中。

### 5.3 配色不得代替平台做出断言

置信度与结局标注的是**真实公司**，配色属于归因表达而非装饰。若「倒闭 + 高置信度」渲染成强红色警示徽章，
页面在视觉上就替平台做出了断言，而这是计划明确禁止的。

- 置信度色阶传达**证据强度**，不是谴责强度：低饱和，靠明度/字重分层；
- `--destructive` 只留给真正的错误态，不参与结局与置信度徽章；
- 详情页来源引述区块在视觉上必须明显是「引用他人」，不是平台自己的结论。

这一口径在数据层已经是结构化的，视觉层只是不能把它拆掉：`impact_type` 与 `attribution_confidence`
刻意无数据库默认值（记录不可能缺人工判断而存在）；`summary` 为转述口径；`source.quote` 要求逐字原文，
译文另存 `quote_translation_zh` 并标注为译文。

### 5.4 图表库按需引入

`/stats` 页面本身保持 server component，每张图各自是一个 `"use client"` 叶子组件，使图表库只进
图表 chunk、不被拖入首屏（Vercel Hobby 有 bundle 体积限制）。换库只动叶子组件。

> 图表库选型与 token 取值待设计规范确认；截至本次更新 `package.json` 中尚未安装 `recharts`。
