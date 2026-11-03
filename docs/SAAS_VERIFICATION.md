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

用户 14:54 定稿：**只做一层收费，9.9 美金包月**。此前代码写的是 `￥49 / 月`，
币种与金额都不对。

| | 改前 | 改后 |
| --- | --- | --- |
| 免费档 | `￥0` | `US$0` |
| 专业版 | `￥49 / 月` | `US$9.90 / 月` |

**代码侧的改价由 ZCZ-8 那条线落地（PR #4，`cd598e6`），不是本任务改的** ——
两边并行跑，结论一致（`priceZh` 改名 `priceLabel`、一页只用一种货币符号、
free 档保留，因为 free 是不收费的账号而不是第二个价位）。

本任务补的是 PR #4 **没有**的那部分：改价没有任何断言盯着。价格是一个
谁都能顺手编辑的字符串，改错了既不会编译失败也不会报错，只会安静地写错一个数。

### 8.1 实测（`npm run verify:saas`，本地模拟升级模式，55 项全部 PASS）

```
PASS  定价页渲染出 US$9.90 / 月
PASS  定价页不再出现人民币符号或旧价格 — 无
PASS  定价页只有一个付费价位 — US$9.90 | US$0
```

三条的分工：

- 第一条锁该出现的数字；
- 第二条断言**不该**出现的东西。改价最常见的失败不是忘了改，而是改了一处、
  另一处还留着 `￥`，于是同一页同时写着两个货币，没人知道到底收多少；
- 第三条把页面上出现过的美元金额去重，要求恰好是 `{US$0, US$9.90}`。
  哪天有人加回第二个付费价位，这条会红——「只做一层收费」从此有东西盯着，
  而不是只存在于一条聊天记录里。

页面上也把这件事说成了一句话，而不是让人从两张卡片自己推断：
「全站只有一个付费档：专业版 US$9.90 / 月，按月订阅、以美元计价。免费账号不收费，也不是第二个价位。」

### 8.2 代码管不到的那一处

金额在 Stripe 那侧是 `STRIPE_PRICE_ID_PRO` 里的一个 price id，**不是一个数字**，
所以本仓库无法校验 Stripe 上那个 price 到底是多少钱。将来真去建测试价时，
建错了的表现是页面一个价、结账页另一个价。这条已经写进 `DEPLOY.md`
的环境变量表里，就在那个变量旁边——而不是留在这份文档里等人来读。

### 8.3 线上

价格是页面文案，不是数据库里的行，所以部署即生效，没有数据迁移。
