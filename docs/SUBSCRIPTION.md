# 邮件订阅（T10 / ZCZ-11）

匿名订阅 + 双重确认 + 一键退订。**订阅不走账号系统**：订阅者只给一个邮箱，没有密码、没有
用户记录、不需要登录。

> 当前状态：**没有接通任何邮件服务**。邮件适配器默认用 `log` 驱动，把邮件写进服务端日志
> 并返回「未送达」；页面文案照这个事实说话，不会显示「确认邮件已发送」。选哪家 provider
> 需要用户的授权卡，由 Master PM 申请，本任务没有注册任何第三方账号。

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

`src/lib/mailer.ts` 暴露 `send({to, subject, html})`，驱动按环境选：

- `MAIL_PROVIDER` 未设置或为 `log` → **`log` 驱动**：把邮件写服务端日志，返回
  `delivered: false`。
- `MAIL_PROVIDER` 指向一个还没注册适配器的名字 → 打一条 error 日志并**退回 `log`**。一个
  环境变量拼错不该让站点挂掉，但也绝不能安静地假装邮件发出去了。

那个 `false` 是这个模块存在的理由。如果 `log` 驱动返回成功，每个调用方、也就是每个页面，都
会对访客说「去查收邮件」——他会一直刷收件箱等一封不存在的信，最后认定这站是坏的，而他是对的。

页面文案（`src/components/subscribe/subscribe-form.tsx`）因此取自**驱动的能力**
（`mailer.canDeliver`），不是取自某次 `MailResult`。没有 provider 时渲染出来的就是：

```html
<div role="status" class="mt-4 space-y-1"><p class="text-sm font-medium">已登记，确认邮件会在邮件服务接通后发出。</p><p class="text-muted-foreground text-sm">本站目前还没有接通邮件服务，所以现在不会有邮件到达你的收件箱——不用等。订阅在接通后生效，仍然需要你点一次确认链接。</p></div>
```

### 接 provider 的人要知道的两件事

1. 非 2xx 响应要映射成 `delivered: false`，不要吞掉；
2. **尽量把发信挪到请求之外**（队列、`after()`）。订阅动作只有部分分支会去请求 provider，
   一旦这个往返体现在响应耗时上，就重新打开了下面这个枚举信道。

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

## 6. 验收

```bash
npm run verify:subscribe
```

脚本自带环境：把项目复制到 `.verify-subscribe/`（在仓库内，这样 Turbopack 能往上找到
`node_modules`），对一个一次性 PGlite 库跑迁移，起自己的 dev server（:3222），跑完删掉。
不需要先启动任何东西，也不会和你 :3000 上的 dev server 抢 `.next`。

它必须拥有那个进程，是因为没有 provider 时确认链接只存在于**服务端日志**里——这同时也是被
验证的东西之一：`log` 驱动得把一个能用的链接放到某个地方，并且把邮件报成未送达。

两个阶段：

1. **HTTP**：真实页面 + 真实 server action，全程不带 cookie（匿名访客路径）。表单以
   「浏览器禁用 JS」的方式提交，这也顺带绕过了 `required` / `type="email"`，才能证明服务端
   自己在校验。
2. **直连**：server 退出、释放文件锁之后，断言 `subscriber` 里到底落了什么，并直接调用
   store 里 HTTP 阶段够不到的两个用例（token 过期、发信查询）。

2026-11-03 一次完整运行：**39 项全部 PASS**。其中对应任务完成标准的几条：

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

构建门槛（不得在构建期查库）：

```bash
env -u DATABASE_URL NODE_ENV=production npm run build   # ✓ /subscribe/confirm 与 /subscribe/unsubscribe 均为 ƒ(Dynamic)
npm run typecheck                                       # ✓
```

## 7. 没有做、也不该做的事

- 没有注册任何第三方账号，没有产生任何真实支出；
- 没有导入或购买任何现成邮件列表；
- 不发营销邮件。目前只有确认信一种，将来再加新增记录通知；
- 没有 provider 的时候不假装已发送。
