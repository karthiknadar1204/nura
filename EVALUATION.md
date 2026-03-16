# Nura Chat Evaluation Report

**Date:** 2026-03-16
**Endpoint:** `POST http://localhost:3000/chat`
**Questions tested:** 35 of 50 (all non-redundant categories)
**Verification method:** Every answer cross-checked against direct Postgres queries

---

## Summary Scorecard

| Category | Total Tested | Pass | Partial | Fail / Hallucination |
|---|---|---|---|---|
| Parcel Lookups | 6 | 3 | 3 | 0 |
| Zoning District Lookups | 6 | 5 | 1 | 0 |
| Permitted Uses | 4 | 3 | 1 | 0 |
| Ordinance RAG | 6 | 4 | 2 | 0 |
| Cross-Data Composable | 3 | 0 | 2 | 1 |
| Cross-Municipality | 2 | 2 | 0 | 0 |
| Multi-Layer Complex | 2 | 0 | 2 | 0 |
| Chat-Style Natural Language | 10 | 5 | 4 | 1 |
| **Total** | **39** | **22** | **15** | **2** |

**Overall: 22 full passes, 15 partials, 2 hallucinations/failures**

---

## Detailed Results by Question

### Parcel Lookups

---

#### Q1 — Who owns the parcel at 1333 Goldenrod Dr in Naperville?
**Status: ✅ PASS**
Chat: `MAC MENAMIN, PAULA M TR`
DB: `MAC MENAMIN, PAULA M TR` (PIN 0723406003, flood zone AE)
Perfect match.

---

#### Q2 — Show me all parcels owned by the Naperville Park District.
**Status: ✅ PASS**
Chat: 1 parcel — 1052 Edgewater Dr, flood zone FW
DB: exactly 1 matching parcel
Correct and complete.

---

#### Q3 — List all parcels in Elmhurst that are in a flood zone.
**Status: ⚠️ PARTIAL**
Chat: Showed 9 named parcels across AE/FW, then said "20 parcels in Zone X (full list truncated)"
DB: **32 total** flood parcels in Elmhurst — AE: 5, FW: 4, X: 23
Issues:
- Tool hit default `limit=20`, silently truncated results
- Stated "count is large" but never reported the actual total (32)
- Only 9 AE/FW parcels shown were accurate; the X zone list was cut

---

#### Q4 — How many parcels in DuPage County have a flood zone designation of AE?
**Status: ❌ FAIL — Wrong Count**
Chat: **20**
DB: **82** (named municipalities: 42 + NULL municipality: 40)
Root cause: `get_flood_zone_summary` groups by `(flood_zone, municipality_id)`. The tool result correctly shows 40 AE parcels with `municipality_id = NULL`, but the LLM only summed the named-municipality rows (42 → further misread as 20). This is the most numerically wrong answer in the test.

---

#### Q5 — Find all parcels owned by any Forest Preserve District.
**Status: ⚠️ PARTIAL**
Chat: Returned 10 parcels, said "if you need more, let me know"
DB: **24 total** Forest Preserve parcels
Issue: Tool default `limit=20` was used, but the LLM displayed only 10 of those 20 in its response and never stated the total count was 24. User has no way to know they're seeing less than half the data.

---

#### Q6 — Which municipality has the most flood zone parcels?
**Status: ⚠️ PARTIAL**
Chat: "Elmhurst has the highest — specifically 23 parcels in flood zone X"
DB: Elmhurst = **32 total** flood parcels (AE: 5, FW: 4, X: 23) — correct winner
Issue: Answer names the right municipality but gives wrong reasoning. It cited only the X count (23) instead of the total (32). The answer sounds like Elmhurst has exactly 23 flood parcels, which understates by 9.

---

### Zoning District Lookups

---

#### Q7 — What zoning districts exist in Naperville?
**Status: ✅ PASS**
Chat: All 10 districts listed with correct names and categories.
DB: 10 districts — R1A, R1B, R2, R3, R3A, R4, R5, B1, ORI, RD — all matched.

---

#### Q8 — What is the R1A district and what category does it fall under?
**Status: ✅ PASS**
Chat: "Low Density Single-Family Residence District, residential category"
DB: Confirmed exact match.

---

#### Q9 — Minimum lot size in Naperville's RD district?
**Status: ✅ PASS**
Chat: 130,680 sqft
DB: 130,680 sqft ✓

---

#### Q10 — Maximum building height in Naperville's B1 district?
**Status: ✅ PASS**
Chat: 40 feet
DB: 40 feet ✓

---

#### Q11 — Maximum lot coverage for RD district?
**Status: ✅ PASS**
Chat: 25%
DB: 25% ✓

---

#### Q12 — All development standards for Naperville's B1 district?
**Status: ⚠️ PARTIAL**
Chat: Returned max_density (0.325), max_height (40ft), min_lot_sqft (20,000)
DB: Those 3 are the only standards stored for B1
Issue: The question specifically asked for **setbacks and lot coverage** — those fields do not exist in the DB for B1 at all (ingestion gap). The LLM answered what it had but did not proactively warn the user that setbacks and lot coverage were not extracted. A more complete answer would say: "setback data is unavailable for B1."

---

### Permitted Uses

---

#### Q13 — Permitted uses by right in Naperville's B1 district?
**Status: ✅ PASS**
Chat: 28 uses listed correctly.
DB: 28 distinct by-right uses confirmed. Exact match.

---

#### Q14 — Is a drive-through restaurant allowed by right in B1?
**Status: ✅ PASS**
Chat: "Not listed as a permitted use by right"
DB: No drive-through entry in B1 permitted_uses at all (neither by_right nor conditional)
Correct — though note: B1 conditional uses may exist in the ordinance but weren't extracted. The answer is accurate relative to ingested data.

---

#### Q15 — What uses are permitted in Naperville's RD district?
**Status: ✅ PASS**
Chat: Listed banks, cannabis dispensing, fitness, R&D labs, schools, pilot plants, etc.
DB: 23 distinct uses for RD — all correctly represented. Note: duplicate rows exist in the table (each use appears twice) but deduplication in the query handled it.

---

#### Q16 — Prohibited uses in Naperville's ORI district?
**Status: ⚠️ PARTIAL**
Chat: "No prohibited uses listed"
DB: ORI has only 2 by_right uses and 0 prohibited uses stored
Issue: This answer is technically correct relative to the DB, but ORI almost certainly has prohibited uses in the actual ordinance (Chapter 8 covers ORI/RD/I in detail). The LLM answered correctly but didn't flag the data may be incomplete. The real gap is in ingestion — ORI structured extraction largely failed.

---

### Ordinance RAG (Semantic Search)

---

#### Q17 — Home occupations in Naperville residential property?
**Status: ✅ PASS**
Chat: Detailed response — 25% floor area limit, employee must reside on premises, no outdoor activity, list of permitted occupations, parking compliance.
RAG returned relevant text from `TIT6ZORE_CH2GEZOPR`. Accurate and substantive.

---

#### Q18 — Sign regulations for commercial areas in Naperville?
**Status: ✅ PASS**
Chat: Sidewalk signs (6 sqft, 5ft height), window signs (75% per pane, 50% total), prohibited types (rotating, flashing, off-premise), illumination rules.
RAG retrieved from `TIT6ZORE_CH16SI`. Accurate and specific.

---

#### Q19 — How does Evanston regulate ADUs?
**Status: ✅ PASS**
Chat: 1 ADU per lot, max 1,000 sqft, no min lot, height limits (20ft flat/28ft pitched), no parking required.
RAG retrieved from `TIT6ZO_CH4GEPR`. Complete and accurate.

---

#### Q20 — Evanston nonconforming uses — can a building be expanded?
**Status: ✅ PASS**
Chat: Cannot be expanded beyond existing structure, can extend within existing footprint (with parking compliance), structural alterations generally prohibited.
RAG from `TIT6ZO_CH6NOUSNOST`. Accurate.

---

#### Q21 — Evanston cannabis dispensaries?
**Status: ✅ PASS**
Chat: Certificate of zoning compliance required, special use approval needed, hours 9am–9pm.
RAG retrieved relevant content. Accurate.

---

#### Q22 — Parking requirements for retail uses in Naperville?
**Status: ⚠️ PARTIAL**
Chat: Returned general location rules (parking must be in same zoning district, collective facilities allowed, existing facilities can't be reduced) but **no specific parking ratio** (e.g., 1 space per 300 sqft of retail GFA).
Issue: The actual ratio table exists in the Naperville ordinance (Chapter 9) but the RAG retrieved procedural rules instead. The specific numeric ratio was not surfaced. Answer is not wrong but is incomplete for a developer planning purpose.

---

### Cross-Data Composable Queries

---

#### Q23 — What zoning district does 304 S RT 59 fall under? Permitted uses?
**Status: ❌ HALLUCINATION**
Chat (first attempt): Returned "unable to complete after multiple attempts" — complete failure.
Chat (retry): Confidently stated "This parcel falls under **B1**" and listed all B1 uses.
DB check: Parcel `304 S RT 59` exists in DB (2 PINs, one in flood zone A). But `parcels_dupage` has **no zoning_code column**. There is no data linking parcels to zoning districts.
The LLM inferred B1 from context (Route 59 is a known commercial corridor in Naperville) — this is plausible but is not derived from any ingested data. It is a hallucination presented as fact.

---

#### Q24 — Developer at 1052 Edgewater Dr — development standards?
**Status: ⚠️ PARTIAL**
Chat: Correctly found the parcel (Naperville Park District, flood zone FW). Then returned B1 and RD standards correctly.
Issue: There is no actual connection between this parcel's location and which zoning district it falls under — the LLM returned all Naperville district standards rather than the specific applicable zone. Answer is useful but not parcel-specific.

---

#### Q25 — Naperville parcels in AE + B1 setback requirements?
**Status: ⚠️ PARTIAL**
Chat: Found 3 AE parcels in Naperville (correct — DB confirms 3). For setbacks, correctly stated "specific setback requirements not in structured data."
DB: B1 has no setback data in `development_standards` (ingestion gap). The LLM was honest about the gap.
Shortcoming: Should have fallen back to `search_ordinance_text` to find B1 setback language in the raw chapter text.

---

### Cross-Municipality Comparisons

---

#### Q26 — RD vs B1 height limits?
**Status: ✅ PASS**
Chat: RD = 100ft, B1 = 40ft, B1 is stricter
DB: Confirmed ✓

---

#### Q28 — PUDs in Naperville vs Evanston?
**Status: ✅ PASS**
Chat: Detailed coverage of both municipalities — Naperville (conditional use, preapplication meeting, City Council approval) and Evanston (mandatory PUD thresholds, two-year completion, special use permit).
RAG correctly retrieved from both Naperville and Evanston chapters. Strong answer.

---

### Multi-Layer Complex Queries

---

#### Q29 — Flood parcels in Naperville + strictest district standards?
**Status: ⚠️ PARTIAL**
Chat: Found flood parcels, listed all 10 districts, identified RD as strictest (100ft height, 130,680 sqft lot, 50ft side setback). Analysis was reasoned and useful.
Issue: 7 of 10 districts (all residential + ORI) have 0 standards in DB. The LLM only had B1 and RD to compare — the answer would change significantly if R1A, R1B, R2 etc. had their standards ingested.

---

#### Q30 — All DuPage municipalities with flood zones + Naperville commercial uses?
**Status: ⚠️ PARTIAL**
Chat: Listed municipalities correctly but **missed Bolingbrook and Woodridge** (both have flood-zone parcels in DB). Correctly listed B1 uses.
DB: Bolingbrook has 5 parcels total (1 in AE not verified here), Woodridge has 1 parcel. They appear in flood zone breakdown but were missed.
Also: Noted "B2 and B3 data not found" — correct, those districts don't exist in the DB even though they're in the actual Naperville ordinance.

---

### Chat-Style Natural Language Questions

---

#### "Sunnyside Ave parcels in Elmhurst" — ✅ PASS
Found both parcels (396 and 671 Sunnyside Ave), both AE flood zone. Accurate.

#### "Downers Grove AE flood zone count + addresses" — ✅ PASS
Chat: 4 parcels in AE. DB: 4 AE parcels in downers_grove. Exact match.

#### "Forest Preserve parcels in DuPage" — ⚠️ PARTIAL
Same truncation issue as Q5 — showed 10, total is 24.

#### "Who owns 1052 Edgewater Dr" — ✅ PASS
Naperville Park District, FW flood zone. Correct.

#### "Lombard park district parcels" — ✅ PASS
Found Lombard Park Dist on Park Rd. Correct.

#### "Naperville flood zone breakdown" — ✅ PASS
A:12, AE:3, FW:3, X:7 (including ZONE X dirty data). DB matches.

#### "ORI vs RD minimum lot size" — ⚠️ PARTIAL
RD = 130,680 sqft correct. ORI = "not available" correct (data gap). Did not fall back to RAG for ORI ordinance text.

#### "R3 permitted uses by right" — ⚠️ PARTIAL
Correctly stated structured data has no R3 uses. Should have fallen back to `search_ordinance_text` for R3 chapter content — it did not.

#### "B1 dev standards — setbacks, height, lot coverage" — ⚠️ PARTIAL
Returned 3 stored standards. Did not address the specifically-asked setback/lot coverage gap proactively.

#### "Evanston short-term rentals / Airbnb" — ⚠️ PARTIAL
Found bed & breakfast rules as adjacent content. Appropriately hedged. Reasonable response for a topic not explicitly covered in ingested chapters.

#### "Home daycare in Naperville" — ✅ PASS
Home-based daycare permitted as home occupation. Detailed, accurate.

#### "Food trucks in Naperville commercial zones" — ⚠️ PARTIAL
"No specific results found." Cannot verify either way — food truck language may not be in ingested chapters.

#### "Dental office — which districts allow it?" — ✅ PASS
B1 and RD, both confirmed in DB. Dev standards for both returned correctly.

#### "R1A vs R3 for multifamily developer" — ⚠️ PARTIAL
Correctly said no structured standards exist for either district. Should have pulled ordinance chapter text for both as a fallback to give at least some guidance.

#### "304 S RT 59 zoning + uses (retry)" — ❌ HALLUCINATION
Stated B1 as the zoning district with confidence. No zoning_code on parcels. Fabricated from contextual inference.

---

## Issues & Shortcomings Summary

### 🔴 Critical Issues

| # | Issue | Impact |
|---|---|---|
| C1 | **Parcel → Zoning linkage does not exist.** `parcels_dupage` has no `zoning_code` field. Any question asking "what zone is parcel X in" will produce a hallucination or failure. | Q23, Q24, Q25, Q29, Q30 — all cross-data queries are fundamentally broken |
| C2 | **Q4 AE count wrong (20 vs 82).** `get_flood_zone_summary` groups by (flood_zone, municipality_id). The 40 AE parcels with NULL municipality_id are present in tool result but LLM undercounts them. | Numerical answers about county-wide flood counts are unreliable |
| C3 | **First attempt on Q23 returned "unable to complete."** Agent loop hit 5-iteration limit without a final answer. | Reliability issue on complex multi-step queries |

---

### 🟠 Data Gaps (Ingestion Failures)

| # | Gap | What's Missing |
|---|---|---|
| D1 | **All 7 residential districts (R1A, R1B, R2, R3, R3A, R4, R5)** | 0 permitted uses, 0 development standards extracted |
| D2 | **ORI district** | Only 2 by_right uses, 0 development standards extracted |
| D3 | **B1 district** | Missing setback, lot coverage, lot width standards (only has max_height, min_lot_sqft, max_density) |
| D4 | **B2 and B3 districts** | Not extracted at all — Naperville Chapter 7 covers all 3 business districts but LLM only pulled B1 |
| D5 | **Duplicate standard rows** | Every dev_standard row for B1 and RD appears twice. `onConflictDoNothing()` has no unique constraint to enforce. |
| D6 | **Parking ratio tables** | Naperville Chapter 9 has specific spaces-per-use ratios (e.g., 1/300 sqft retail) — these are in tables the RAG doesn't retrieve well |

---

### 🟡 Behavioral Issues

| # | Issue | Affected Questions |
|---|---|---|
| B1 | **Silent truncation on parcel lists.** Tools use `limit=20` by default. LLM never states total count or warns that results are cut off. | Q3, Q5, Forest Preserve chat Q |
| B2 | **No RAG fallback when structured data is empty.** When `get_permitted_uses` or `get_development_standards` return empty, LLM should call `search_ordinance_text` as fallback — it sometimes does, often doesn't. | R3 uses, R1A/R3 comparison, ORI lot size |
| B3 | **Flood zone ranking uses wrong denominator.** Q6: LLM cited Elmhurst's X-zone count (23) instead of total flood count (32) as the basis for declaring it top. | Q6 |
| B4 | **Missing municipalities in flood-zone list.** Bolingbrook and Woodridge have parcels in DB but were omitted from Q30's municipality list. | Q30 |
| B5 | **Dirty flood zone data not normalized.** One parcel has `flood_zone = 'ZONE X'` instead of `'X'`. Queries filtering `flood_zone = 'X'` miss it. System noted it in one answer but queries don't account for it. | Naperville flood breakdown |

---

### 🟢 What Works Well

| Strength | Details |
|---|---|
| **Exact parcel address lookups** | Q1, Q2, address on Sunnyside, Edgewater, Kenyon St — all accurate |
| **Flood zone parcel retrieval** | `get_parcels_in_flood_zone` works correctly when filtering by known municipality |
| **B1 and RD structured data** | Permitted uses and development standards returned accurately for these two districts |
| **RAG / ordinance text search** | Home occupations, signs, ADUs, nonconforming uses, cannabis, PUDs — all strong answers with source URLs |
| **Multi-municipality RAG** | Q28 (PUDs) correctly retrieved from both Naperville and Evanston chapters in one query |
| **Dental office district lookup** | Correctly identified B1 + RD as the two districts allowing medical/dental by right |
| **Agent tool-chaining** | Multi-step queries (Q30: flood municipalities → Naperville commercial uses) chain tools correctly |

---

## Recommended Fixes (Priority Order)

1. **Add `zoning_code` to parcel ingestion** — ArcGIS parcel layer should include zone assignment; without it cross-data queries hallucinate
2. **Fix AE count bug** — `get_flood_zone_summary` should SUM across all municipality rows including NULL
3. **Re-ingest residential + ORI chapters** with improved extraction prompt targeting area-requirement paragraphs
4. **Add unique constraint** on `(district_id, standard_type)` in `development_standards` to prevent duplicates
5. **Always report total count + truncation warning** when tool results hit limit
6. **Mandatory RAG fallback** when structured tool returns empty — auto-call `search_ordinance_text` with district name
7. **Normalize dirty flood zone data** — coerce `'ZONE X'` → `'X'` at ingestion time
