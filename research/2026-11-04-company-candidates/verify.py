"""Validate the research dataset locally without network requests or DB changes."""
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
data = json.loads((HERE / "candidates.json").read_text())
channels = json.loads((HERE / "discovery-channels.json").read_text())
seed = json.loads((ROOT / "seed/companies.json").read_text())
candidates = data["candidates"]

def normalize(value):
  return re.sub(r"[^a-z0-9]", "", value.lower())

def valid_url(value):
  parsed = urlparse(value)
  return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password

assert len(candidates) == 26
assert len({c["id"] for c in candidates}) == len(candidates)
assert data["publication_status"] == "research_only"
source_ids = []
for candidate in candidates:
  assert not candidate["publication_approved"]
  assert not candidate["confirmed"]["outcome_completion_verified"]
  keys = {normalize(x) for x in [candidate["name"], candidate["legal_identity"], *candidate["aliases"]]}
  matches = []
  for item in seed:
    company = item["company"]
    seed_keys = {normalize(x) for x in [company["slug"], company["name"], *company.get("aliases", [])]}
    if keys & seed_keys:
      matches.append(company["slug"])
  assert not matches, (candidate["id"], matches)
  for source in candidate["evidence"]:
    assert valid_url(source["url"])
    assert source["access_status"] == "full_text_retrieved"
    assert source["human_review_status"] == "not_performed"
    assert source["short_quote"]
    source_ids.append(source["id"])
assert len(source_ids) == len(set(source_ids))
assert all(valid_url(channel["url"]) for channel in channels["channels"])
assert all(valid_url(item["url"]) for item in data["access_anomalies"])
assert valid_url(data["discovery_source"]["url"])
counts = data["counts"]
assert counts["candidates"] == len(candidates)
assert counts["statuses"] == dict(Counter(c["status"] for c in candidates))
assert counts["with_individual_full_text_source"] == sum(any(s["access_status"] == "full_text_retrieved" for s in c["evidence"]) for c in candidates)
assert counts["with_company_or_filing_source"] == sum(any(s["source_type"] in ("company", "filing") for s in c["evidence"]) for c in candidates)
assert data["seed_baseline"]["companies"] == len(seed)
assert data["seed_baseline"]["events"] == sum(len(c["impacts"]) for c in seed)
assert all(item["company"].get("website_url") is None for item in seed), "Revisit domain dedup assumptions"
assert counts["publication_approved"] == counts["human_verified"] == counts["seed_matches"] == 0
print(json.dumps({"validation": "passed", "counts": counts, "evidence_documents": len(source_ids), "discovery_channels": len(channels["channels"]), "url_check": "syntax only; live retrieval status recorded per source", "seed_domain_comparison": "unavailable: all 29 seed website URLs null"}, indent=2))

backfill = json.loads((HERE / "historical-backfill.json").read_text())
complete = [candidate for candidate in backfill["candidates"] if "record" in candidate]
assert len(backfill["candidates"]) == 26
assert len({candidate["id"] for candidate in backfill["candidates"]}) == 26
assert len(complete) == backfill["counts"]["complete_records"] == 4
assert len(backfill["candidates"]) - len(complete) == backfill["counts"]["deferred_without_record"] == 22
for candidate in complete:
  record = candidate["record"]
  assert record["impact"]["outcome"] == "downsizing_announced"
  assert record["impact"]["attributionConfidence"] == "medium"
  assert record["impact"]["counterEvidence"]
  assert len(record["impact"]["summary"]) >= 30
  assert candidate["assessment"]["method"] == "machine"
  assert candidate["assessment"]["evidenceUrls"] == [source["url"] for source in record["sources"]]
  for source in record["sources"]:
    assert not source["manuallyVerified"]
    assert len(source["quote"]) >= 20
    assert valid_url(source["url"])
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", source["publishedAt"])
print(json.dumps({"backfill_validation": "passed", "counts": backfill["counts"]}, indent=2))
