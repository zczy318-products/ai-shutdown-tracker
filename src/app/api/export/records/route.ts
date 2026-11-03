import { NextResponse } from "next/server";

import { authenticateApiKey, readApiKeyFromHeaders } from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth";
import { buildCsv, exportFilename } from "@/lib/export/csv";
import { can, type Plan } from "@/lib/plans";
import { listPublishedRecords } from "@/lib/records/store";

/**
 * The pro full-dataset CSV export.
 *
 * Two ways in, because the two callers are different people: a browser with a
 * session cookie, and a script with an API key. Both resolve to the same
 * entitlement check.
 *
 * ## The refusal is the interesting part
 *
 * ZCZ-7 is explicit that a free or anonymous visitor pressing "导出" must get
 * an explanation, not a 403 white screen. So the response depends on who is
 * asking:
 *
 *   browser (Accept: text/html) → 303 to /pricing with a banner saying what
 *                                 happened and what to do next;
 *   script  (anything else)     → 401/402 JSON naming the reason and the URL
 *                                 a human can open to fix it.
 *
 * A redirect for the script case would be worse than useless — `curl` would
 * silently save an HTML pricing page as `records.csv`.
 *
 * The export covers published records only. That is the same data the public
 * pages already show in full; being pro buys bulk access, never earlier or
 * wider access to anything.
 */

export const dynamic = "force-dynamic";

type Viewer =
  | { kind: "api_key"; plan: Plan; email: string }
  | { kind: "session"; plan: Plan; email: string }
  | { kind: "anonymous" };

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  // `*/*` is what curl sends, so matching text/html specifically is what
  // distinguishes a browser navigation from a scripted fetch.
  return accept.includes("text/html");
}

export async function GET(request: Request) {
  const presentedKey = readApiKeyFromHeaders(request.headers);

  // An API key is an explicit, machine-shaped credential: if one is presented
  // and it is bad, say so rather than falling through to the cookie and
  // answering a confusing "please log in".
  if (presentedKey) {
    const auth = await authenticateApiKey(presentedKey);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.failure.code, message: auth.failure.messageZh },
        { status: auth.failure.status },
      );
    }
    return csvResponse({
      kind: "api_key",
      plan: auth.user.plan as Plan,
      email: auth.user.email,
    }, request);
  }

  const user = await getCurrentUser();
  const viewer: Viewer = user
    ? { kind: "session", plan: user.plan as Plan, email: user.email }
    : { kind: "anonymous" };

  return csvResponse(viewer, request);
}

async function csvResponse(viewer: Viewer, request: Request) {
  if (viewer.kind === "anonymous") {
    return refuse(request, {
      status: 401,
      code: "account_required",
      messageZh:
        "全量 CSV 导出需要一个专业版账号。注意：浏览榜单、筛选、详情页的全部来源与引述、" +
        "以及统计仪表盘都不需要账号 —— 注册只是订阅导出与 API 的入口。",
      pricingQuery: "from=export&reason=anonymous",
    });
  }

  if (!can(viewer.plan, "exportFullCsv")) {
    return refuse(request, {
      status: 402,
      code: "upgrade_required",
      messageZh:
        "当前账号是免费档，全量 CSV 导出属于专业版。升级后这个链接会直接返回完整数据集；" +
        "在此之前，网站上的全部内容你仍然可以逐条查看和复制。",
      pricingQuery: "from=export&reason=upgrade",
    });
  }

  const records = await listPublishedRecords();
  const body = buildCsv(records);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename()}"`,
      // The dataset changes whenever an editor publishes; a cached copy served
      // to a later request would quietly hand out a stale export.
      "cache-control": "no-store",
      "x-record-count": String(records.length),
      "x-row-count": String(records.reduce((sum, r) => sum + r.sources.length, 0)),
    },
  });
}

function refuse(
  request: Request,
  options: { status: 401 | 402; code: string; messageZh: string; pricingQuery: string },
) {
  if (wantsHtml(request)) {
    const target = new URL(`/pricing?${options.pricingQuery}`, request.url);
    // 303: the browser must follow with GET, and the result is "look at this
    // other page", not "this resource moved here permanently".
    return NextResponse.redirect(target, 303);
  }

  const pricingUrl = new URL(`/pricing?${options.pricingQuery}`, request.url).toString();
  return NextResponse.json(
    { error: options.code, message: options.messageZh, upgradeUrl: pricingUrl },
    { status: options.status },
  );
}
