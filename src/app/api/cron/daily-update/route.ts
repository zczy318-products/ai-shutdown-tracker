import { cronAuthorized, runDailyUpdate } from "@/lib/ingestion/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await runDailyUpdate(), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "daily_update_unavailable", detail: "Check database migrations and server configuration." },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}
