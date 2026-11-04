# Confirmed historical company shutdowns

Eight AI-related companies meet the whole-company operational cessation criterion
in this bounded research batch. Each has supporting source text, not merely a
search result or a layoff announcement. None is established here as having been
displaced by AI competition. Operational closure is not a claim of registered
legal dissolution or of every product and asset disappearing.

## Company table

| Company | Business | Supported closure timing | Evidence and important limits |
| --- | --- | --- | --- |
| Nintee | AI habit/weight-loss coaching | During 2024; farewell April 30 | [Founder retrospective](https://invertedpassion.com/2024-wrapped/) explicitly confirms closing the startup. About ten people historically; not an exact closure-day census. |
| Ghost Autonomy | Autonomous-driving software | April 3, 2024 | [Company statement reported by TechCrunch](https://techcrunch.com/2024/04/03/openai-backed-ghost-autonomy-shuts-down/) confirms worldwide cessation. About 100 employees reported; patents later sold to Applied Intuition. |
| Olive AI | Healthcare automation | October 2023; exact day unknown | [Company profile](https://www.cbinsights.com/company/crosschx) explicitly states cessation; [transaction adviser](https://www.lincolninternational.com/transactions/olive-ai-has-sold-substantially-all-of-its-assets-to-waystar-and-humata-health/) confirms asset sales. Core businesses continued with Waystar and Humata. |
| Argo AI | Autonomous-driving software | Announced October 26, 2022; completed by March 2, 2023 | [Reuters retrospective via CNBC](https://www.cnbc.com/2023/03/02/ford-launches-automated-driving-unit-latitude-ai-months-after-winding-down-argo-.html) confirms the wind-down occurred. Staff and technology transferred; this is not evidence of 2,000 job losses. |
| Kite | AI coding assistant | Confirmed closed by November 21, 2022; actual date unknown | [DevClass](https://www.devclass.com/development/2022/11/21/kite-ai-coding-pulled-down-to-earth-because-our-500k-developers-would-not-pay-to-use-it-now-open-source/1631387) explicitly reports company closure. Historical team of about 15; open-source code survives. |
| Starsky Robotics | Autonomous trucking | During 2020; farewell March 19 | [Founder account](https://medium.com/starsky-robotics-blog/the-end-of-starsky-robotics-acb8a6a8a5f5) plus [2022 retrospective](https://www.therobotreport.com/polymath-robotics-exits-stealth-plug-and-play-autonomy/) establish closure. Founder subsequently started a distinct company. |
| Aria Insights / CyPhy Works | AI drone analytics | March 21, 2019 | [Company statement](https://techcrunch.com/2019/03/22/drone-analytics-startup-aria-insights-suddenly-shutters/) gives the effective date; [FLIR](https://www.flir.com/news-center/press-releases/flir-acquires-tethered-drone-assets-and-technology-from-aria-insights/) confirms closure before buying assets. |
| Lighthouse AI | AI security cameras | December 2018 | [March 2019 retrospective](https://www.cepro.com/news/apple_patents_smart_security_start_up_lighthouse_ai/7904/) confirms completed closure, following the CEO's announcement. Apple acquired patents. Other businesses named Lighthouse are different entities. |

## Files and verification

- `companies.json`: eight unique companies, 20 source records, short quotations,
  date precision, historical scale, alternative explanations, and subsequent
  asset/staff transfers.
- `companies.csv`: the same eight companies for filtering or spreadsheet use.
- `verify.py`: checks counts, IDs, dates, source URLs and references, quotation
  limits, research-only flags, and JSON/CSV agreement. Run
  `python3 research/2026-11-04-confirmed-shutdowns/verify.py` from the repository root.

Kite's former blog now redirects to a domain-inquiry page. Olive's announcement
URL redirects to Waystar. Neither redirect is treated as closure evidence.
Axios returned article text with a paywall notice; Olive also has separate
cessation and transaction evidence. Retrieval via the research connector does
not establish that the application's stricter source fetcher can retrieve it.

Abundant Robotics is excluded from this simple list because its assets and brand
were relaunched as Abundant Robots. Utrip is deferred because this batch only
corroborated a scheduled cessation, not its completion. These exclusions are
retained in JSON rather than counted among the eight.

This is a historical starter batch, not an exhaustive or recent-only census.
Ghost was already a research candidate; the eight are not eight newly discovered
unique companies across all prior work. No database or public leaderboard was
changed. The existing daily bootstrap does not consume this batch. Publication
requires a correctly scoped record contract and fresh importer verification.

Sources were read on 2026-11-04 using Firecrawl deep research. Reported tool usage:
87 credits across root and researcher; monetary cost was not returned. No new
paid service was enabled. Jev was not used.
