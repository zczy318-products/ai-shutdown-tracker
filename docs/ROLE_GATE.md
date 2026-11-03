# /admin 角色门禁（ZCZ-15）

修的是一个**线上已经存在的完整性漏洞**，不是新功能：`/register` 对所有人开放，而
`/admin` 以前只验「会话是否有效」。拿到会话就等于拿到录入后台 —— `createRecord` /
`updateRecord` / `publishRecord` / `changeRecordStatus` / `deleteRecord` 五个写入口全
部可用。榜单上贴的是真实公司名，这条产品承诺不能靠「没人知道有注册入口」成立。

修法不是关掉注册（账号是付费主体的载体），而是给账号加一个**只管写权限**的角色，
默认最低档。

---

## 1. 两档角色，默认最低

`src/lib/roles.ts` 是唯一的定义处：

| 值 | 含义 |
| --- | --- |
| `viewer` | 默认档。可以订阅、全量导出、使用 API key；**不能**录入、修改、发布、下架或删除任何记录。 |
| `editor` | 可以进入 `/admin`，录入、审核、发布、下架、删草稿。 |

两条不许退的口径，代码里是分开的两个文件，互不 import：

- **浏览不需要账号。** 角色只守写操作。`/`、`/company/*`、`/stats`、`/pricing`、
  `/subscribe*` 里**一个角色判断都没有**，`npm run verify:roles` 会逐文件断言这件事。
  为此还顺手删掉了公开页眉里那条「进入后台」链接 —— 它要么会指给一个马上被拒的账号，
  要么就得在公开页面里判断角色。页眉现在只有「账户」，进后台的入口放在 `/account`
  上（那是一个已经需要会话的页面）。
- **`plan` 和 `role` 不许互相推导。** 付费不给写权限，`editor` 也不隐含 `pro`。
  `can()` 的签名仍然是 `can(plan, entitlement)`，`src/lib/plans.ts` 里没有出现过
  `role` 这个词，`src/lib/roles.ts` 里也没有出现过 `plan`。

## 2. 门禁在哪

`requireEditor()`（`src/lib/auth.ts`）的语义是「会话有效**且**角色足够」。两种拒绝分开：

- 没有会话 → `/login`（去登录是对的）；
- 有会话但角色不够 → `/account?denied=admin`，**不是** `/login`。他已经登录了，送回
  登录页既会绕圈又什么都没解释。`/account` 上有一块说明，并且明确写了「和付费套餐无关」。

调用点，一个都不能少：

| 位置 | 为什么 |
| --- | --- |
| `src/app/admin/layout.tsx` | 外层门禁 |
| `src/app/admin/page.tsx` | **在页面函数体里自己先调一次** |
| `src/app/admin/records/page.tsx` | 同上 |
| `src/app/admin/records/[id]/page.tsx` | 同上 |
| `src/app/admin/subscribers/page.tsx` | 同上 |
| `src/app/admin/records/new/page.tsx` | 同上。它不读数据，所以从来没泄露过，但它渲染的是编辑表单 |
| `src/app/admin/records/actions.ts` | 五个写入口的唯一关口，全部走 `requireEditor()` |

「每页自己再调一次」不是冗余：Next 会并发渲染 layout 和它下面的 page，layout 里的
`redirect()` 不会阻止 page 跑查询。PR #3 那次泄露就是这么来的 —— 匿名请求
`/admin/subscribers` 拿到的 307，**响应体里带着全部订阅者邮箱**。角色检查和当初的会话
检查有完全相同的竞态，所以形状必须保持。

`actions.ts` 里的五个入口里只有四处 `requireEditor()`：`createRecord` 和
`updateRecord` 共用 `saveFromForm`，门禁在它的第一行。

按钮的显示/隐藏**不是门禁**：`/account` 上那个「后台」按钮对 viewer 不渲染，纯粹是
不去指一扇锁着的门；拦住写入的是 `requireEditor()`。验收脚本因此不测按钮，它把五个
server action 的句柄在 editor 状态下取下来，降回 viewer 之后再直接 POST 一遍。

## 3. 登录落点按角色分流

| 动作 | 落点 |
| --- | --- |
| `POST /register` | 一律 `/account`（新账号必然是 viewer） |
| `POST /login` | `editor` → `/admin`，`viewer` → `/account` |
| 已登录访客打开 `/login` 或 `/register` | 同上，按角色 |

顺带补了一个洞：以前**唯一**的「登出」表单在 `/admin` 的 layout 里，也就是 viewer
现在进不去的那一页。`/account` 上加了登出。登录了却没法登出不叫门禁，叫陷阱。

## 4. 迁移：`drizzle/0006_user_role.sql`

```sql
CREATE TYPE "public"."user_role" AS ENUM('viewer', 'editor');
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'viewer' NOT NULL;
```

`default` 写的是**最低权限**那一档，这是这份文件里最吃重的一个词：

- `ADD COLUMN ... DEFAULT 'viewer' NOT NULL` 会把 `viewer` 写进**所有既有行**。这是
  要的结果而不是副作用 —— 这个漏洞修之前，后台对任何账号都是开的，所以没有任何一个
  既有账号是被「授予」过写权限的。往既有行里补 `editor` 等于把「可注册」变成「已经
  有一批有写权限的账号」。
- 文件里没有写死任何邮箱，也没有「第一个注册的人自动是 editor」这类规则 —— 那等于把
  这个漏洞改成一个竞态。
- 迁移不读 `plan`，也不从 `plan` 推 `role`。

**编号**：走 0006，0005 留给 ZCZ-14（年付）。两个迁移互不相干（没有共用任何列），
落地顺序无所谓；但谁后 rebase，请重新 `npm run db:generate` 让 drizzle 的 snapshot
链把两个列都带上 —— 真正执行的 SQL 不会因此改变。

## 5. 怎么授予第一个 editor

应用里**没有任何**代码路径会写 `users.role`：注册不会，计费 webhook 不会，`/account`
也不会。授权是一次人工动作。

托管库（线上）：

```sql
update users set role = 'editor' where email = '<地址>';
```

读回来谁有写权限：

```sql
select email, role, plan from users order by role, email;
```

本地 PGlite 没有 `psql`，所以附了一个只做这一件事的小命令。它的两个参数都没有默认值，
对着真 `DATABASE_URL` 时还必须显式加 `--yes`：

```bash
# dev server 必须先停掉：PGlite 会锁住数据目录
node scripts/grant-role.mjs you@example.com editor
node scripts/grant-role.mjs you@example.com viewer     # 收回
```

## 6. 本地怎么复验

```bash
npm run verify:roles
```

自带数据库、自带服务器、不读 `DATABASE_URL`（Neon 在付费档，验收不该压它的用量），
跑完自己收摊。120 条断言，分五段：

| 段 | 证明什么 |
| --- | --- |
| phase 0 | 先把库迁到 0006 之前，写进三个既有账号（含一个 `pro`），再跑 0006：列存在、`NOT NULL`、默认 `viewer`、枚举恰好两档、**三行全部落在 `viewer`**，重跑迁移不提权任何人 |
| phase 1 | 静态读源码：迁移里没有邮箱、没有提权语句、`editor` 只作为枚举值出现；七个公开页面零角色判断；`can()` 签名不变；六个 `/admin` 文件各自体内调 `requireEditor()` |
| phase 2 | 真注册一个账号：落 `/account`、`data-role="viewer"`、五条 `/admin` 路径全部 307 到 `/account?denied=admin`（不是 `/login`），**每条 307 的响应体里 0 个订阅者邮箱**；匿名的同五条仍然 307 到 `/login` 且同样 0 个；公开页面匿名可读、条数与已发布数一致；viewer 能从 `/account` 登出 |
| phase 3 | 一条 `update` 授予 editor 之后，同一个账号登录落 `/admin`、五页全部 200、能建记录也能改记录，并取下五个 server action 的句柄（五个互不相同） |
| phase 4–5 | 再一条 `update` 降回 viewer（会话不变），把五个 action 各 POST 一遍：全部 303 到 `/account?denied=admin`；匿名 POST 全部 303 到 `/login`；**停服后查库**：草稿还在、状态还是 `draft`、摘要没被改写、新公司没建出来、行数一个没动 |

相关的其它脚本也跟着这次改动调了：

- `npm run verify:auth` —— 落点改成 `/account`，并断言 viewer 被 `/admin` 拒绝；
- `npm run verify:records` —— 每个写操作都要过门禁，所以需要一个 editor 账号：
  `VERIFY_EDITOR_EMAIL=… VERIFY_EDITOR_PASSWORD=… npm run verify:records`。不给就会
  只报一句「这个账号没有写权限」而不是一屏失败；
- `npm run verify:subscribe` —— 它的 operator 账号现在在起服务器之前就以 `editor`
  身份写进库里，并额外断言「自助注册的账号被订阅者页拒绝，且那条拒绝的响应体里也没有
  邮箱」。

（`docs/ACCEPTANCE.md` 是 T8 那次验收的现场记录，没有改：它描述的是当时的页眉，而
页眉上的「进入后台」这次被删了。）
