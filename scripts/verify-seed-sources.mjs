#!/usr/bin/env node
/**
 * Re-verifies seed/companies.json against the live web:
 *   1. every source URL is reachable and returns article text
 *   2. every `quote` is an exact contiguous substring of that page's text
 *   3. the structural rules from the data dictionary hold
 *
 * This is the same check used to produce the dataset (see docs/SEED_VERIFICATION.md).
 * It talks to the open internet, so it is NOT part of build or test.
 *
 *   node scripts/verify-seed-sources.mjs            # structure + live quote check
 *   node scripts/verify-seed-sources.mjs --offline  # structure only, no network
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** sec.gov rejects browser UAs; its fair-access policy wants a declared identity. */
const SEC_UA = 'ZCZY318 AI Shutdown Tracker source verification (contact: product@zczy318.example)';

const uaFor = (url) => (new URL(url).hostname.endsWith('sec.gov') ? SEC_UA : UA);

const SEED = new URL('../seed/companies.json', import.meta.url);
const offline = process.argv.includes('--offline');

const CONFIDENCE = ['high', 'medium', 'low'];
const PRIMARYISH = ['primary_company', 'tier1_media'];

const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„',
  ndash: '–', mdash: '—', minus: '−',
  hellip: '…', middot: '·', bull: '•',
  eacute: 'é', egrave: 'è', pound: '£', euro: '€',
};

/** Strip tags/scripts and collapse whitespace so a quote can be matched as a substring. */
function toText(html) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    // Inline tags sit *inside* sentences — dropping them without a space keeps
    // "in a <a>securities filing</a>." reading as "in a securities filing."
    .replace(/<\/?(a|b|i|u|em|strong|span|sup|sub|small|mark|code|abbr|time|cite|q)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalises whitespace and the *glyph form* of quotes and dashes only.
 * Wording is never altered, so a match still proves the quote is verbatim —
 * it just tolerates a publisher serving ’ as ' or – as -.
 */
const norm = (s) =>
  s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function checkStructure(records, problems) {
  const primaryPerCompany = new Map();
  for (const { company, impacts } of records) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(company.slug)) {
      problems.push(`${company.slug}: slug fails the data-dictionary pattern`);
    }
    if (!/^[A-Z]{2}$/.test(company.country_code)) {
      problems.push(`${company.slug}: country_code must be a 2-letter upper-case code`);
    }
    primaryPerCompany.set(company.slug, 0);

    for (const impact of impacts) {
      const at = `${company.slug} @ ${impact.event_date}`;
      if (impact.is_primary) {
        primaryPerCompany.set(company.slug, primaryPerCompany.get(company.slug) + 1);
      }
      if (!CONFIDENCE.includes(impact.attribution_confidence)) {
        problems.push(`${at}: unknown attribution_confidence`);
      }
      if (!['day', 'month', 'year'].includes(impact.event_date_precision)) {
        problems.push(`${at}: unknown event_date_precision`);
      }
      if (impact.summary.length < 30 || impact.summary.length > 800) {
        problems.push(`${at}: summary length ${impact.summary.length} outside 30-800`);
      }
      if (!impact.summary.includes('据')) {
        problems.push(`${at}: summary is not written as reported attribution`);
      }
      if (!impact.counter_evidence) {
        problems.push(`${at}: counter_evidence is empty`);
      }
      if (!impact.sources?.length) {
        problems.push(`${at}: no sources`);
      }
      if (impact.attribution_confidence === 'high') {
        if (impact.sources.length < 2) {
          problems.push(`${at}: 'high' needs >= 2 independent sources (H4)`);
        }
        if (!impact.sources.some((s) => PRIMARYISH.includes(s.source_type))) {
          problems.push(`${at}: 'high' needs a primary_company or tier1_media source (H1)`);
        }
      }
      for (const s of impact.sources) {
        if (!/^https?:\/\//.test(s.url)) problems.push(`${at}: bad url ${s.url}`);
        for (const field of ['url', 'media_name', 'published_at', 'quote']) {
          if (!s[field]) problems.push(`${at}: source missing required ${field}`);
        }
        if (s.quote && s.quote.length < 20) {
          problems.push(`${at}: quote shorter than 20 chars (${s.media_name})`);
        }
        if (s.link_health === 'bot_blocked' && !s.manually_verified) {
          problems.push(`${at}: bot_blocked source must be manually_verified`);
        }
      }
      if (impact.sources.every((s) => s.link_health === 'dead')) {
        problems.push(`${at}: every source is dead`);
      }
    }
  }
  for (const [slug, n] of primaryPerCompany) {
    if (n !== 1) problems.push(`${slug}: expected exactly one is_primary impact, found ${n}`);
  }
}

/**
 * Fetches a page as normalised text.
 *
 * Several publishers fingerprint Node's `fetch` and answer 403 (or drop the
 * connection) while serving the same article fine to curl, so curl is used as a
 * fallback rather than reporting a reachable article as dead.
 */
async function load(url) {
  const headers = {
    'user-agent': uaFor(url),
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1',
  };
  let firstFailure;
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.ok) return norm(toText(await res.text()));
    firstFailure = `HTTP ${res.status}`;
  } catch (err) {
    firstFailure = err.message;
  }
  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-sSL', '--max-time', '45', '--fail', '-A', headers['user-agent'],
       '-H', `Accept: ${headers.accept}`, '-H', `Accept-Language: ${headers['accept-language']}`,
       url],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return norm(toText(stdout));
  } catch (err) {
    return { error: `${firstFailure}; curl fallback also failed (${err.code ?? err.message})` };
  }
}

async function checkQuotesLive(records, problems) {
  const cache = new Map();
  let checked = 0;

  for (const { company, impacts } of records) {
    for (const impact of impacts) {
      for (const s of impact.sources) {
        checked += 1;
        if (!cache.has(s.url)) {
          cache.set(s.url, await load(s.url));
        }
        const page = cache.get(s.url);
        const label = `${company.slug} / ${s.media_name}`;
        if (typeof page !== 'string') {
          problems.push(`${label}: unreachable (${page.error}) ${s.url}`);
        } else if (!page.includes(norm(s.quote))) {
          problems.push(`${label}: quote NOT found verbatim in page — ${s.quote.slice(0, 90)}…`);
        }
      }
    }
  }
  return checked;
}

const records = JSON.parse(await readFile(SEED, 'utf8'));
const problems = [];
checkStructure(records, problems);

const impacts = records.reduce((n, r) => n + r.impacts.length, 0);
const sources = records.reduce(
  (n, r) => n + r.impacts.reduce((m, i) => m + i.sources.length, 0),
  0,
);
console.log(`companies=${records.length} impacts=${impacts} sources=${sources}`);

if (!offline) {
  console.log('fetching sources (this hits the live web)…');
  const checked = await checkQuotesLive(records, problems);
  console.log(`quote checks attempted: ${checked}`);
} else {
  console.log('--offline: skipped live quote verification');
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}
console.log('\nOK — structure valid' + (offline ? '' : ' and every quote found verbatim'));
