# T6 / ZCZ-7 分档与导出 — 实测记录

实测时间：2026-11-03。被测版本：本提交。

本文记录 ZCZ-7 完成标准里要求「附实测步骤与结果」的三件事：分档不挡阅读、
升级解锁导出、API key 的生成 / 调用 / 吊销。全部由 `scripts/verify-saas-flow.mjs`
驱动真实 HTTP 完成，不是对内部函数的单元测试。

---

## 0. 结论先放这里

| 要求 | 结果 |
| --- | --- |
| 无 cookie 的请求能完整读到榜单 / 详情 / 仪表盘 | 通过 |
| free 账号用不了全量导出，且不是 403 白屏 | 通过（浏览器 303 → 定价页；脚本 402 + JSON 说明） |
| 升级后导出解锁 | 通过（两种模式都测了） |
| API key 生成 → 调通 → 吊销后失败 | 通过 |
| `npm run build` / `npm run typecheck` | 通过 |
| 真实收款 | **没有**。live key 被代码硬拒；测试中从未发起过任何真实支付 |

两种计费模式各跑了一遍完整脚本：

- **Stripe 测试模式链路**（配了 `STRIPE_WEBHOOK_SECRET`）：51 项全部 PASS；
- **本地模拟升级**（什么都不配）：49 项全部 PASS（少掉的两项是 webhook 专有的）。

> 上面两个数字是 T6 当时的项数。脚本之后又加过断言，**2026-11-03 改价后**同一台机器、
> 同一个模拟升级模式重跑是 **55 项全部 PASS**，见 §8.1。

---

## 1. 怎么复现

```bash
npm run db:migrate          # 新增 0003_saas_plans_api_keys
npm run db:seed             # 需要库里有已发布记录，导出才有东西可导
npm run build && npm start  # 或 npm run dev
npm run verify:saas         # 默认打 http://127.0.0.1:3000
```

想顺带跑通 webhook 这一段，在启动服务器**之前**往 `.env.local` 里放一个
本地用的端点密钥（随便一串 `whsec_…`，不需要 Stripe 账号）：

```bash
echo 'STRIPE_WEBHOOK_SECRET=whsec_local_verification_only' >> .env.local
```

脚本检测到这个变量，就会改走第 4 节的 webhook 路径。

---

## 2. 匿名访客不需要账号（ZCZ-7 §0 的硬要求）

```
PASS  匿名请求首页返回 200 — status=200
PASS  首页没有把内容藏到登录后面
PASS  匿名可以打开定价页 — status=200
PASS  定价页如实写明浏览不需要账号
PASS  定价表里有匿名访客这一列
...
PASS  匿名首页仍然 200 — status=200          ← 升级流程跑完之后再测一次
PASS  匿名首页没有出现登录墙文案
```

定价页的第一句话就是「**浏览全部内容不需要账号**」，对照表第一列是「匿名访客」，
前三行（榜单筛选 / 全部来源与引述 / 仪表盘）在这一列全是 ✓。

---

## 3. free 与匿名点导出：给说法，不给白屏

同一个 URL（`GET /api/export/records`）按**谁在问**决定怎么拒绝：

| 调用方 | 匿名 | free 账号 |
| --- | --- | --- |
| 浏览器（`Accept: text/html`） | 303 → `/pricing?from=export&reason=anonymous` | 303 → `/pricing?from=export&reason=upgrade` |
| 脚本（`Accept: */*`） | 401 + JSON | 402 + JSON |

```
PASS  浏览器请求被 303 引导到定价页，而不是 403 — status=303 location=…/pricing?from=export&reason=anonymous
PASS  落地页解释了发生了什么
PASS  落地页同时说明阅读不受影响
PASS  脚本请求拿到 401 而不是重定向 — status=401
PASS  401 的 JSON 里有可读的中文说明
PASS  401 的 JSON 里给了升级入口
PASS  浏览器请求被引导到定价页 — status=303 location=…reason=upgrade
PASS  脚本请求拿到 402（需要付费），不是 403 — status=402
PASS  402 说明了当前是免费档
PASS  402 没有谎称内容看不到
```

脚本那一侧故意**不**重定向：`curl` 跟着 303 走，只会把一张 HTML 定价页存成
`records.csv`，那比报错更糟。

落地提示的原文（`reason=anonymous`）：

> 你点的是「全量 CSV 导出」，它需要一个专业版账号。
> 但请注意：榜单、搜索、全部筛选、详情页里的**每一条**来源链接与原文引述、
> 以及统计仪表盘，都不需要账号也能看，也不会被截断或打码。
> 导出只是把整个数据集一次性拿走的快捷方式。

---

## 4. 升级：free → pro

### 4a. Stripe 测试模式链路（checkout → webhook → 升级 plan）

没有 Stripe 账号，所以这一段是这样打通的：配一个本地端点密钥，然后用**正确签名的
合成事件**打真实的 `/api/billing/webhook`。跑的是生产代码里同一份签名校验、同一份
幂等账本、同一份升级逻辑 —— 唯一没经过的是 Stripe 自己的服务器。

```
PASS  账户页暴露了账号 id 供 webhook 测试使用 — a522848c-a14c-4d8c-a0da-82f57f8da958
PASS  签名错误的 webhook 被拒绝 — status=400
PASS  签名正确的 webhook 被接受 — status=200
PASS  webhook 把账号升级为 pro — {"received":true,"handled":true,"detail":"账号 … 已升级为 pro。"}
PASS  重复投递的同一事件被幂等忽略 — {"received":true,"handled":false,"detail":"未应用：duplicate。"}
PASS  账户页现在显示专业版
PASS  账户页如实标注这不是真实付款
```

注意第三项和第五项：**签名错的事件进不了升级代码**，**同一个事件投递两次只升级一次**。
Stripe 会一直重投直到拿到 2xx，所以重复投递是常态而不是异常。

真正配上 `sk_test_…` 和 `STRIPE_PRICE_ID_PRO` 之后，缺的只有 Stripe 托管的那张
结账页；本地这一侧的代码不需要再改。

### 4b. 本地模拟升级（默认，什么都不用配）

```
PASS  定价页说明当前是模拟升级
PASS  模拟升级提交成功 — status=303
PASS  账户页现在显示专业版
PASS  账户页如实标注这不是真实付款
```

账户页会把这次升级标成「本地模拟升级」，并在套餐卡片里写明
「没有产生任何真实费用」；`billing_events` 里也记成 `simulated.upgrade`。
演示之后没人会把它误当成一笔收入。

### 4c. live key 被硬拒（spending 约束）

拿一个假的 `sk_live_…` 启动服务器：

```
$ curl -s http://127.0.0.1:3317/pricing | grep 'live 模式密钥'
live 模式密钥。本项目只允许测试模式（sk_test_…），拒绝启动结账流程。
请换成测试密钥，或删除该变量以使用本地模拟升级。

$ curl -s -X POST http://127.0.0.1:3317/api/billing/webhook -d '{}'
{"error":"billing_misconfigured"}            status=500
```

升级按钮直接不渲染，webhook 也拒绝处理。这不是一行警告日志，是启动结账前的硬失败
—— 判错的代价是按钮坏掉，判漏的代价是从别人卡里扣到钱。

---

## 5. pro 导出完整 CSV

```
PASS  导出返回 200 — status=200
PASS  Content-Type 是 CSV — text/csv; charset=utf-8
PASS  带 attachment 文件名 — attachment; filename="rest-in-prompts-records-2026-11-03.csv"
PASS  文件带 UTF-8 BOM（Excel 不乱码） — 前三字节 ef bb bf
PASS  表头含 source_url
PASS  表头含 source_quote
PASS  表头含 attribution_confidence
      导出 30 条记录 / 54 行来源
PASS  导出不是空的 — 54 行
PASS  行里有真实的 http 来源链接
```

**形状是「一行一条来源」**，公司与事件字段重复，附 `source_index` / `source_count`
以便还原成事件视角。把多条来源塞进一个单元格会让这个数据集存在的理由（URL 与逐字引述）
在表格里没法用，而引述里本来就有逗号和换行，塞起来还正是转义出 bug 的地方。

每一行都带 `attribution_confidence`。没有评级的导出会让「低」置信度的记录一出站
就被当成既定事实 —— 那正是整个项目要避免的事。

引述单元格里以 `=` `+` `-` `@` 开头的内容会被前置一个单引号：这些文本是从公开网页
上抄来的，Excel / Sheets 会把它们当公式执行。

---

## 6. API key 三步

```
PASS  生成 API key 成功 — rip_test_7G7zunX…
PASS  列表里出现这个 key
PASS  列表只显示前缀，不回显明文
PASS  列表提供吊销按钮 — e0300146-9d53-4084-b398-b1664bec9958
PASS  用 key 调只读接口返回 200 — status=200
PASS  返回了记录 — total=30
PASS  每条记录都带归因置信度
PASS  每条记录都带来源与原文引述
PASS  同一个 key 也能取 CSV — status=200
PASS  接口是只读的：POST 被拒 — status=405
PASS  吊销提交成功 — status=200
PASS  列表标记为已吊销
PASS  吊销后调用返回 401 — status=401
PASS  401 说明了是被吊销 — {"error":"revoked_key","message":"该 API key 已于 … 吊销，不再可用。"}
PASS  吊销后也不能再导出 CSV — status=401
```

手动复现：

```bash
# 1. 在 /account 生成，明文只显示一次
curl -H "Authorization: Bearer rip_test_…" "$BASE/api/v1/records?limit=3"
# 2. 同一个 key 也能取 CSV
curl -H "X-API-Key: rip_test_…" "$BASE/api/export/records" -o records.csv
# 3. 在 /account 点「吊销」，再调一次
curl -i -H "Authorization: Bearer rip_test_…" "$BASE/api/v1/records"
# HTTP/1.1 401 … {"error":"revoked_key", …}
```

几点设计上的取舍：

- 库里只存 key 的 SHA-256，明文只在生成那一次出现。页面把这句话写在旁边，
  而不是等用户自己发现。
- 鉴权时**每次都查套餐**，不是签发时查一次。订阅结束后已签发的 key 立刻停用，
  否则「取消订阅」就等于没取消。
- 吊销是打时间戳而不是删行，所以「这个 key 什么时候被吊销的」答得上来。
- 被吊销的 key 和不存在的 key 返回不同的说明。这不泄露任何信息（调用方本来就持有
  这个 key），但把最常见的那个问题「我的脚本为什么突然不工作了」变成了自助答案。

---

## 7. 没做的事

- 没有注册任何第三方账号，没有产生任何真实支出；
- 没有配置 live key，也没有发起过真实支付；
- 没有把任何公开阅读内容挪到账号背后。

要真正接上 Stripe 测试环境（哪怕只是测试模式）需要一个 Stripe 账号，
按 ZCZ-7 的约束应由 Master PM 向用户申请授权卡后再做。在那之前，
上面 4a 的自签 webhook 已经把本地这一侧的链路验到了尽头。

---

## 8. 定价：USD 9.90 / 月（2026-11-03 追加，含三条锁价断言）

> **现价见 §9**（2026-11-03 追加了年付）。本节记录的是月付那一次改价，
> 下表「改前」那一列是**已废弃的旧定价，早已不是现价**，留在这里只为说明当时改了什么。

用户 14:54 定稿：**只做一层收费，9.9 美金包月**。此前代码写的是 CNY 49 / 月，
币种与金额都不对。

| | 改前（已废弃，不是现价） | 改后 |
| --- | --- | --- |
| 免费档 | 旧：CNY 0 | `US$0` |
| 专业版 | 旧：CNY 49 / 月 | `US$9.90 / 月` |

**代码侧的改价由 ZCZ-8 那条线落地（PR #4，`cd598e6`），不是本任务改的** ——
两边并行跑，结论一致（`priceZh` 改名 `priceLabel`、一页只用一种货币符号、
free 档保留，因为 free 是不收费的账号而不是第二个价位）。

本任务补的是 PR #4 **没有**的那部分：改价没有任何断言盯着。价格是一个
谁都能顺手编辑的字符串，改错了既不会编译失败也不会报错，只会安静地写错一个数。

### 8.1 实测（`npm run verify:saas`，本地模拟升级模式）

当时加的三条断言是：渲染出 `US$9.90 / 月`；页面上不再有人民币符号或旧价格；
页面上的美元金额去重后恰好是 `{US$0, US$9.90}`。

三条的分工：

- 第一条锁该出现的数字；
- 第二条断言**不该**出现的东西。改价最常见的失败不是忘了改，而是改了一处、
  另一处还留着旧币种，于是同一页同时写着两个货币，没人知道到底收多少；
- 第三条把页面上出现过的美元金额去重，要求恰好是那两个。
  哪天有人加回第二个付费**价位**，这条会红——「只做一层收费」从此有东西盯着，
  而不是只存在于一条聊天记录里。

> ZCZ-14 加年付后，第三条的允许集合从 `{US$0, US$9.90}` 扩成五个数
> （见 §9.2）：多出来的三个是同一个档位的年付总价与它的两个派生展示值，
> 不是第二个价位。断言仍然是「逐个列死」，不是放宽成「随便几个」。

### 8.2 代码管不到的那一处

金额在 Stripe 那侧是 price id 变量（现在是 `STRIPE_PRICE_ID_PRO_MONTHLY` /
`…_ANNUAL`，`STRIPE_PRICE_ID_PRO` 保留为月付别名）里的一个 price id，**不是一个数字**，
所以本仓库无法校验 Stripe 上那个 price 到底是多少钱。将来真去建测试价时，
建错了的表现是页面一个价、结账页另一个价。这条已经写进 `DEPLOY.md`
的环境变量表里，就在那个变量旁边——而不是留在这份文档里等人来读。

### 8.3 线上实测（2026-11-03，`https://restinprompts.vercel.app`）

价格是页面文案，不是数据库里的行，所以部署即生效，没有数据迁移。合并进 `main`
触发部署后，匿名 `curl` 实测线上：

```
$ curl -s https://restinprompts.vercel.app/pricing | grep -o 'US\$[0-9.]*' | sort | uniq -c
      2 US$0
      4 US$9.90

$ curl -s https://restinprompts.vercel.app/pricing | grep -c '￥\|¥'
0
```

`US$9.90` 四次 = 两张卡片各一次 + 对照段落里那句话两次（`<strong>` 内外各一段文本）；
人民币符号线上**零命中**。`/pricing` 返回 200。

> 这是**线上**的数字，不是本地构建的数字。改价这件事的完成标准是「用户打开页面
> 看到 9.90 美元」，而不是「仓库里写着 9.90 美元」——两者之间隔着一次部署。

---

## 9. 年付：一个档，两种计费周期（ZCZ-14，2026-11-03）

用户 15:24 定稿：**「定价就 9.9 美金包月，包年 8 折扣，Stripe 支付」**。
月付不变，本节只记年付这一个计费周期。

### 9.1 四个数，以及为什么它们不可能互相矛盾

| 项 | 值 | 怎么来的 |
| --- | --- | --- |
| 月付 | **US$9.90 / 月**（990 分） | 唯一硬编码的金额 |
| 年付总价 | **US$95.04 / 年**（9504 分） | `990 × 12 × 4/5`，向下取整（这里整除） |
| 折合月价 | **US$7.92 / 月**（792 分） | `9504 ÷ 12`，整除无余数 |
| 省 | **US$23.76 / 年**（2376 分） | `11880 − 9504` |

`src/lib/pricing.ts` 里只有**两个输入**：`MONTHLY_CENTS = 990` 和折扣比
`ANNUAL_DISCOUNT_NUM / DEN = 4 / 5`。年付金额、折合月价、省多少、以及「8 折」
这四个字本身，全部由它们推导。页面上没有任何一处键入过价格。

为什么是一个**比**而不是第二个金额：两个独立的数字，改价时改一个忘一个，
页面就会承诺一个它不给的折扣；一个比值让这件事在算术上做不到。

那条不许弯的不变量，在同一个文件里做成了 import 时就跑的断言：

```
ANNUAL_CENTS * 5 <= MONTHLY_CENTS * 12 * 4      // 只许向下取整，禁止向上
```

写成交叉相乘的整数比较，而不是浮点除法——浮点除法会放过一个**比折后价多一分**的年价。
`src/db/schema.ts` 为了拿 `billing_interval` 的枚举值会 import 这个模块，
所以断言失败时 `npm run build` 和 `npm run db:generate` 直接红，不只是 code review 里有人看见。

页面写着「8 折」，收的钱就不能多于 8 折：向上取整到 `$95.99` / `$96` 会让那句话变成假话，
所以取整只允许向下。另外两个派生展示值（折合月价、「相当于几个月」）也按
**不会替我们吹牛**的方向取整：折合月价向上（不少报每月实付），月数向下（不多报省了多少），
取整不精确时标签自动带「约」。今天四个数全部整除，所以没有「约」。

### 9.2 实测（`npm run verify:saas`）

同一台机器、同一份代码，两种配置各跑一遍，全绿：

| 配置 | 结果 |
| --- | --- |
| 本地模拟升级（什么都不配） | **140 项 PASS，0 FAIL** |
| 再加一个本地 `STRIPE_WEBHOOK_SECRET=whsec_local_zcz14_test` | **150 项 PASS，0 FAIL**（多的 10 项是 webhook 专有） |

定价页那一段（匿名请求，无需任何交互）：

```
-- 0b. 月付与年付的四个数（匿名、无需交互） --
PASS  渲染出月付 US$9.90 / 月
PASS  渲染出年付总价 US$95.04 / 年
PASS  渲染出折合月价 US$7.92 / 月
PASS  渲染出省下的金额 US$23.76
PASS  写明了折扣幅度（8 折）
PASS  全页没有人民币符号，也没有旧价格 — 无
PASS  页面上的 USD 金额只有这五个，没有第二套价格 — US$0 | US$23.76 | US$7.92 | US$9.90 | US$95.04
PASS  没有退款、按比例补差价或中途转周期的承诺 — 无
```

`?interval=` 走 URL，服务端直出：

```
-- 0c. ?interval= 走 URL，服务端直出，其他 query 不丢 --
PASS  匿名直接访问 ?interval=annual 返回 200 — status=200
PASS  年付这一项被标记为当前选择（aria-current）
PASS  结账按钮买的是按年
PASS  ?interval=monthly 时当前选择是按月
PASS  无法识别的 interval 不报错，退回按月展示 — status=200
PASS  切到年付的链接保留了其他 query — /pricing?reason=upgrade&from=account&interval=annual
PASS  带 query 时落地提示仍然显示
```

### 9.3 「年付不多给权限」是断言，不是承诺

`ENTITLEMENTS` 仍然只以 `Plan` 为键，`can()` 的签名里**没有** interval 参数
（`src/lib/plans.ts`）。但这条不靠注释保证：脚本把 free → pro(按月) 和
free → pro(按年) 两条链路各跑完整一遍，收集双方解锁到的一切，**逐项比对**：

```
-- 8. 年付与月付解锁的权限逐项相同 --
PASS  两条链路都跑完了，有东西可比 — 15 项
PASS  按月与按年的 csvHeader 相同       （38 列，逐字符相同）
PASS  按月与按年的 csvRows 相同 — monthly=56 annual=56
PASS  按月与按年的 csvRecordCount 相同 — monthly="31" annual="31"
PASS  按月与按年的 apiTotal 相同 — monthly=31 annual=31
PASS  按月与按年的 apiRecordKeys 相同   （15 个字段，排序后相同）
PASS  按月与按年的 apiSourceKeys 相同   （11 个字段，排序后相同）
PASS  按月与按年的 csvByKeyStatus 相同 — monthly=200 annual=200
PASS  按月与按年的 writeStatus 相同 — monthly=405 annual=405
PASS  按月与按年的 revokedApiStatus 相同 — monthly=401 annual=401
PASS  按月与按年的 downgradedExportStatus 相同 — monthly=402 annual=402
PASS  但两条链路的计费周期确实不同（对照） — monthly vs annual
```

最后一条是对照组：如果连它都相同，上面那一串就是在拿一条链路跟自己比。

每条链路都走完了 free → pro → 导出 + API key → **降级回 free → 两者失效**。
降级那一步前会再签发一个**没被吊销**的 key，否则「降级让 key 失效」会跟
「吊销让 key 失效」混在一起，证明不了前者：

```
PASS  [annual] 降级后回到免费档 — data-plan=free
PASS  [annual] 降级后 plan_interval 被清空 — data-plan-interval=
PASS  [annual] 降级后导出失效（402） — status=402
PASS  [annual] 降级后未吊销的 key 也失效（402 plan_required）
```

### 9.4 周期存的是语义，不是 price id

可核查的位置：

| 在哪 | 是什么 |
| --- | --- |
| `drizzle/0005_billing_interval.sql` | `billing_interval` 枚举（`monthly` / `annual`）、`users.plan_interval`、`billing_events.interval_after`、CHECK `users_plan_interval_matches_plan`，以及手工插入的回填 |
| `src/db/schema.ts` | 两列的定义与约束；注释写明为什么不解析 price id |
| `src/lib/billing/store.ts` | `applyPlanChange` 是唯一写入口；`PlanChange` 是可辨识联合——`plan: "pro"` **必须**带 interval，`plan: "free"` 不许带 |
| `src/lib/billing/stripe.ts` | checkout session 上带 `metadata[billing_interval]` 与 `subscription_data[metadata][billing_interval]` |
| `src/app/api/billing/webhook/route.ts` | 从 event metadata 读回；读不到就 `handled: false` |

全仓没有任何地方按金额或 price id 字符串判断权限或展示——权限只问
`can(plan, …)`，展示只读 `users.plan_interval`：

```bash
$ grep -rn 'price_\|priceId' src/ \
    | grep -v 'billing/config.ts\|billing/stripe.ts\|pricing/actions.ts\|pricing/page.tsx'
src/app/api/billing/webhook/route.ts:94:  * that parses `price_…`, and getting it wrong means …
src/db/schema.ts:95:  * mode for live mode is one such change — so `startsWith("price_annual")` or …
```

剩下这两处命中都在**注释里**，内容正好是「不要这么做」的理由本身。
除此之外 price id 只出现在「选哪个 price 去结账」这一件事上：
`config.ts`（读环境变量）、`stripe.ts`（填进 line item）、
`actions.ts`（按 interval 取对应的那个）、`page.tsx`（判断某个周期是否可结账）。

库里的约束是真的会拒：

```
REJECTED  pro 但 plan_interval 为空
REJECTED  free 但带了 plan_interval
NO-ERROR  pro + annual（应当允许）
REJECTED  计费周期写了枚举外的值
```

### 9.5 读不到周期就不要猜

这是本任务最关键的一条。webhook 拿不到 `metadata.billing_interval` 时，
**不默认成月付**、也不去看 price id 或金额——猜一个值和「解析 price id」是同一个病。
它返回 `handled: false`，把原因说清楚，账号一个字段都不动：

```
-- 9. webhook（本地 whsec_… + 自签事件） --
PASS  签名错误的 webhook 被拒绝 — status=400
PASS  签名正确但缺 interval 的事件返回 200 — status=200
PASS  缺 interval 的事件没有生效 — {"received":true,"handled":false,
      "detail":"事件的 metadata.billing_interval 缺失，套餐未变更。这里不从 price id
      或金额反推计费周期——请检查创建 checkout session 时是否带上了
      metadata[billing_interval]。"}
PASS  缺 interval 的事件没有把账号改成 pro — data-plan=free data-plan-interval=
PASS  带 interval 的事件被接受 — status=200
PASS  带 interval 的事件生效 — {"handled":true,"detail":"账号 a914a6e9… 已升级为 pro（按年）。"}
PASS  webhook 写进库的是事件里的周期（annual） — data-plan=pro data-plan-interval=annual
PASS  重复投递的同一事件被幂等忽略 — {"handled":false,"detail":"未应用：duplicate。"}
```

`startUpgrade` 那一侧同理：interval 以表单字段传入、按白名单校验，
非法值**直接报错**而不是静默回落到月付（按错的周期扣款比报错更糟）。

### 9.6 idempotency-key 到底保证了什么

idempotency key 现在是 `checkout:<userId>:<interval>:<priceId>`。
它保证的是：**同一个按钮点两次、或网络错误后重试，复用同一个 Checkout Session，
不会开出第二个**。

它**不保证**一个账号不会有两个订阅——两个周期是两个 key，本来就是两个 session。
拦住这件事的是 `startUpgrade` 里「已经是 pro 就直接返回」那一条，加上 webhook 的幂等台账。
这两条之后还剩一个窗口，已写在代码注释里而不是假装不存在：一个 free 账号可以先开月付
checkout、再开年付 checkout，并在任何 webhook 落地之前把两个都付掉（整个过程里 `plan`
一直是 `free`）。要真正关掉它需要把 pending session 记下来（live 模式下还要调 cancel），
超出 ZCZ-14 的范围，而且测试模式也演示不了。测试模式下的代价是 Stripe 后台多一个待取消的
测试订阅——没有真钱。**这一条是已知残留，不是已解决。**

### 9.7 本任务没做的事

- **没有注册真实 Stripe 账号，没有接真实收款，没有花钱。** `config.ts` 里拒绝
  `sk_live_` / `rk_live_` 那道闸原样保留；是否上真实收款是 Team Leader 的放行节点。
- 没有做退款、proration、年付转月付——所以定价页上**一个字都没提**它们。
  写不出能兑现的承诺就不写。
- 没有碰访问模型：「浏览全部内容不需要账号」那段、匿名访客那一列、
  「注册只是为了成为付费主体」那句，脚本每次都回归一遍，全部保留。
