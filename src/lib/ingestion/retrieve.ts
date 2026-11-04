import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

export type RetrievedSource = {
  text: string;
  finalUrl: string;
  status: number;
  retrievedAt: string;
  method: string;
};
export type RetrieveSource = (url: string) => Promise<RetrievedSource>;

// Allow globally routable IPv4 only; rejecting IPv6 also excludes mapped/private forms.
export function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}

export function articleText(html: string): string {
  return html.replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:a|b|i|em|strong|span|sup|sub|small|mark|abbr)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : " ")
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => parseInt(n, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(n, 16)) : " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash);/gi,
      (_, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" })[n.toLowerCase()] ?? " ");
}

export function normalizeQuote(text: string): string {
  return text.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
}

async function fetchPage(url: URL, timeoutMs: number): Promise<{ status: number; location?: string; body: string }> {
  const started = Date.now();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("source_url_requires_public_https");
  }
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, family: 4 }),
    new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("source_dns_timeout")), timeoutMs); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(({ address }) => !publicIpv4(address))) {
    throw new Error("source_address_not_public");
  }
  // Pin the checked address; a second DNS lookup would permit DNS rebinding.
  const address = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      family: 4,
      lookup: (_host, _options, callback) => callback(null, address, 4),
      headers: { "user-agent": "RestInPrompts/1.0 source-verifier", accept: "text/html,text/plain", "accept-encoding": "identity" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.destroy();
        resolve({ status, location: res.headers.location, body: "" });
        return;
      }
      const contentType = res.headers["content-type"] ?? "";
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)\b/i.test(contentType) ||
          (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
        res.destroy();
        reject(new Error("source_not_plain_text_or_html"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 3_000_000) res.destroy(new Error("source_response_too_large"));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("source_timeout")), Math.max(1, timeoutMs - (Date.now() - started)));
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}

export async function retrieveSource(input: string, budgetMs = 15_000): Promise<RetrievedSource> {
  let url = new URL(input);
  const deadline = Date.now() + Math.min(15_000, budgetMs);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("source_timeout");
    const result = await fetchPage(url, remaining);
    if (result.status >= 300 && result.status < 400 && result.location) {
      url = new URL(result.location, url);
      continue;
    }
    if (result.status < 200 || result.status >= 300) throw new Error(`source_http_${result.status}`);
    return { text: articleText(result.body), finalUrl: url.href, status: result.status,
      retrievedAt: new Date().toISOString(), method: "https_public_dns_pinned_v1" };
  }
  throw new Error("source_redirect_limit");
}
