import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getShutdownCompany, shutdownCompanies } from "../src/lib/shutdowns";

const research = JSON.parse(await readFile("research/2026-11-04-confirmed-shutdowns/companies.json", "utf8"));
assert.equal(shutdownCompanies.length, 8);
assert.equal(shutdownCompanies.reduce((total, company) => total + company.sources.length, 0), 20);
assert.equal(new Set(shutdownCompanies.map((company) => company.id)).size, 8);
const sourceIds = shutdownCompanies.flatMap((company) => company.sources.map((source) => source.id));
assert.equal(new Set(sourceIds).size, 20);
assert.equal(getShutdownCompany("unknown-company"), undefined);
assert.equal(getShutdownCompany("__proto__"), undefined);

for (const company of shutdownCompanies) {
  const raw = research.companies.find((item: { id: string }) => item.id === company.id);
  assert.ok(raw, `${company.id}: evidence archive exists`);
  assert.equal(getShutdownCompany(company.id), company);
  assert.match(company.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(raw.closure_status, "ceased_operations");
  assert.equal(raw.closure_scope, "whole_company");
  assert.equal(raw.ai_displacement_causation, "not_established");
  assert.equal(company.closureDate, raw.closure_date.value, `${company.id}: preserve original date precision`);
  assert.equal(company.confirmedClosedBy, raw.confirmed_closed_by);
  if (company.closureDate === null) {
    assert.match(company.closureLabel, /^截至 .+已关闭$/);
    assert.equal(raw.closure_date.precision, "unknown");
  } else {
    const widths: Record<string, number> = { year: 4, month: 7, day: 10 };
    assert.equal(company.closureDate.length, widths[raw.closure_date.precision]);
    assert.ok(!company.closureLabel.startsWith("截至"));
  }
  for (const text of [company.businessZh, company.summaryZh, company.reasonZh, company.aftermathZh, company.scaleZh]) {
    assert.match(text, /[\u3400-\u9fff]/, `${company.id}: Chinese presentation`);
  }
  assert.match(company.reasonZh, /未确立|不足以证明/);
  assert.ok(!/(已人工核验|人工审核通过|机器核验通过|运行时验证通过|核验已通过)/.test(JSON.stringify(company)));
  assert.ok(!("attributionConfidence" in company));
  assert.ok(!("manuallyVerified" in company));
  assert.ok(!("machineVerified" in company));
  assert.equal(company.sources.length, raw.sources.length);
  for (const source of company.sources) {
    const original = raw.sources.find((item: { id: string }) => item.id === source.id);
    assert.ok(original);
    assert.equal(source.url, original.url);
    assert.deepEqual(source.quotes, original.quotes, `${source.id}: quotations are unchanged`);
    assert.equal(source.publishedAt, original.published_at);
    assert.ok(source.publisher.trim());
    assert.match(source.accessStatus, /^研究时/);
    assert.ok(!("humanVerified" in source));
    assert.ok(!("manuallyVerified" in source));
  }
}

assert.equal(getShutdownCompany("argo-ai")!.closureDate, null);
assert.equal(getShutdownCompany("kite")!.closureDate, null);
assert.equal(getShutdownCompany("nintee")!.closureDate, "2024");
assert.equal(getShutdownCompany("starsky-robotics")!.closureDate, "2020");
assert.equal(getShutdownCompany("olive-ai")!.closureDate, "2023-10");
assert.equal(getShutdownCompany("lighthouse-ai")!.closureDate, "2018-12");
assert.notEqual(getShutdownCompany("aria-insights")!.closureDate, "2019-03-22");
assert.match(getShutdownCompany("argo-ai")!.announcementLabel!, /2022 年 10 月 26 日公告/);
assert.match(getShutdownCompany("kite")!.announcementLabel!, /2022 年 11 月公告/);
assert.equal(getShutdownCompany("olive-ai")!.sources.find((source) => source.id === "olive-adviser")!.publishedAt, null);
assert.match(getShutdownCompany("olive-ai")!.sources.find((source) => source.id === "olive-2024-retrospective")!.accessStatus, /付费墙/);
console.log("PASS shutdown archive: 8 companies, 20 unchanged sources, unique IDs, date precision, Chinese presentation, and honest evidence labels");
