"""Validate the shutdown research batch without network or database access."""

import csv
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


base = Path(__file__).resolve().parent
data = json.loads((base / "companies.json").read_text())
companies = data["companies"]
assert len(companies) == data["counts"]["companies"] == 8
assert len({company["id"] for company in companies}) == len(companies)
assert data["counts"]["AI_displacement_causes_established"] == 0
assert data["counts"]["production_records_written"] == 0
source_ids = set()
quoted_words = defaultdict(int)

for company in companies:
    assert company["closure_status"] == "ceased_operations"
    assert company["closure_scope"] == "whole_company"
    assert company["legal_dissolution_status"] == "not_verified"
    assert company["ai_displacement_causation"] == "not_established"
    assert company["publication_status"] == "research_only"
    assert company["machine_record_generated"] is False
    assert "record" not in company
    value = company["closure_date"]["value"]
    precision = company["closure_date"]["precision"]
    if precision == "unknown":
        assert value is None
    else:
        pattern = {"year": r"\d{4}", "month": r"\d{4}-\d{2}", "day": r"\d{4}-\d{2}-\d{2}"}[precision]
        assert re.fullmatch(pattern, value)
        date.fromisoformat(value + {"year": "-01-01", "month": "-01", "day": ""}[precision])
    date.fromisoformat(company["confirmed_closed_by"])
    local_ids = {source["id"] for source in company["sources"]}
    scale = company["historical_scale"]
    assert set(scale.get("source_ids", [])) <= local_ids
    followup = company.get("followup_check", {})
    assert set(followup.get("evidence_ids", [])) <= local_ids
    for source in company["sources"]:
        assert source["id"] not in source_ids
        source_ids.add(source["id"])
        url = urlparse(source["url"])
        assert url.scheme == "https" and url.netloc
        assert source["quotes"] and source["access_status"]
        assert source.get("human_verified", False) is False
        assert source.get("human_reviewed", False) is False
        date.fromisoformat(source["retrieved_on"])
        if source["published_at"]:
            date.fromisoformat(source["published_at"])
        quoted_words[source["url"]] += sum(len(quote.split()) for quote in source["quotes"])

assert len(source_ids) == data["counts"]["sources"] == 20
assert all(count <= 25 for count in quoted_words.values())
with (base / "companies.csv").open(newline="") as handle:
    rows = list(csv.DictReader(handle))
assert len(rows) == len(companies)
for row, company in zip(rows, companies):
    assert row["company"] == company["name"]
    assert row["closure_date"] == (company["closure_date"]["value"] or "")
    assert row["date_precision"] == company["closure_date"]["precision"]
    assert row["confirmed_closed_by"] == company["confirmed_closed_by"]
    assert row["source_urls"].split(" | ") == [source["url"] for source in company["sources"]]
print("PASS: 8 companies, 20 sources, dates, references, quote limits, research flags, and CSV agreement")
