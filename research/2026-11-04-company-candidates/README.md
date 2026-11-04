# Company candidate research — 2026-11-04

This research-only batch preserves 26 names supplied from a Reuters factbox and researches one bounded event per company. It is not a publication queue, a complete company history, or a list of 26 proven AI-caused layoffs. No application files, seed records, databases, deployment, or publication were changed. Jev was not used.

## Evidence and counts

- 26 candidates have an individually retrieved event-specific source; 16 have a company announcement, original filing, or investor presentation. The other 10 rely on attributed reporting or institutional secondary evidence.
- 20 are `source_backed_research`; 4 have unresolved AI causality (Agora, Danske Bank's February event, Nike, Groupe SEB); 1 is an unconfirmed plan report (HSBC); 1 is redeployment rather than layoffs (Mizuho).
- 0 publication approvals, 0 human verifications, and 0 completed-outcome verifications. `source_backed_research` describes evidence availability, not causal certainty or publication readiness. Every record retains attribution and counterevidence.
- The seed baseline is 29 companies and 30 events. Normalized candidate names, legal identities and aliases have no exact match against seed names, aliases and slugs. All 29 seed website URLs are null, so seed domain matching is unavailable. No verified total of 55 companies is claimed.
- No aggregate job-loss count is calculated: potential options, percentages, FTEs, workload equivalents, outsourcing, vacancies, attrition and announced reductions cannot be summed as completed layoffs.

## Discovery verification and corrections

The supplied factbox was opened in full, shows Reuters attribution and publication/update on October 22, 2026, and contains all 26 names:

https://www.investing.com/news/stock-market-news/factboxcompanies-cutting-jobs-as-investments-shift-toward-ai-4965744

Its financial-widget links can misidentify entities. The 166-role Agora event concerns Polish Agora S.A., not the Agora Inc. API ticker. The 2,100-role SEB event concerns French Groupe SEB, not the Swedish SEB bank linked by the widget.

Important qualifications retained in the records:

- Autodesk identifies go-to-market transformation as its primary driver and explicitly denies replacing people with AI. Atlassian identifies AI investment/skills changes while rejecting a simple replacement framing.
- Mizuho describes up to 5,000 job-equivalents of workload and reassignment without dismissals. HSBC's potential 20,000-role option had no final decision in the event-specific report.
- BAT's 5,500 cuts and 3,500 outsourced roles are different categories. Telstra's approximate 650 combines proposed Infosys outsourcing with a separate Accenture AI joint venture change.
- Proximus explicitly plans natural attrition and retirements. Its primary release does not provide the 1,200 figure in the factbox; the primary-backed count is left null.
- FICO discloses approximately 15%, while 570 is a media estimate from prior headcount. Pinterest discloses less than 15%, not an exact count. Closed Snap vacancies are separate from layoffs.
- Meta's record covers the January 2026 Reality Labs pivot only. Other Meta events in the factbox were not merged or exhaustively researched.

## Files and reproduction

`candidates.json` separates confirmed source-supported statements, unknowns, event scope, source access, short original-language quotations and interpretation limits. `reported_job_count` describes a reported or proposed reduction, never a verified completed outcome. `confirmed` means the cited source makes the statement; it does not certify the company's causal account. Source IDs connect confirmed fields to evidence. Dates distinguish filing/publication from event dates; unknown dates remain null.

`discovery-channels.json` records seven inspected channel examples with exact URLs and limits: EDGAR, WARN, Eurofound ERM, company announcements, trade unions, Layoffs.fyi and GenAI Brief. These extend source discovery without claiming a speculative number of new candidates. Trackers are leads, and their classifications/totals need original-source verification.

Run from the repository root:

```sh
python3 research/2026-11-04-company-candidates/verify.py
```

The dependency-free check parses both JSON files, checks unique candidate/source IDs, HTTPS URL syntax, exact totals, publication flags and normalized seed-name deduplication. It does not make network requests or touch a database. No app build is needed for this research-only change.

## Access and review limits

Selected event pages were searched and opened through the web tool on November 4, 2026. `full_text_retrieved` records successful tool access, not a browser screenshot, durable archive, human review, or guaranteed future link health. Short quotations were read in the returned source text; full source snapshots and deterministic quote-matching output were not retained. All `human_review_status` values remain `not_performed`; this dataset deliberately contains no `manually_verified` or `manuallyVerified` approval.

The dataset retains failed or misleading access attempts in `access_anomalies`: a Pinterest PDF search result redirected to a 2024 filing and was rejected in favor of the correct SEC source; Japan Times returned HTTP 402; a Eurofound development page timed out; the Eurofound application root returned 404. Final candidate evidence uses successfully retrieved alternatives.

Later ingestion must preserve these distinctions and source lineage, re-fetch/reconcile quotations, map only appropriate event types, resolve missing original documents and attribution gaps, and require the repository's existing editorial/publishing rules. Unknown domains are not guessed from brand names.

## Historical backfill batch

Following authorization to implement and test local ingestion, `historical-backfill.json` supplies four complete `RecordInput` records with explicitly machine-generated assessments: DNB, Snap, Freshworks and FICO. The other 22 candidates remain incomplete/deferred entries. All four use `medium` attribution, `downsizing_announced`, short continuous quotations, explicit counterevidence and `manuallyVerified: false`. Unknown company size, founding dates, optional descriptions and website fields are left unknown rather than invented. Country metadata is traced to official company descriptions or original filing headquarters/incorporation details. Snap uses `other` because the fixed industry enum lacks social media.

`prepare-backfill.py` reproducibly generates that batch from research notes and bounded field assessments. `verify.py` checks its totals, IDs, required research fields and machine-only review flags. The original research's zero publication approvals remain a statement about the research evidence, not a claimed result of a later importer run.

```sh
python3 research/2026-11-04-company-candidates/prepare-backfill.py
python3 research/2026-11-04-company-candidates/verify.py
npm run import:research -- research/2026-11-04-company-candidates/historical-backfill.json --dry-run
```

The first attempted importer run could not start because `tsx` was not installed in the working directory (`sh: tsx: command not found`). This is not a successful source-fetch test. The importer must retrieve and match each original quotation before eligibility; no fetched text, matched quote hash or runtime eligibility is fabricated in the batch. This researcher does not write a production or local database.

The Agora record now explicitly distinguishes the initial December 30, 2025 announcement, January 19, 2026 agreement, and planned February 28, 2026 completion. FICO distinguishes its October 1 plan commitment from October 6 filing. Event dates never imply independently verified completion.

A subsequent dependency-free check used Node 25's native TypeScript support to call the existing importer retriever directly:

```sh
node research/2026-11-04-company-candidates/check-backfill-fetch.mjs
```

That real check failed for all four public URLs. Inside the sandbox DNS returned `ENOTFOUND`; with approved external-network execution, the existing SSRF guard returned `source_address_not_public` for each URL. `backfill-fetch-check.json` records the latter actual results. No live quote match or end-to-end publication succeeded, and no private-address protection was bypassed. Web-tool retrieval during research and the application's own server retriever are different access paths; the former must not be presented as success of the latter. Re-run the exact check in a suitable public-network runtime before claiming live eligibility.
