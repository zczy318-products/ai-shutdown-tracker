# 邮件订阅（T10 / ZCZ-11）

匿名订阅 + 双重确认 + 一键退订。**订阅不走账号系统**：订阅者只给一个邮箱，没有密码、没有
用户记录、不需要登录。

> 用户 2026-11-03 定稿：**先只收集订阅，暂不发信。** 这不是临时兜底，而是本功能当前的最终
> 形态——邮件适配器只有一个 `log` 驱动，把邮件写进服务端日志并返回「未送达」；不集成任何
> provider，不加 provider SDK，**没有任何邮件相关环境变量**，没有注册任何第三方账号。
>
> 由此有三个后果，都是有意的：
>
> 1. **订阅者会长期停在 `pending`，这是正确结果。** 没有「无邮件服务时自动确认」的开关，
>    `/admin` 也没有「手动确认」按钮。`confirmed` 的含义是「这个人点过邮件里的链接」；没发
>    过邮件就没人点过，把它写成 `confirmed` 等于在库里存一句假话，而且将来真发信时会往一批
>    从未同意过的地址发。
> 2. **confirm / unsubscribe 两条路由照常实现、照常实测**，测法见 §7：从服务端日志里取出
>    token 直接访问。将来接通 provider 只需换驱动，链路不用重做。
> 3. **页面文案是长期文案。** 「已登记，确认邮件会在邮件服务接通后发出」现在是终态，所以它
>    读起来是一个可接受的结果，不是一条报错：没有红色样式，没有「失败」字样；同时仍然不出现
>    任何「已发送」类表述。
>
> 选哪家 provider 需要用户的授权卡，由 Master PM 申请。

---

## 1. 为什么和 `users` 完全不相干

`users` 继续服务 `/admin` 与 pro 导出，`subscriber` 表**没有指向 `users` 的外键**，这不是
疏漏：给只想看一眼新闻列表的人塞一个密码，正是用户 2026-11-03 定稿里要去掉的那道门。两套
东西唯一的共同点是都有一列邮箱。

| | `users` | `subscriber` |
| --- | --- | --- |
| 凭证 | email + password（scrypt） | 没有 |
| 会话 | `sessions`（30 天 cookie） | 没有 |
| 用途 | 后台录入 / 审核、pro 导出与 API key | 收新增记录通知 |
| 退出方式 | 登出 | 邮件里的退订链接，一步生效 |

## 2. 数据模型

迁移：`drizzle/0004_subscriber_double_optin.sql`。两张表。

### `subscriber`

- `email`：唯一索引，**入库前统一 trim + 转小写**。这条规则同时写进了 CHECK
  （`email = lower(btrim(email))`），所以将来哪段代码忘了归一化，也不会给同一个人建出第二
  行订阅。
- `status`：`pending` / `confirmed` / `unsubscribed`。
- `confirm_token_hash`、`unsub_token_hash`：**只存 SHA-256 摘要**，与 `sessions` 一致。
  库被拖走也不能直接拿去确认或退订，因为我们寄出去的链接无法从这两列还原。
- `confirm_token_expires_at`：7 天。
- `created_at` / `confirmed_at` / `unsubscribed_at` / `source`（记录来自哪个页面，默认存
  当前路径，如 `/` 或 `/company/chegg`）。

两条生命周期规则是 CHECK 约束，不是「store 层的习惯」：

```
subscriber_confirm_token_pending_only   -- 有活的 confirm token ⇔ 该行是 pending
subscriber_status_timestamps            -- confirmed 必有 confirmed_at，unsubscribed 必有 unsubscribed_at
```

第一条是重点：「已确认的行还带着一个可用的 confirm token」正是让一次性 token 变成可重放
token 的那个 bug，所以由数据库挡住。

### `subscribe_throttle`

固定窗口计数器，`(scope, key_hash, window_start)` 为主键。放在数据库而不是内存里，因为部署
目标是 serverless：每个函数实例各有一份堆，内存计数只能限住一个实例，下一个请求换个实例就
过去了。

`key_hash` 存的是摘要，不是 IP 或邮箱本身——这张表必须为「可能永远不会订阅」的地址计数，而
一份「有人试过订阅这个人」的明文清单，比订阅本身更不该留下。计数器只需要相等比较。

预算（见 `SUBSCRIBE_RATE_LIMITS`）：

| scope | 上限 | 窗口 | 为什么 |
| --- | --- | --- | --- |
| `ip` | 10 | 1 小时 | 松的那一边：家庭、办公室、学校 NAT 共用一个出口地址，为了一个脚本把整栋楼锁出去不值得 |
| `email` | 3 | 1 小时 | 紧的那一边：一小时内给同一个地址发三封确认信已经够多了，而且它才是防止「用这个表单灌别人收件箱」的那道闸 |

固定窗口在跨窗口边界时最多放过 2 倍额度。接受：这是一个单字段表单的滥用控制，不是计费表。

IP 的取值依次看 `x-vercel-forwarded-for`、`x-real-ip`、`x-forwarded-for` 的第一段。在 Vercel
上这些头由平台边缘写入，可信；**前面没有可信代理时 `x-forwarded-for` 只是一个请求头，谁都能
换**，这也正是邮箱那一档要更紧的原因。一个取不到地址的请求会落进共用的 `unknown` 桶——宁可
一起被限住，也不要放过去。顺带一提，本地开发没有代理，所有请求都落在这个桶里，所以手工点满
10 次表单会把本地的表单限住一小时；`npm run verify:subscribe` 自带 IP 头，不受影响。

## 3. 三条流程

| 入口 | 行为 |
| --- | --- |
| 榜单页 / 公司详情页 / 仪表盘的订阅表单 | 校验 → 两道节流 → 落库 `pending` → 发确认信 |
| `GET /subscribe/confirm?token=…` | `pending` → `confirmed`，token 一次性，7 天过期 |
| `GET /subscribe/unsubscribe?token=…` | 一步退订，不需要登录，可重复点击 |

表单挂在 `src/app/(public)/layout.tsx`，所以榜单页、每个公司详情页、仪表盘上它都在同一个
固定位置。

**一次性是怎么保证的**：confirm 用一条 UPDATE 同时匹配摘要并把它置空
（`src/lib/subscribe/store.ts`）。第二次点击、邮件客户端预取链接、两个标签页同时打开，都会
匹配到零行——不依赖「记得事后清掉」。

**退订为什么不清 token**：旧邮件里的退订链接必须一直可用。重复点击是幂等的，
`unsubscribed_at` 用 `coalesce` 保留第一次退订的时间。已退订的地址允许重新订阅，并且要**再
走一次双重确认**：上一次的确认说明不了今天的意愿。

**发信查询**：`listMailableSubscribers()` 是唯一允许给发信用的查询，`status = 'confirmed'`
写在查询里面而不是交给调用方。`pending` 从没要求过邮件，`unsubscribed` 要求过停止，从收件
人的角度这两件事是同一个 bug。**不要给它加 `includeUnconfirmed` 参数。**

## 4. 邮件适配器与「诚实文案」

`src/lib/mailer.ts` 暴露 `send({to, subject, html})`，并且**只有一个驱动**：`log`，把邮件写
服务端日志，返回 `delivered: false`。`resolveMailer()` 不读任何环境变量——一个只有一个档位的
开关没有意义，而且最糟的结果是有人把它设成 `resend` 之后拿到的还是 log 驱动，却以为接通了。

那个 `false` 是这个模块存在的理由。如果 `log` 驱动返回成功，每个调用方、也就是每个页面，都
会对访客说「去查收邮件」——他会一直刷收件箱等一封不存在的信，最后认定这站是坏的，而他是对的。

页面文案（`src/components/subscribe/subscribe-form.tsx`）因此取自**驱动的能力**
（`mailer.canDeliver`），不是取自某次 `MailResult`。没有 provider 时渲染出来的就是：

```html
<div role="status" class="mt-4 space-y-1"><p class="text-sm font-medium">已登记，确认邮件会在邮件服务接通后发出。</p><p class="text-muted-foreground text-sm">本站目前还没有接通邮件服务，所以现在不会有邮件到达你的收件箱——不用等。订阅在接通后生效，仍然需要你点一次确认链接。</p></div>
```

### 将来接 provider 的人要知道的三件事

改动的形状是：在 `createLogMailer` 旁边加第二个工厂，在 `resolveMailer()` 里二选一。

1. 非 2xx 响应要映射成 `delivered: false`，不要吞掉。下游全靠这个标志决定对人承诺什么；
2. **尽量把发信挪到请求之外**（队列、`after()`）。订阅动作只有部分分支会去请求 provider，
   一旦这个往返体现在响应耗时上，就重新打开了下面这个枚举信道；
3. 接通那天，库里会有一批 `pending`。**它们不能被当成「待补发」批量确认**，只能收到一封确认
   信，各自再点一次。

## 5. 邮箱枚举防护

新地址、已经 `pending` 的地址、已经 `confirmed` 的地址，三种情况的响应**完全一致**：同一个
HTTP 状态码，同一段 `role="status"` HTML。不这样做的话，这个不需要账号就能用的单字段表单，
就变成了「查某人有没有订阅过你的站」的接口——随便输一个陌生人的邮箱就能问。

实现上有两个点：

- 已确认的地址走 `setWhere: ne(status, 'confirmed')`，**什么都不改、也不发信**，但返回值和
  新地址一样。顺带挡住了「随手输入别人的邮箱把他的活订阅打回 pending」。
- `canDeliver` 来自驱动而不是「这次有没有真的发出去」。已确认分支根本没发信，如果用发信结
  果去决定文案，分支之间就会不一样，正好泄露文案想藏起来的东西。

剩下的信道是时序，见上一节。

## 6. `/admin/subscribers`（只读）

`/admin` 下的订阅者视图，在原有的 session 门后面（`src/app/admin/layout.tsx`，未登录访问会
302 到 `/login`）。有它的理由很直接：「只收集、暂不发信」这个决定的唯一价值就是这些行将来
能用，而**看不见的行等于没有的行**。

页面回答两个问题：有多少（总数 + `pending` / `confirmed` / `unsubscribed` 三档分布，全库统计），
以及这些是不是真的（最近 200 个邮箱，连同 `source` 与三个时间戳）。`/admin` 首页也有一张同
样数据的概览卡，外加当前的邮件驱动。

四条设计约束：

- **严格只读。** 没有表单、没有 server action、不写任何东西。特别是**没有「标记为已确认」
  按钮**：替别人确认等于记录一份他从没给过的同意，还会把他放进第一次真实发信的名单。
- **不查询、也不渲染 token 摘要。** `listRecentSubscribers()` 的 `select` 里根本没有这两列。
  摘要本身不算能直接利用的东西，但页面上的摘要就是截图里、工单里、浏览器缓存里的摘要，而这
  个视图并不需要它——把列排除在查询之外，比「记得不要渲染」更靠得住。
- **邮箱明文显示。** 这页在登录门后面，而打码的清单无法回答运营真正的问题：这些是真实订阅
  还是垃圾提交。
- 分布来自 `countSubscribersByStatus()`（全库聚合），不是列表长度——列表有上限，统计不能跟着
  上限一起失真。

## 7. 验收

```bash
npm run verify:subscribe
```

脚本自带环境：把项目复制到 `.verify-subscribe/`（在仓库内，这样 Turbopack 能往上找到
`node_modules`），对一个一次性 PGlite 库跑迁移，起自己的 dev server（:3222），跑完删掉。
不需要先启动任何东西，也不会和你 :3000 上的 dev server 抢 `.next`。

它必须拥有那个进程，是因为没有 provider 时确认链接只存在于**服务端日志**里——这同时也是被
验证的东西之一：`log` 驱动得把一个能用的链接放到某个地方，并且把邮件报成未送达。

三个阶段：

1. **HTTP**：真实页面 + 真实 server action，全程不带 cookie（匿名访客路径）。表单以
   「浏览器禁用 JS」的方式提交，这也顺带绕过了 `required` / `type="email"`，才能证明服务端
   自己在校验。
2. **`/admin` 只读视图**：先用匿名请求打一次，再注册一个操作员账号、带 session 打一次。
   脚本里唯一的一个 session 就在这里，而且它属于 `users`，跟任何订阅者无关。
3. **直连**：server 退出、释放文件锁之后，断言 `subscriber` 里到底落了什么，并直接调用
   store 里 HTTP 阶段够不到的用例（token 过期、发信查询、`/admin` 的两个读函数）。

2026-11-03 一次完整运行：**55 项全部 PASS**。其中对应任务完成标准的几条：

```
PASS  an anonymous visitor (no cookie) can subscribe — HTTP 200
PASS  an unconfirmed submission is stored as pending, with a source and a live token — {"status":"pending","source":"/"}
PASS  the same confirm link cannot be used twice
PASS  a token past its expiry is refused — kind=expired
PASS  the same token works once it is in date again — kind=confirmed
PASS  the unsubscribe link takes effect in one step with no session
PASS  listMailableSubscribers() excludes the unsubscribed address — 0 mailable row(s)
PASS  re-submitting a CONFIRMED address returns exactly the first-time response
PASS  a 4th submission of the same address within the hour is throttled — accepted | accepted | accepted | 提交过于频繁，请稍后再试。
PASS  an 11th submission from the same IP within the hour is throttled — first 10: accepted | 11th: 提交过于频繁，请稍后再试。
PASS  with no mail provider, the response does not claim the mail was sent — none of 已发送 / 已发出 / 邮件已发 / 请查收
PASS  no raw token is stored anywhere in the table
PASS  the stored value is the SHA-256 digest of the mailed token
PASS  the throttle table stores digests, not addresses or IPs — ip:11 email:4 email:3
```

`/admin` 只读视图这一组：

```
PASS  an anonymous visitor is redirected away from the subscriber view — HTTP 307 → /login
PASS  and the body of that redirect contains no subscriber address — 15760B, 0 of 17 addresses
PASS  the subscriber view reports the total number of collected addresses — expected 共 17 个邮箱 (HTTP 200)
PASS  the distribution matches what the flows actually did — 待确认 15 · 已确认 1 · 已退订 1
PASS  the view explains that pending is the expected state, not a failure
PASS  the subscriber view is strictly read-only — the only form and button are 登出 — 1 form(s), 1 button(s)
PASS  the view renders no token digest
PASS  only addresses whose confirm link was actually visited are confirmed — t10-erin, t10-dave
PASS  listRecentSubscribers() never selects a token column — id,email,status,source,createdAt,confirmedAt,unsubscribedAt
PASS  countSubscribersByStatus() matches a direct GROUP BY and zero-fills the rest
```

### 写这个视图时发现并修掉的一个真实泄露

第二条断言不是摆设。`/admin/layout.tsx` 里的 `redirect("/login")` **挡不住它下面的页面**：
Next 会并发渲染 layout 和 page，所以匿名请求 `/admin/subscribers` 时页面照样跑了查询，而
dev server 把渲染结果——**每一个邮箱地址**——塞进了那个本该把人劝走的 307 的响应体里。
第一次跑这条断言就是红的。

修法是 `src/lib/auth.ts` 的 `requireUser()`：每个会读数据的 `/admin` 页面在自己的函数体里
先调用它，重定向在查询开始之前就抛出来，于是根本没有数据可被序列化。`/admin/records`、
`/admin/records/[id]`、`/admin` 首页之前是同一个漏洞（泄露的是草稿记录），一并改掉了，
`npm run verify:records` 现在也有对应的两条断言。

构建门槛（不得在构建期查库）：

```bash
env -u DATABASE_URL NODE_ENV=production npm run build   # ✓ /subscribe/confirm 与 /subscribe/unsubscribe 均为 ƒ(Dynamic)
npm run typecheck                                       # ✓
```

## 8. 没有做、也不该做的事

- 没有注册任何第三方账号，没有产生任何真实支出；
- 没有导入或购买任何现成邮件列表；
- 不发营销邮件。目前只有确认信一种，将来再加新增记录通知；
- 没有 provider 的时候不假装已发送。
