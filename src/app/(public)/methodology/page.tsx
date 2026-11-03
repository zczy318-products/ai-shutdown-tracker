import type { Metadata } from "next";
import Link from "next/link";

import { policyProse, policyTable } from "@/components/public/policy-prose";

/**
 * 《我们怎么判断一条记录》 — the attribution standard, published.
 *
 * ## The copy is a deliverable, not a draft
 *
 * Every sentence below was written and signed off by Product PM (ZCZ-16) and is
 * reproduced **verbatim**. Do not reword, tighten or "improve" it. The reason is
 * not deference: this page is the document the site is held to when it says it
 * does not conclude anything, and the gap between «据某媒体报道» and «我们认定»
 * is the whole product constraint. A copy edit here can turn a restatement of
 * someone else's reporting into an assertion by this platform about a named real
 * company. Changes come from Product PM.
 *
 * That is also why the enum lists in 《影响类型与结果》 are typed out rather
 * than mapped from `src/lib/enums.ts`. The labels there read «停止运营 / 关闭»
 * and «已撤回 / 回退»; the approved copy reads «停止运营» and «已撤回». Deriving
 * them would silently rewrite the signed-off text on the next label tweak, so
 * the literal text wins and this comment is the link between the two. If a
 * dictionary value is ever added or removed (a migration, per the note at the
 * top of `src/lib/enums.ts`), this page needs a copy update from Product PM in
 * the same change.
 *
 * ## No status colour, by omission
 *
 * The page renders no confidence or outcome badge at all — the three tiers and
 * the seven outcomes appear as text, in a bordered table and in running prose.
 * So the ZCZ-6 §3.1/§3.2 constraints (confidence is a colourless ladder,
 * outcome gets no colour) hold here with nothing to enforce, which is the
 * cheapest way to keep them true on the page that explains them.
 *
 * ## Open to everyone
 *
 * Static, anonymous, no session read of its own and nothing truncated. It is
 * not in a route group that gates anything, it calls no auth helper, and it must
 * stay that way: a methodology page behind a login is an argument you are not
 * allowed to check.
 */

/**
 * The page body is a constant and would prerender happily, but the public
 * layout reads the session to decide between «编辑登录» and «进入后台». Without
 * this, `next build` tries to prerender the route, the layout's deliberately
 * failure-tolerant `readSessionQuietly` swallows Next's dynamic-usage sentinel,
 * and the build log gains a «session read failed» line that describes a
 * database problem which does not exist. Declaring it dynamic — as every other
 * page in this route group already does — is the honest description of a route
 * whose chrome depends on a cookie.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "我们怎么判断一条记录 — Rest In Prompts",
  description:
    "本站的归因标准：每条记录必须带的证据、归因置信度的三档与发布门槛、反方证据、以及为什么置信度和结果都不配色。",
};

export default function MethodologyPage() {
  return (
    <article className={policyProse}>
      <h1 className="text-3xl font-semibold tracking-tight">我们怎么判断一条记录</h1>

      <h2>我们记录什么</h2>
      <p>
        一条记录 = <strong>一家公司</strong> + <strong>一次与 AI 有关的影响事件</strong> +{" "}
        <strong>至少一条公开来源</strong>
        。同一家公司可以有多次事件，榜单上只展示其中一条「主事件」。
      </p>

      <h2>平台不下结论</h2>
      <p>
        本站<strong>不以自己的名义断言某家公司因为 AI 而关闭或裁员</strong>
        。我们只做一件事：把公开来源里已经说过的话，连同出处和原文引述一起摆出来。页面上的说法一律是转述
        —— 「据某媒体报道」「该公司称」—— 而不是我们的判断。
      </p>
      <p>
        我们<strong>不使用模型推断归因</strong>。没有任何一条记录的归因来自 AI 生成或自动打分。
      </p>

      <h2>每条记录必须带的证据</h2>
      <p>一条记录要能发布，必须同时满足：</p>
      <ol>
        <li>至少一条来源；</li>
        <li>
          每条来源都有 <strong>URL、媒体名、发布日期、原文引述</strong>四项，缺一不可；
        </li>
        <li>
          原文引述是<strong>逐字引用</strong>，长度在 20 到 2000 字符之间；
        </li>
        <li>
          不能所有来源的链接都已失效 —— 失效来源不得作为已发布记录的唯一依据，需补一条可达来源或归档快照；
        </li>
        <li>被反爬拦截的链接，必须有人工在浏览器里确认可访问过。</li>
      </ol>
      <p>这五条由数据库约束和发布前校验共同执行，不是编辑的自觉。</p>

      <h2>归因置信度的三档</h2>
      <p>
        置信度<strong>由人工选定，没有默认值</strong>
        ，程序不会替编辑决定。程序只做一件事：拒绝发布一个证据撑不起来的档位。
      </p>
      {/* The markdown table from the approved copy, as a real table. */}
      <div className="mt-4 overflow-x-auto">
        <table className={policyTable}>
          <thead>
            <tr>
              {/* Without this the two-character header folds to one glyph per line. */}
              <th scope="col" className="whitespace-nowrap">
                档位
              </th>
              <th scope="col">含义</th>
              <th scope="col">发布门槛</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="whitespace-nowrap">
                <strong>高</strong>
              </th>
              <td>来源里有一手材料或主流媒体原创报道明确说出了这层关系</td>
              <td>
                必须至少有一条「公司一手材料」或「主流媒体原创报道」类型的来源，否则只能降为「中」
              </td>
            </tr>
            <tr>
              <th scope="row" className="whitespace-nowrap">
                <strong>中</strong>
              </th>
              <td>有公开报道支持，但缺少一手确认，或各方说法不完全一致</td>
              <td>强烈建议附反方证据</td>
            </tr>
            <tr>
              <th scope="row" className="whitespace-nowrap">
                <strong>低</strong>
              </th>
              <td>关系是外界推断、或公司明确否认、或存在其他同样说得通的解释</td>
              <td>强烈建议附反方证据</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>置信度只会往下调，不会往上凑。</strong>
        证据撑不起更高的档位时，我们降档收录或不收录，而不是改写措辞。
      </p>

      <h2>反方证据</h2>
      <p>
        「中」与「低」的记录会同时展示反方证据 ——
        公司的否认、分析师提出的其他原因、与归因冲突的财务事实。看到一条记录时，你看到的是双方说法，不是我们挑出来的那一面。
      </p>

      <h2>影响类型与结果</h2>
      <p>
        影响类型固定四类：
        <strong>被 AI 产品替代 / AI 降本裁员 / 主动转型 / 报道提及</strong>。
      </p>
      <p>
        结果固定七类：
        <strong>停止运营、破产、大幅裁员、宣布缩编计划、转型、被收购、已撤回</strong>。
      </p>
      <p>
        其中「<strong>已撤回 / 回退</strong>
        」是刻意保留的一类：裁员计划被取消、决定被推翻的案例也必须收录，否则这份数据集只剩下一个方向的故事，会系统性地偏向「AI
        确实造成了后果」。
      </p>

      <h2>为什么这里没有红黄绿</h2>
      <p>
        置信度用的是一条<strong>无彩的明度阶梯</strong>，深浅表示高低；结果
        <strong>完全不配色</strong>。这是刻意的：
      </p>
      <ul>
        <li>给「停止运营」涂红、给「转型」涂绿，等于我们替读者下了价值判断，而我们声明过不下结论；</li>
        <li>颜色不能独自承载含义 —— 三个档位各自都有文字标签，不依赖辨色能力也能读。</li>
      </ul>

      <h2>浏览不需要账号</h2>
      <p>
        榜单、筛选、公司详情页的全部来源与原文引述、统计仪表盘，
        <strong>匿名访客全部可见，没有试读截断</strong>。注册不解锁任何阅读权限。
      </p>

      <h2>有疑问或异议</h2>
      <p>
        如果你认为某条记录有误，请到<Link href="/corrections">提出异议</Link>
        。我们对被收录的公司的异议按同一套标准处理。
      </p>
    </article>
  );
}
