import { NextResponse } from "next/server";

import { authenticateApiKey, readApiKeyFromHeaders } from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth";
import { buildCsv, exportFilename } from "@/lib/export/csv";
import { listPublishedRecords } from "@/lib/records/store";

export const dynamic = "force-dynamic";

/** Free for every authenticated account; explicit invalid keys never fall back to a session. */
export async function GET(request: Request) {
  const presentedKey = readApiKeyFromHeaders(request.headers);
  if (request.headers.has("authorization") || request.headers.has("x-api-key")) {
    const auth = await authenticateApiKey(presentedKey);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.failure.code, message: auth.failure.messageZh },
        { status: auth.failure.status, headers: { "cache-control": "no-store" } });
    }
  } else if (!await getCurrentUser()) {
    const loginUrl = new URL("/login", request.url);
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
      return NextResponse.redirect(loginUrl, 303);
    }
    return NextResponse.json({ error: "account_required", message: "登录后即可免费导出 CSV，也可以使用自己的 API key。",
      loginUrl: loginUrl.toString() }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const records = await listPublishedRecords();
  return new NextResponse(buildCsv(records), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename()}"`,
      "cache-control": "no-store",
      "x-record-count": String(records.length),
      "x-row-count": String(records.reduce((sum, record) => sum + record.sources.length, 0)),
    },
  });
}
