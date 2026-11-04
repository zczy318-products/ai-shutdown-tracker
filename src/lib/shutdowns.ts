import archive from "../../research/2026-11-04-confirmed-shutdowns/companies.json";

export type ShutdownSource = {
  id: string;
  url: string;
  publisher: string;
  quotes: readonly string[];
  publishedAt: string | null;
  accessStatus: string;
};

export type ShutdownCompany = {
  id: string;
  name: string;
  businessZh: string;
  closureLabel: string;
  closureDate: string | null;
  confirmedClosedBy: string;
  announcementLabel: string | null;
  summaryZh: string;
  reasonZh: string;
  aftermathZh: string;
  scaleZh: string;
  sources: readonly ShutdownSource[];
};

type Presentation = Pick<ShutdownCompany, "businessZh" | "summaryZh" | "reasonZh" | "aftermathZh" | "scaleZh"> & {
  name?: string;
};

// Presentation only; dates, quotations and evidence remain in the research archive.
const presentation: Record<string, Presentation> = {
  nintee: {
    businessZh: "AI 减重与习惯辅导，后探索消费学习产品",
    summaryZh: "创始人于 2024 年发布告别声明，年底回顾确认 Nintee 已关闭并退还剩余融资。现有证据只确定停运年份，未确定最后营业日。",
    reasonZh: "创始人提到业务假设未获验证、改变用户习惯困难，以及缺乏产品市场契合度和支撑风投规模的信心；未确立 AI 替代导致停运。",
    aftermathZh: "告别声明称提供四个月遣散补偿及 VWO 工作机会，年底回顾则称六个月补偿及 Wingify 工作机会；两处口径不一致，保留这一差异。这些工作安排不代表 Nintee 继续运营。",
    scaleZh: "创始人回顾称历史团队约 10 人；不是停运当日人数或实际裁员人数。",
  },
  "ghost-autonomy": {
    businessZh: "自动驾驶软件",
    summaryZh: "公司声明确认于 2024 年 4 月 3 日结束全球运营并关闭公司。后续专利出售有独立公告，不能据此视为原公司持续经营。",
    reasonZh: "公司及首席执行官提到资金限制与漫长的商业化周期；未确立 AI 替代导致停运。",
    aftermathZh: "Applied Intuition 于 2024 年 10 月宣布收购其专利组合，这是停运后的资产交易。",
    scaleZh: "2024 年 4 月报道提到公司约 100 人；不是已确认的停运当日人数或净失业人数。",
  },
  "olive-ai": {
    name: "Olive AI（原名 CrossChx）",
    businessZh: "医疗收入周期与事前授权自动化",
    summaryZh: "业务出售公告与后续资料共同确认原 Olive 公司已于 2023 年 10 月停运；10 月 31 日是公告日期，不能当作最后营业日。",
    reasonZh: "交易顾问提到经营与宏观环境限制、流动性不足、偿债困难及盈利前景不明；未确立被其他 AI 产品替代。",
    aftermathZh: "Waystar 收购了清算和患者准入业务，Humata Health 收购了事前授权业务。部分业务和技术在买方继续，不代表原 Olive 公司仍在运营，也不代表所有产品都已停止。",
    scaleZh: "已读来源未提供可靠的全公司人数；早期裁员数字不能作为停运时员工总数。",
  },
  "argo-ai": {
    businessZh: "基于机器学习与机器人技术的自动驾驶软件",
    summaryZh: "2022 年 10 月报道为关闭公告，2023 年 3 月后续报道确认运营已结束。最后营业日及完成月份均未确定。",
    reasonZh: "来源指向车企撤回或重新分配支持、转向驾驶辅助业务；未确立被其他 AI 产品替代。",
    aftermathZh: "部分技术、资产和员工转入 Ford 与 Volkswagen。Ford 宣布约 550 名前 Argo 员工加入新设 Latitude AI；新公司不等于原 Argo 持续运营。",
    scaleZh: "2022 年 7 月裁员后报道仍有逾 2,000 名员工；部分员工转岗，不能据此宣称裁员 2,000 人。",
  },
  kite: {
    name: "Kite",
    businessZh: "AI 编程辅助与代码补全",
    summaryZh: "2022 年 11 月报道明确公司已关闭，并停止开发和支持。创始人对经营时期的回顾与告别公告时间不同，不能据此指定一个 2022 年停运日。",
    reasonZh: "创始人称模型能力尚未成熟，产品也未实现有效变现；竞争讨论不足以证明另一款 AI 导致其停运。",
    aftermathZh: "大量代码已经开源。仍可访问的仓库或可安装的分支不代表 Kite 企业继续经营；原告别文章地址现已转向域名询价页。",
    scaleZh: "报道提及历史团队约 15 人；不是已确认的停运当日员工数。",
  },
  "starsky-robotics": {
    businessZh: "自动驾驶卡车",
    summaryZh: "创始人于 2020 年 3 月宣布关闭，后续回顾明确公司在 2020 年停运；公告日不等于已证实的最后营业日。",
    reasonZh: "创始人提到 B 轮融资失败、投资者兴趣不足、安全商业化挑战及卡车行业衰退；未确立 AI 替代导致停运。",
    aftermathZh: "创始人后来创办的是另一家公司 Polymath Robotics；2022 年报道仍将 Starsky 描述为已关闭，不能据此认定 Starsky 重启。",
    scaleZh: "全公司人数未核实；创始人提到的 30 名工程师不能作为员工总数。",
  },
  "aria-insights": {
    name: "Aria Insights（原名 CyPhy Works）",
    businessZh: "无人机分析与自主系统",
    summaryZh: "公司声明明确自 2019 年 3 月 21 日起停止运营，后续资产买方亦确认其于当年 3 月停运；3 月 22 日为公告报道日期。",
    reasonZh: "已获取的停运声明未披露具体原因；未确立 AI 替代导致停运。",
    aftermathZh: "FLIR 于 2019 年 10 月收购知识产权及部分运营资产，并纳入自身业务。这是原公司停运后的资产整合。",
    scaleZh: "全公司及停运当日员工人数均未核实。",
  },
  "lighthouse-ai": {
    businessZh: "结合 AI 与三维感知的家用安防摄像头",
    summaryZh: "首席执行官于 2018 年 12 月宣布关闭，2019 年 3 月回顾确认公司已在此前的 12 月停运；具体最后营业日未确定。",
    reasonZh: "首席执行官称未取得预期商业成功；报道讨论市场拥挤与定价，但未确立 AI 替代导致停运。",
    aftermathZh: "2019 年 3 月报道 Apple 已收购其专利。该公司不能与后来同名的 Lighthouse 企业混为一谈。",
    scaleZh: "全公司及停运当日员工人数均未核实。",
  },
};

const publisherByHost: Record<string, string> = {
  "techcrunch.com": "TechCrunch",
  "www.appliedintuition.com": "Applied Intuition",
  "medium.com": "Starsky Robotics / Medium",
  "www.therobotreport.com": "The Robot Report",
  "www.flir.com": "FLIR",
  "www.cepro.com": "CE Pro",
};

const accessLabels: Record<string, string> = {
  full_page_text_retrieved: "研究时已获取页面正文",
  full_article_text_retrieved: "研究时已获取文章正文",
  full_text_read: "研究时已获取来源正文",
  public_profile_text_retrieved: "研究时已获取公开档案文本",
  public_repository_text_retrieved: "研究时已获取公开仓库文本",
  article_text_returned_with_paywall_notice: "研究时返回文章文本，页面含付费墙提示",
};

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year} 年${month ? ` ${Number(month)} 月` : ""}${day ? ` ${Number(day)} 日` : ""}`;
}

export const shutdownCompanies: readonly ShutdownCompany[] = archive.companies.map((company) => {
  const copy = presentation[company.id];
  if (!copy) throw new Error(`Missing shutdown presentation: ${company.id}`);
  const announcementDate = company.announced_on ?? ("announcement_month" in company ? company.announcement_month : null);
  return {
    id: company.id,
    name: copy.name ?? company.name,
    businessZh: copy.businessZh,
    closureDate: company.closure_date.value,
    closureLabel: company.closure_date.value
      ? `${dateLabel(company.closure_date.value)}关闭`
      : `截至 ${dateLabel(company.confirmed_closed_by)}已关闭`,
    confirmedClosedBy: company.confirmed_closed_by,
    announcementLabel: announcementDate ? `${dateLabel(announcementDate)}公告` : null,
    summaryZh: copy.summaryZh,
    reasonZh: copy.reasonZh,
    aftermathZh: copy.aftermathZh,
    scaleZh: copy.scaleZh,
    sources: company.sources.map((source) => {
      const publisher = ("publisher" in source ? source.publisher : undefined) ?? publisherByHost[new URL(source.url).hostname];
      const accessStatus = accessLabels[source.access_status];
      if (!publisher || !accessStatus) throw new Error(`Missing shutdown source presentation: ${source.id}`);
      return { id: source.id, url: source.url, publisher, quotes: source.quotes,
        publishedAt: source.published_at, accessStatus };
    }),
  };
});

export function getShutdownCompany(id: string): ShutdownCompany | undefined {
  return shutdownCompanies.find((company) => company.id === id);
}
