# 种子数据核对说明（T4 / ZCZ-5）

> 版本 1.0 ｜ 核对日期 2026-11-03 ｜ 作者：Product PM
> 数据集：`seed/companies.json` —— **29 家公司 / 30 条 `ai_impact` 记录 / 54 条来源**
> 判定依据：ZCZ-2《归因标准》v1.0 与《数据字典》v1.0。字段与枚举严格对齐数据字典 §7 的交付格式。

---

## 0. 结论先行

| 项 | 结果 |
| --- | --- |
| 记录条数 | **30 条** `ai_impact`（分布在 29 家公司上，Chegg 有 2 条事件） |
| 来源条数 | 54 条，去重后 **48 个唯一 URL** |
| URL 可达性 | 48/48 返回 **HTTP 200 且能取到正文**（2026-11-03 复核） |
| 引述核对 | 54/54 条 `quote` 经**程序逐字比对**，确认是来源正文中的连续片段 |
| 置信度分布 | **高 11 / 中 12 / 低 7** |
| 候选池淘汰 | 从 ZCZ-2 候选池的 41 家具名公司中**淘汰 12 条**，理由见 §4 |
| 新增候选 | 核对过程中新增 4 家池外公司（Dukaan、Block、HP、以及 Chegg 的第二次事件），理由见 §3.3 |

数据集已达到任务要求的 ≥30 条，**没有缺口需要用降质记录去凑**。

---

## 1. 核对方法（以及它和「人工在浏览器里点开」的差别，请如实理解）

每个 URL 的处理流程：

1. 用桌面浏览器 UA 通过 `curl` 取回页面，把 HTML 转成纯文本并落盘保存；
2. 从**落盘的正文文本里**挑选 `quote`，不凭记忆、不做改写、不跨段拼接；
3. 用一个校验脚本把 `seed/companies.json` 里的每条 `quote` 回头在对应的落盘文本里做**子串匹配**（仅做空白归一化），不匹配即构建失败；
4. 交付前把整套检查重写成一个可复跑的脚本 `scripts/verify-seed-sources.mjs`，它**重新联网抓取全部 48 个 URL** 并再次做子串匹配 —— 当前结果是 **54/54 全部通过**。ZCZ-8 导入前与 ZCZ-9 验收时都可以自己跑一遍，不必相信我的结论：`node scripts/verify-seed-sources.mjs`（联网）/ `--offline`（只校验结构）。

**必须说清的两点：**

- `manually_verified = true` 在本数据集里的含义是：**录入人取回了该页正文，并确认引述是该正文中的精确连续子串**。这比「肉眼在浏览器里看一眼」更强（它排除了抄错和凭印象改写），但它**不是**人类在图形浏览器里的视觉确认。后台做链接巡检时按此口径理解即可。
- 校验是程序化的，所以「引述确实出自该来源」这一条是可复现的；而**定级（高/中/低）是人工判断**，我在每条的 `counter_evidence` 里写明了定级理由，评审可以逐条反驳。

### 本次核对推翻的一个前提

ZCZ-2 候选池的链接核验只记了 **HTTP 状态码**，这不够。本次发现两类误判：

- **theregister.com 返回 200，但返回的是反爬的 "Are we human?" 工作量证明页面，不是文章正文。** 候选池把它记作「200 可达」是错的。涉及 A7/A10/A11/B3 的 4 个备选链接，全部无法取到正文，已不采用（Wayback 快照在本环境连接超时，也取不到）。
- **capitalbrief.com、performancemarketingworld.com 返回 200，但正文在付费墙后**，只能取到标题与导语。
- 更要紧的是：**状态码 200 ≠ 该文提到了 AI。** CNBC 关于 BT 裁员 5.5 万人的原始报道（候选池 B3 的主来源）**通篇未出现 AI 字样**，若直接拿它支撑 AI 归因就触发拒收规则 R4（归因是录入人自己推断的）。BT 这条因此换了来源并降级，详见 §3.2。

**给 ZCZ-2 的修订建议**：链接核验口径应从「状态码」改为「状态码 + 能否取到正文 + 正文是否包含归因关键词」三项。

---

## 2. 逐条核对结论

全部 30 条的核对结论都是 **通过**（链接可达、引述为来源原文、公司名与事件日期与来源一致）。

| # | 公司 | 事件日期 | outcome | 置信度 | 来源域名 |
| --- | --- | --- | --- | --- | --- |
| 1 | Chegg, Inc. | 2025-10-27 | mass_layoff | 高 | cnbc.com<br>highereddive.com |
| 2 | Chegg, Inc. | 2025-05-12 | mass_layoff | 高 | cnbc.com<br>techradar.com |
| 3 | Salesforce, Inc. | 2025-09-02 | mass_layoff | 高 | fortune.com<br>cnbc.com<br>peoplemanagement.co.uk |
| 4 | Commonwealth Bank of Australia | 2025-08-21 | reversed | 高 | abc.net.au<br>thenightly.com.au |
| 5 | Block, Inc. | 2026-02-26 | mass_layoff | 高 | fortune.com<br>cnn.com<br>sfstandard.com |
| 6 | HP Inc. | 2025-11-25 | downsizing_announced | 高 | finance.yahoo.com<br>techstartups.com |
| 7 | Deutsche Lufthansa AG | 2025-09-29 | downsizing_announced | 高 | cnbc.com<br>clickondetroit.com |
| 8 | SAP SE | 2024-01-24 | pivot | 高 | cnbc.com<br>cio.com |
| 9 | IBM | 2023-05-01 | downsizing_announced | 高 | fortune.com<br>aljazeera.com<br>cnbc.com |
| 10 | Dukaan | 2023-07-10 | mass_layoff | 高 | fortune.com<br>businesstoday.in |
| 11 | Business Insider | 2025-05-29 | mass_layoff | 中 | variety.com<br>thewrap.com<br>adexchanger.com |
| 12 | Klarna Bank AB | 2024-02-27 | downsizing_announced | 中 | entrepreneur.com<br>wwd.com |
| 13 | Duolingo, Inc. | 2023-12（精度：月） | mass_layoff | 中 | techcrunch.com<br>businesstoday.in |
| 14 | Stack Overflow | 2023-10-16 | mass_layoff | 中 | cointelegraph.com<br>allstacks.com |
| 15 | Commerzbank AG | 2026-05-15 | downsizing_announced | 中 | bluewin.ch |
| 16 | Uber Technologies, Inc. | 2026-07-23 | mass_layoff | 中 | cmswire.com |
| 17 | Workday, Inc. | 2025-02-05 | mass_layoff | 中 | cnbc.com |
| 18 | CrowdStrike Holdings, Inc. | 2025-05-07 | mass_layoff | 高 | **sec.gov**（8-K EX-99.1）<br>cnbc.com |
| 19 | BT Group plc | 2023-05-18 | downsizing_announced | 中 | siliconrepublic.com<br>cnbc.com |
| 20 | Accenture plc | 2025-09-30 | mass_layoff | 中 | cxtoday.com |
| 21 | Intuit Inc. | 2024-07-10 | mass_layoff | 中 | fortune.com |
| 22 | Dropbox, Inc. | 2023-04-27 | mass_layoff | 中 | cnbc.com |
| 23 | Rackspace Technology, Inc. | 2026-06-23 | mass_layoff | 中 | finance.yahoo.com |
| 24 | Amazon.com, Inc. | 2025-10-28 | mass_layoff | 低 | cnbc.com<br>variety.com<br>finance.yahoo.com |
| 25 | Microsoft Corporation | 2025-07-02 | mass_layoff | 低 | cnbc.com |
| 26 | Nestlé S.A. | 2025-10-16 | downsizing_announced | 低 | abc7ny.com<br>supplychainbrain.com |
| 27 | Tata Consultancy Services | 2025-07-27 | mass_layoff | 低 | gulfnews.com<br>peoplematters.in |
| 28 | Verizon Communications Inc. | 2026-07-16 | mass_layoff | 低 | techtimes.com |
| 29 | The Planet D | 2025（精度：年） | shutdown | 低 | adexchanger.com |
| 30 | RWS Holdings plc | 2026-10-27 | pivot | 低 | ukinvestormagazine.co.uk |

---

## 3. 定级说明

### 3.1 置信度分布与口径

| 档位 | 条数 | 占比 | 该档的实际门槛 |
| --- | --- | --- | --- |
| 高 | 11 | 37% | 公司方（CEO / 发言人 / 官方声明 / 备忘录）自己把 AI 列为该事件的原因，**且**有 ≥2 条相互独立的来源 |
| 中 | 12 | 40% | 公司方确认但表述含糊（M2）、或归因很硬但**只有 1 条可访问来源**（M3）、或硬数据强相关但无人作因果断言（M4） |
| 低 | 7 | 23% | AI 只是报道提供的背景趋势（L2），或**公司方明确否认** AI 是原因（L3） |

「中」占比最高的主因**不是证据弱，而是 H4（≥2 条独立来源）这一条卡住了记录**。

Accenture、Intuit、Commerzbank、Uber、Workday、Rackspace 这 6 条都属于这种情况：公司方的归因材料在手，但只核到一条可访问的原创来源，按 M3 压在「中」。**补到第二条独立原创来源即可升级**，我在这些记录的 `counter_evidence` 里都写明了「仅核到一条来源」这个具体原因，便于后续定向补强。

CrowdStrike 原本也在这一类里，核对过程中**在 CNBC 的正文超链接里发现了 Kurtz 备忘录的原始出处**——公司提交给美国证交会的 8-K 附件 EX-99.1。补上这条 `primary_company` 来源后它同时满足了 H1 与 H4，是本数据集里唯一一条**由公司一手文件直接支撑**的「高」。

### 3.2 相对候选池预判，我下调了 9 条

候选池里的置信度是预判，以下是核对后被推翻的：

| 公司 | 池内预判 | 实际定级 | 下调理由 |
| --- | --- | --- | --- |
| Business Insider | 高 | 中 | CEO Peng 的内部信只说流量下跌「不受我们控制」，**没有点名 AI 搜索是流量下跌的原因**；AI 在信中出现的位置是公司自身的战略投入。把两者相联的是 AdExchanger 等媒体分析 |
| Duolingo | 高 | 中 | 发言人原话是「Part of that could be attributed to AI」——《归因标准》M2 条文**原文就举了这个句式**作为「中」的例子 |
| BT Group | 高 | 中 | AI 归因是 Silicon Republic 转述 Sky News 的二手表述；CNBC 原始报道通篇未提 AI；且 5.5 万里只有约 1 万被归因于 AI |
| Commerzbank | 高 | 中 | 只核到一条可访问原创来源（M3）；且存在联合信贷收购攻防这个强混杂因素 |
| Accenture | 高 | 中 | Julie Sweet 的原话只说「我们所需的技能」，**该句内未点名 AI**；且仅一条来源 |
| Intuit | 高 | 中 | 公司明确表示裁员「不是为了省钱」而是为腾出资金投 AI → 主动转型而非 AI 替代；且仅一条来源 |
| Workday | 高 | 中 | 只核到 CNBC 汇总稿一条来源，不满足 H4。另已核查 Workday 2025-02-05 的 8-K 原文（sec.gov），**该文件通篇未提及 AI**，因此不能用它补强（会触发 R4） |
| Microsoft | 中 | 低 | 微软从未把裁员与 AI 建立因果关系，Nadella 备忘录讲的是公司战略定位 → L2 |
| Nestlé | 中 | 低 | 公司口径全程是「成本削减」「运营效率」「自动化」，**未点名生成式 AI**，也未说明被替代的岗位 → L2 |

没有任何一条被上调。

### 3.3 新增的 4 条（池外）

| 记录 | 为什么值得加 |
| --- | --- |
| **Dukaan**（IN，2023-07-10） | CEO 本人在 Twitter 公开说「We had to layoff 90% of our support team because of this AI chatbot.」——一手归因最硬的一类，且是池内稀缺的**非美国、非上市、小公司**样本 |
| **Block**（US，2026-02-26） | Dorsey 把 4,000 人（40%）裁员直接归因于「intelligence tools」，是迄今比例最大的明确 AI 归因案例 |
| **HP**（US，2025-11-25） | CEO Lores 在 Yahoo Finance 采访中直接说「今天许多必须由人做的事，未来 AI 会做得更好更快」，且补上了池内缺失的 `manufacturing` 行业 |
| **Chegg 第二条事件**（2025-05-12） | 兑现了数据字典 §3 的一对多设计意图：同一家公司两次事件（5 月裁 22% / 10 月裁 45%），是详情页时间线与年度趋势图的真实用例 |

### 3.4 「反方证据」不是摆设

- `medium` / `low` 的 19 条**全部填了 `counter_evidence`**（校验脚本强制要求，缺失即构建失败）。
- `high` 的 11 条也**全部填了** `counter_evidence`，没有一条例外。
- 其中 3 条是**公司方明确否认 AI 归因**的争议记录，我按《归因标准》L3 收录在「低」档，并把否认原话完整写进 `counter_evidence`：
  - **Amazon**：Jassy 原话「was not really financially driven, and it's not even really AI driven — not right now, at least.」
  - **TCS**：CEO Krithivasan 原话「This is not because of AI but to address skills for the future.」
  - **Verizon**：发言人 Rich Young 原话这些调整「have nothing to do with AI」。
- **Commonwealth Bank 的 `reversed` 记录必须保留**：银行以 AI 语音机器人为由裁 45 人，随后承认是「错误」并撤回，工会指出来电量实际在上升。只收「AI 替代成功」的案例会让统计产生系统性偏差，那就等于平台在用选择性收录做断言。
- **Klarna** 的记录必须同时呈现三件事：「700 人」是工作量等效值不是裁员人数、公司明确否认与 2022 年裁员有关、后来客服削减被部分回退。只写第一条就是误导。

---

## 4. 被淘汰的候选及理由（12 条）

| 候选 | 池内预判 | 淘汰理由 | 触发规则 |
| --- | --- | --- | --- |
| **Giant Freakin Robot**（A5） | shutdown / 中 | 创始人 Josh Tyler 的原话指向「搜索垄断的新商业模式」与 Google 优先大品牌，**全程未提 AI**；hellopartner 文中的 AI 提法是该媒体自己的行业分析，不是对 GFR 的归因。主来源 performancemarketingworld.com 正文在付费墙后，只能取到标题与导语（导语同样未提 AI）。把它算作 AI 案例就是录入人推断 | **R4** |
| **Appen**（A3） | mass_layoff / 中 | 主来源 capitalbrief.com 正文在付费墙后；可取到的部分只讲 Google 终止 1.26 亿美元合约与股价，**未出现 AI 归因**。补不到一手材料 | **R2 + R4** |
| **Jasper AI**（A12） | mass_layoff / 低 | 已核来源（turingpost）讲的是估值下跌与被 ChatGPT 挤压，**没有任何符合 outcome 枚举的事件**（估值下跌不是倒闭/裁员/转型）；且主体本身是 AI 公司 | **R6 + R8** |
| **Teleperformance**（A10） | downsizing / 中 | 已核来源（CNBC）记录的事件是**股价单日跌 23%**，这不在 `outcome` 枚举里；CEO Daniel Julien 当天公开反驳 AI 威胁论。「市场预期冲击」不是公司事件 | **R6** |
| **Concentrix**（B14） | ongoing / 低 | 同上，来源记录的是股价反应，无公司层面事件 | **R6** |
| **Getty Images**（B17） | ongoing / 低 | 池内 `outcome` 自己就标了 `ongoing`——该值不在枚举里，说明没有可录的事件；且主来源是行业分析站。要录应从季报取 quote，本次未取到 | **R6** |
| **Shutterstock**（B18） | pivot / 低 | 同上 | **R6** |
| **Ocado Group**（B19） | mass_layoff / 低 ⚠️ | 唯一来源是聚合站 aiexposure.org，补不到一手或主流原创报道 | **R3 + L1** |
| **UPS**（B20） | mentioned / 低 ⚠️ | 同上 | **R3 + L1** |
| **Course Hero / Learneo**（C5） | 待补 | 唯一索引是 Wikipedia（按池内说明本就不可作为 `source`），找不到把裁员明确归因于 AI 的可达原创报道 | **R1 + R3** |
| **Gazete Duvar**（C3） | 拒收示例 | 站方把原因归于「Google 算法变化」，未指明 AI；bianet 原文本次亦取不到正文（返回 200 但无正文） | **R4 + R2** |
| **Verbit**（B15） | mass_layoff / 低 | 已核来源（Calcalist）记录的事件是**CEO 换人**，不在 `outcome` 枚举里；文中 AI 对营收的影响是「消息人士」说法。裁员报道在另一个未核对的 URL 上，按「没核对过的不进数据集」不录 | **R6** |

此外，**C6 Coursera** 与 **D1–D6 行业级线索** 按池内说明本就不作为公司记录收录（R7），应写进 `/methodology` 页；**C7**（Character.AI / Humane 等）按 R8 不收。

### 一条值得单独记下的教训

CMSWire 的汇总表格里有一行把 **「PayPal」与「CEO Enrique Lores」对应在一起** —— Enrique Lores 是 HP 的 CEO，不是 PayPal 的。该行**未被采用**。这正是「聚合表格不能直接当来源」的实例：我只采用了同一篇报道中关于 Uber 自身的正文段落（有备忘录原话），没有采用它的汇总表格。

---

## 5. 已知偏差与缺口（必须写进 `/methodology`，不要掩盖）

1. **严重偏向美国与英文媒体。** 29 家公司里 17 家是美国公司（US 17 / DE 3 / IN 2 / GB 2 / AU 1 / SE 1 / CH 1 / IE 1 / CA 1）。中国、日本、韩国、拉美、东南亚**零条**。原因是检索与核对都用英文，且英文媒体更会把裁员与 AI 明确关联。
2. **严重偏向上市公司与大公司。** `company_size` 分布是 `enterprise` 21 / `large` 6 / `micro` 1（The Planet D）/ `unknown` 1（Dukaan），**`small` 与 `medium` 各 0 条**。小公司倒闭很少有媒体报道，更难有一手归因材料 —— 这意味着**「被 AI 搞垮的小公司」在本数据集里被系统性低估**，仪表盘按规模分组时这一点必须标注。
3. **倒闭类样本几乎不存在，这是产品的核心发现而不是数据缺陷。** 30 条里 `shutdown` **只有 1 条**（The Planet D），`bankruptcy` **0 条**；`mass_layoff` 19 条、`downsizing_announced` 7 条、`pivot` 2 条、`reversed` 1 条。**真正「因 AI 彻底倒闭」且有硬归因的案例极少。** 仪表盘与方法论页都应如实呈现这一点，**不要为了做出「AI 杀死 N 家公司」的标题而拔高归因**，也不要用 `mass_layoff` 的条数去暗示倒闭。
4. **偏向「公司自己承认用 AI 降本」的表态。** 这类表态有股价与叙事上的动机，可能被夸大。Klarna 是教科书案例：宣称 AI 等效 700 人，随后恢复招聘人工客服。Commonwealth Bank 的 `reversed` 记录与 Gartner「到 2027 年半数公司会回头重招」的预测都已写进相关记录的 `counter_evidence`。
5. **`primary_company` 一手来源只有 1 条。** 54 条来源的构成是 `tier1_media` 33 / `trade_media` 19 / `primary_company` 1 / `aggregator` 1。
   唯一的一手来源是 CrowdStrike 的 8-K 附件 EX-99.1。**sec.gov 是可以抓的**——它拒绝浏览器 UA，但按其 fair-access 政策声明身份的 UA 可以正常取到正文（脚本里已按 host 区分处理）。
   其余记录里 Amazon 的官方博文、Dorsey 的 X 帖文、各家 CEO 备忘录都是**经媒体转述**取得的，因此老实归为 `tier1_media` 而非 `primary_company`，**不要在导入时改类型**。
   **后续补强的最高优先项就是沿这条路补 SEC / 财报 / 官方公告**：每补一条就可能把一条「中」升为「高」。
   已试过但不可用的两条：Chegg 2025-10-21 的 8-K 正文只讲裁员规模与 CEO 更替，AI 口径在未单独抓取的 Exhibit 99.1 里；
   Workday 2025-02-05 的 8-K **通篇未提 AI**，用它反而会触发 R4。
6. **`website_url`、`logo_url`、`founded_year` 大量为空。** 我只填了来源正文里明确写出的值（Chegg 2005、The Planet D 2008），其余留 `null`，不猜。`website_url` 全部为空：我没有逐个核对过公司官网域名，不想用未核对的 URL 填字段。这是**有意留给 T5 / 后续补齐的空位，不是遗漏**。
7. **`quote_translation_zh` 全部为空。** 54 条引述全是英文原文（`quote_lang = "en"`）。前台必须按数据字典要求标注「英文原文」；若后续补中文译文，必须并列显示且标「译文（非原文）」。

---

## 6. 给 ZCZ-8（T7）导入工程师的注意事项

1. 文件就是 `seed/companies.json`，**29 个 company 对象、30 个 impact、53 个 source**，字段与数据字典 §7 的示例结构一致。
2. `is_primary = true` 的有 **29 条**（每家公司恰好一条），满足部分唯一索引 `ai_impact_one_primary_per_company`。Chegg 的 2025-05-12 那条是 `is_primary = false`。
3. 数据字典 §3 的四条服务端业务校验，本数据集的实际状态：
   - 每个 impact 的 source 条数 ≥ 1 ✅（最少 1 条，最多 3 条）
   - `high` 的记录均有 ≥1 条 `primary_company` 或 `tier1_media` ✅（其中 1 条为 `primary_company`，见 §5.5）
   - 每条 source 的 `url` / `media_name` / `published_at` / `quote` 四项非空 ✅
   - `link_health` 全部为 `ok`，无 `dead` ✅
4. `record_status` 字段**未写在 JSON 里**，按数据字典 §7 第 3 条由导入脚本统一置为 `published`。`company.region` 已按 `country_code` 预先推导并落在 JSON 里，导入时直接用，不要重算（AU/IN → `asia_pacific`，DE/GB/SE/CH/IE → `europe`，US/CA → `north_america`）。
5. `event_date_precision` 有两条不是 `day`：Duolingo = `month`（2023-12），The Planet D = `year`（2025）。前台按精度显示「2023 年 12 月」「2025 年」，**不要显示成 2023-12-01 / 2025-01-01**。
6. `employees_affected_pct` 为 `numeric(5,2)`，本数据集里有 `7.4`、`8.5`、`2` 这类非整数值，不要按整数入库。
7. 若校验不过，按数据字典要求**整体失败并打印不过的条目**，不要部分写入。

---

## 7. 我没做的事

说清边界，避免 ZCZ-9 验收时误判：

- 只补到 1 条 `primary_company` 一手来源（CrowdStrike 的 8-K EX-99.1）；没有系统性地为其余 29 条记录去 EDGAR 捞对应的 8-K / 财报，这是已知的、可以继续推进的补强方向，见 §5.5；
- 没有为 `bot_blocked` 的来源补 `archive_url`（本环境访问 web.archive.org 连接超时，Wayback 快照取不到），因此数据集里索性不收任何需要快照兜底的来源；
- 没有填 `summary_en`、`quote_translation_zh`、`logo_url`、`website_url`；
- 没有自己去查证公司的成立年份与雇员数，只采信来源正文里写明的数字；
- 没有录入任何来自 D 梯队（行业级统计）的记录 —— 按 R7 它们只能进 `/methodology`。
