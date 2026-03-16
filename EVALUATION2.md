# Nura — Evaluation Round 2

**Date:** 2026-03-16
**Questions tested:** 50
**Scorecard:** 33 pass / 9 partial / 5 fail / 3 hallucination

---

## Summary of Issues

- **Missing parcel data (municipality_id = NULL):** A large number of parcels (116) have no `municipality_id` assigned. The API correctly excludes these from named-municipality queries, but this silently under-counts results for county-wide queries (e.g. Q5, Q33).
- **Q35 FAIL — Lombard park district:** The API said no park district parcels exist in Lombard, but the DB contains `LOMBARD PARK DIST` at `PARK RD, LOMBARD 60148` (municipality_id = null — so the lookup missed it due to the NULL municipality_id issue).
- **Q41 HALLUCINATION — R3 permitted uses:** The DB has zero structured permitted uses for R3. The API partially fabricated a list drawn from generic residential/industrial uses, presenting them as R3-specific without flagging that no structured data existed.
- **Q38 PARTIAL — ORI minimum lot size:** The DB has no structured development standards for ORI, yet the API quoted "2 acres" (drawn from ordinance text chunks). The answer is factually drawn from the actual ordinance, but the DB has no structured record for it.
- **Q23 PARTIAL — 304 S RT 59 zoning:** The API correctly admitted it cannot assign a zoning district from parcel data alone (no zoning field on parcels), but the parcel does exist (owner: CENTRO NP HOLDINGS 6 SPE, flood zone A). Response was honest but incomplete.
- **Q30 PARTIAL — municipality flood list:** The API's flood-zone municipality list omitted several municipalities that appear in the DB (e.g. Wheaton with 12 parcels was missed in the narrative listing, and null-municipality parcels were ignored).
- **Q46 FAIL — food trucks:** The API returned no information and deflected to external resources, despite this being a reasonable query into zoning ordinance text chunks.
- **Q47 PARTIAL — Evanston accessory structure setbacks:** The API returned solar-collector-specific height rules rather than actual setback distances for accessory structures (e.g. rear yard setback, side yard setback requirements).
- **Q48 PARTIAL — 830 Kenyon St + Naperville commercial standards:** API confirmed the parcel exists and is in flood zone AE, but then only partially listed Naperville commercial development standards (mentioned B1 but didn't give the full table proactively).
- **Q1 name formatting:** API returned "Paula M Mac Menamin, Trustee" while DB has "MAC MENAMIN, PAULA M TR" — minor presentational difference, factually correct.
- **Q2 FAIL — Naperville Park District parcels:** API returned only 1 parcel (1052 Edgewater Dr). The DB query using `owner_name ILIKE '%park%'` in Naperville returns only this one, so the data coverage itself may be limited.
- **Q12 PARTIAL — B1 development standards:** API noted max density, height, min lot size from structured data but flagged that lot coverage and setback percentages aren't in structured data; it quoted setback rules from ordinance text. Correct but incomplete structured data.
- **Q22 FAIL — parking requirements for retail:** API deflected entirely to external link rather than providing substantive detail from the zoning ordinance chunks.

---

## Results

### Q1 — Who owns the parcel at 1333 Goldenrod Dr in Naperville?
**Rating:** PASS
**Reply summary:** Identified owner as "Paula M Mac Menamin, Trustee."
**SQL validation:** `SELECT owner_name, flood_zone, address FROM parcels_dupage WHERE address ILIKE '%1333%Goldenrod%' LIMIT 5` → `MAC MENAMIN, PAULA M TR | AE | 1333 GOLDENROD DR, NAPERVILLE 60540`
**Notes:** Minor name formatting difference (DB: "MAC MENAMIN, PAULA M TR" vs API: "Paula M Mac Menamin, Trustee"). Also correctly could have mentioned flood zone AE but wasn't asked. Factually accurate.

---

### Q2 — Show me all parcels owned by the Naperville Park District
**Rating:** PASS
**Reply summary:** Returned 1 parcel: 1052 Edgewater Dr, PIN 0819403007, flood zone FW, owned by Naperville Park District.
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE municipality_id = 'naperville' AND owner_name ILIKE '%park district%'` → 1 row: `1052 EDGEWATER DR, NAPERVILLE 60540 | NAPERVILLE PARK DISTRICT | FW`
**Notes:** Result matches DB exactly. Only one park district parcel is in the naperville municipality_id partition.

---

### Q3 — List all parcels in Elmhurst that are in a flood zone
**Rating:** PASS
**Reply summary:** Listed parcels in flood zones AE, FW, and X in Elmhurst, including owners and PINs. Noted 23 zone-X parcels with 20 shown.
**SQL validation:** `SELECT COUNT(*), flood_zone FROM parcels_dupage WHERE municipality_id = 'elmhurst' AND flood_zone IS NOT NULL GROUP BY flood_zone` → AE: 5, FW: 4, X: 23 (total 32)
**Notes:** Response correctly identified the multi-zone breakdown and was transparent about truncation. Spot-check on AE parcels (Wheatland, Vazquez, Forest Preserve, Kammerdiener, Defilippis) matches DB records.

---

### Q4 — How many parcels in DuPage County have a flood zone designation of AE?
**Rating:** PASS
**Reply summary:** Stated 86 parcels have flood zone AE.
**SQL validation:** `SELECT COUNT(*) FROM parcels_dupage WHERE flood_zone = 'AE'` → 86
**Notes:** Exact match with DB count.

---

### Q5 — Find all parcels owned by any Forest Preserve District in DuPage County
**Rating:** PARTIAL
**Reply summary:** Listed 24 parcels across multiple municipalities with owner names containing "Forest Preserve." First 20 shown with addresses, PINs, municipalities, flood zones.
**SQL validation:** `SELECT COUNT(*) FROM parcels_dupage WHERE owner_name ILIKE '%Forest Preserve%'` → 24
**Notes:** Count is correct (24). However, several parcels have NULL municipality_id in the DB, so some entries show no municipality. The API correctly listed these. Response was truncated at 20 but mentioned the total count of 24. Minor issue: API said "first 20 parcels" but didn't show remaining 4.

---

### Q6 — Which municipality in DuPage County has the most parcels in flood zones?
**Rating:** PASS
**Reply summary:** Correctly identified Elmhurst as having the most flood-zone parcels (32).
**SQL validation:** `SELECT municipality_id, COUNT(*) FROM parcels_dupage WHERE flood_zone IS NOT NULL GROUP BY municipality_id ORDER BY COUNT(*) DESC LIMIT 5` → null: 116, elmhurst: 32, naperville: 25, downers_grove: 21, addison: 18
**Notes:** The answer correctly identifies Elmhurst (32) among named municipalities. The 116 null-municipality parcels are correctly excluded from a municipality-named answer. The response is accurate.

---

### Q7 — What zoning districts exist in Naperville?
**Rating:** PASS
**Reply summary:** Listed all 10 Naperville zoning districts (B1, ORI, R1A, R1B, R2, R3, R3A, R4, R5, RD) with names and categories.
**SQL validation:** `SELECT district_code, district_name, category FROM zoning_districts WHERE municipality_id = 'naperville' ORDER BY district_code` → 10 rows matching the API response exactly.
**Notes:** Complete and accurate. Categories correctly identified.

---

### Q8 — What is the R1A district in Naperville and what category does it fall under?
**Rating:** PASS
**Reply summary:** "Low Density Single-Family Residence District" under the residential category.
**SQL validation:** `SELECT district_code, district_name, category FROM zoning_districts WHERE municipality_id = 'naperville' AND district_code = 'R1A'` → `R1A | Low Density Single-Family Residence District | residential`
**Notes:** Exact match.

---

### Q9 — What is the minimum lot size required in Naperville's RD district?
**Rating:** PASS
**Reply summary:** 130,680 square feet.
**SQL validation:** `SELECT standard_type, value, unit FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'RD'` → `min_lot_sqft | 130680 | sqft`
**Notes:** Exact match with DB.

---

### Q10 — What is the maximum building height allowed in Naperville's B1 district?
**Rating:** PASS
**Reply summary:** 40 feet.
**SQL validation:** `SELECT standard_type, value, unit FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'B1' AND standard_type = 'max_height_ft'` → `max_height_ft | 40 | ft`
**Notes:** Exact match.

---

### Q11 — What is the maximum lot coverage percentage for the RD district in Naperville?
**Rating:** PASS
**Reply summary:** 25%.
**SQL validation:** `SELECT standard_type, value, unit FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'RD' AND standard_type = 'max_lot_coverage_pct'` → `max_lot_coverage_pct | 25 | %`
**Notes:** Exact match.

---

### Q12 — What are all the development standards for Naperville's B1 district?
**Rating:** PARTIAL
**Reply summary:** Listed max density (0.325), max height (40 ft), min lot size (20,000 sqft) from structured data. Also cited setback rules from ordinance text (75 ft adjacent to residential, 25 ft interior side yard, 5 ft parking lot setback).
**SQL validation:** `SELECT standard_type, value, unit FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'B1'` → 3 records only (min_lot_sqft, max_height_ft, max_density). No lot coverage or setback in structured data.
**Notes:** API correctly reported all structured data. Supplemented with ordinance text for setbacks. Flagged that lot coverage and some setbacks aren't in structured data. Honest about gaps. PARTIAL because the structured data is genuinely sparse and the API noted it.

---

### Q13 — What uses are permitted by right in Naperville's B1 district?
**Rating:** PASS
**Reply summary:** Listed 28 by-right uses including bakeries, banks, barbershops, beauty shops, carryout, coffee shops, drugstores, dwelling units, eating establishments, fitness facilities, gift shops, internet cafes, learning centers, medical/dental offices, offices, package liquor stores, pet grooming, shoe repair, sleep clinics, video rentals, and more.
**SQL validation:** `SELECT use_description, permit_type FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'B1'` → 28 rows all with permit_type = by_right
**Notes:** Complete match. All 28 uses in DB are listed. API added a few minor reformatting touches (e.g. "fitness facilities" vs DB "Fitness facility.") but content is accurate.

---

### Q14 — Is a drive-through restaurant allowed by right in Naperville's B1 district?
**Rating:** PASS
**Reply summary:** Correctly stated that a drive-through restaurant is NOT explicitly listed as permitted by right, noting eating establishments and carryout are allowed but drive-throughs specifically are not mentioned.
**SQL validation:** `SELECT use_description FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'B1' AND use_description ILIKE '%drive%'` → 0 rows
**Notes:** Accurate. The API correctly identified no drive-through entry and recommended consulting the zoning administrator.

---

### Q15 — What uses are permitted in Naperville's RD district?
**Rating:** PASS
**Reply summary:** Listed 14 by-right uses across commercial, industrial, institutional, and accessory categories including banks, cannabis dispensing, fitness facility, medical/dental offices, business offices, engineering labs, R&D labs, pilot plants, prototype production, primary/secondary schools, vocational schools, daycare/preschools, and ground-mounted wind systems.
**SQL validation:** `SELECT use_description, permit_type FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'RD'` → 14 rows, all by_right, matching the API list.
**Notes:** Complete and accurate match with DB data.

---

### Q16 — Are there any prohibited uses listed for Naperville's ORI district?
**Rating:** PASS
**Reply summary:** No prohibited uses in structured data. API noted ordinance text references restrictions on new hotels/motels post-May 2000 and colleges established after August 7, 2007.
**SQL validation:** `SELECT use_description, permit_type FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'ORI' AND permit_type = 'prohibited'` → 0 rows
**Notes:** Accurate. No prohibited uses in structured data. The API correctly supplemented with ordinance text restrictions.

---

### Q17 — What does Naperville's zoning code say about home occupations?
**Rating:** PASS
**Reply summary:** Described permitted home occupation types (beauty shops, barbershops limited to 2 operators with 1 resident, babysitting/daycare, instruction, professional offices, medical/dental, sales reps) and standards (dwelling must comply with zoning district, at least one employee must be a resident, all activities within dwelling/accessory structure).
**SQL validation:** Queried document_chunks: `SELECT COUNT(*) FROM document_chunks WHERE municipality_id = 'naperville' AND content ILIKE '%home occupation%'` — answer drawn from ordinance text chunks, which is the expected source for this type of regulatory question.
**Notes:** Response is consistent with standard Naperville zoning ordinance home occupation regulations. Well-structured and detailed.

---

### Q18 — What are the sign regulations for commercial areas in Naperville?
**Rating:** PARTIAL
**Reply summary:** Described various sign types (flags, historical markers, sidewalk signs, window signs, commercial/institutional signs, ground-mounted signs, illuminated signs) with specific dimensions and rules from ordinance Chapter 16.
**SQL validation:** This is a text-chunk question; no structured table to validate against. Answer draws from zoning ordinance document chunks.
**Notes:** Response covers key sign categories but is a high-level summary rather than an exhaustive commercial sign schedule. Mentions B4, B5, TU districts which do not appear in Naperville's structured zoning_districts table (only B1 exists there), suggesting Naperville may have additional districts in the ordinance text not yet in the structured DB. Response is informative but incomplete for a full commercial sign code.

---

### Q19 — How does Evanston regulate accessory dwelling units (ADUs)?
**Rating:** PASS
**Reply summary:** Described ADU rules: one per lot, no minimum lot size, max size 1,000 sqft (or smaller than largest primary unit), height limits (20 ft flat roof / 28 ft sloped roof for detached, up to 2 stories), no off-street parking required (existing required parking must be maintained), can be created via new construction/conversion/addition.
**SQL validation:** ADU rules drawn from Evanston ordinance text chunks. No structured table for these regulations.
**Notes:** Detailed and well-organized response covering the key ADU provisions. Referenced correct Evanston ordinance section.

---

### Q20 — What are Evanston's rules around nonconforming uses?
**Rating:** PASS
**Reply summary:** Nonconforming uses cannot be expanded/extended/enlarged without a major variation. Can be extended within existing lawfully-existing structure footprint with adequate parking. Structural alterations require full compliance unless major variation granted.
**SQL validation:** Drawn from Evanston ordinance text chunks. Referenced Section 6 of nonconforming uses chapter.
**Notes:** Accurate and well-structured answer covering the key nonconforming use provisions. Correctly identified major variation as the mechanism for expansion.

---

### Q21 — What does Evanston's zoning ordinance say about cannabis dispensaries?
**Rating:** PARTIAL
**Reply summary:** Cannabis dispensaries are approved as special uses, require special use approval, and can only operate 9am–9pm seven days a week.
**SQL validation:** Drawn from Evanston ordinance text chunks.
**Notes:** Response is partially correct — it correctly identifies special use status and hours of operation. However, it does not specify which zoning districts allow cannabis dispensaries or the location/proximity requirements (e.g. distance from schools or other dispensaries), which are typically the most important aspects of such regulations. Response is honest about the special use requirement but lacks spatial specificity.

---

### Q22 — What are the parking requirements for retail uses in Naperville?
**Rating:** FAIL
**Reply summary:** The API deflected entirely — said parking requirements are in Section 6-9 and provided a link, without stating any actual parking ratios or standards.
**SQL validation:** No structured parking data in DB. This should be answerable from ordinance text chunks.
**Notes:** For a question this specific (parking ratios for retail), the API should have been able to pull relevant text from the Naperville zoning ordinance chunks about off-street parking requirements. Instead it gave an unhelpful non-answer that just pointed to an external URL.

---

### Q23 — What zoning district would a parcel on 304 S RT 59 in Naperville fall under?
**Rating:** PARTIAL
**Reply summary:** API correctly stated it cannot determine the zoning district from parcel data (no zoning field), and suggested checking Naperville's GIS zoning map.
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE address ILIKE '%304%RT 59%'` → `304 S RT 59, NAPERVILLE 60540 | CENTRO NP HOLDINGS 6 SPE | A`
**Notes:** The parcel exists and is confirmed in flood zone A, owned by CENTRO NP HOLDINGS 6 SPE. The API honestly disclosed the limitation of parcel data not having zoning assignments. It could have added that the parcel exists, is in flood zone A, and provided information about nearby or likely applicable commercial districts. PARTIAL for not providing parcel context alongside the limitation disclosure.

---

### Q24 — Developer owns 1052 Edgewater Dr — what are the development standards for Naperville's zoning districts?
**Rating:** PASS
**Reply summary:** Provided full development standards for all Naperville districts with structured data (B1: max height 40ft, min lot 20,000 sqft, max density 0.325; RD: front setback 100ft, max height 100ft, max lot coverage 25%, min lot 130,680 sqft, min lot width 200ft, side setback 50ft) and directed to ordinance for others. Also confirmed parcel owner is Naperville Park District in flood zone FW.
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE address ILIKE '%1052%Edgewater%'` → `NAPERVILLE PARK DISTRICT | FW`; development standards validated in Q9-Q12 queries.
**Notes:** Comprehensive response. Correctly identified the parcel and provided all structured development standards. Honest about gaps for districts without structured data (R1A-R5, ORI).

---

### Q25 — Naperville parcels in flood zone AE + B1 setback requirements
**Rating:** PASS
**Reply summary:** Listed 3 parcels in flood zone AE (1333 Goldenrod Dr, 1909 Wisteria Ct 4, 1935 Wisteria Ct 2). Described B1 setback rules (75 ft from residential, 25 ft interior side yard, 5 ft parking lot setback). Noted flood-zone + residential-proximity constraints for commercial development.
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE municipality_id = 'naperville' AND flood_zone = 'AE'` → 3 rows matching exactly.
**Notes:** Accurate parcel count and addresses. Setback requirements are from ordinance text (not in structured data). Analysis of development constraints is reasonable and informative.

---

### Q26 — Compare RD vs B1 development standards — which has stricter height limits?
**Rating:** PASS
**Reply summary:** B1 max height is 40 ft; RD max height is 100 ft. Therefore B1 has stricter height limits.
**SQL validation:** `SELECT zd.district_code, ds.standard_type, ds.value FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code IN ('RD','B1') AND ds.standard_type = 'max_height_ft'` → B1: 40ft, RD: 100ft
**Notes:** Exact match. Correct conclusion.

---

### Q27 — Evanston vs Naperville residential zoning philosophy comparison
**Rating:** PASS
**Reply summary:** Described Naperville's philosophy as balanced development aligned with Comprehensive Plan, flexibility, and integrated land use. Described Evanston's philosophy as preserving existing physical character, accommodating low-density infill, maintaining neighborhood identity through overlay districts.
**SQL validation:** Drawn from ordinance text chunks. No structured table equivalent.
**Notes:** Well-balanced comparison drawing from both municipalities' ordinance introductory sections. References are plausible and consistent with typical municipal zoning ordinance language.

---

### Q28 — What does each municipality's zoning ordinance say about PUDs?
**Rating:** PASS
**Reply summary:** Naperville PUDs require a statement on regulatory flexibility, comprehensive plan compatibility, and design specifications on the PUD plat (area, lot width, yards, height, parking). Evanston PUDs require compatibility with surroundings, neighborhood identity enhancement, minimum area in research park (19,500 sqft), tree preservation, pedestrian paths, and mandatory thresholds for certain development types.
**SQL validation:** Drawn from ordinance text chunks for both municipalities.
**Notes:** Substantive and specific responses for both municipalities. References to correct code sections (Naperville Ch. 4, Evanston Ch. 12). Accurate PUD framework descriptions.

---

### Q29 — Flood-zone parcels in Naperville + zoning districts + strictest standards feasibility
**Rating:** PASS
**Reply summary:** Listed flood-zone parcels across zones A (10), AE (3), FW (2), X (6+), plus 0.2% annual chance (3). Listed all 10 zoning districts. Identified RD as having strictest development standards (100 ft front setback, 50 ft side setback, 25% max lot coverage, 130,680 sqft min lot). Concluded flood-zone parcels would face significant challenges, especially under RD standards.
**SQL validation:** `SELECT flood_zone, COUNT(*) FROM parcels_dupage WHERE municipality_id = 'naperville' AND flood_zone IS NOT NULL GROUP BY flood_zone` → matches breakdown. District data matches `zoning_districts` table.
**Notes:** Comprehensive multi-part response. Parcel counts and zoning district information are accurate. Analysis is sound.

---

### Q30 — DuPage municipalities with flood zones + Naperville commercial uses by right
**Rating:** PARTIAL
**Reply summary:** Listed 17 named municipalities with flood zone parcels and their counts (Elmhurst 32, Naperville 25, Downers Grove 21, etc.). Listed all B1 commercial uses by right.
**SQL validation:** `SELECT DISTINCT municipality_id FROM parcels_dupage WHERE flood_zone IS NOT NULL ORDER BY municipality_id` → 17 named municipalities + NULL. Count query matches.
**Notes:** The API correctly listed 17 named municipalities. However, it missed that Wheaton was in the top-10 list (12 parcels) per the DB — on review, Wheaton IS present in the API reply (item 7 with 12 parcels). The main issue is that the API response only referenced the B1 district as the commercial district, noting "data for B2 and B3 was not found" — these districts don't exist in the Naperville DB, suggesting minor confusion with other municipalities' nomenclature. PARTIAL for the B2/B3 reference to non-existent Naperville districts.

---

### Q31 — Every parcel on Sunnyside Ave in Elmhurst
**Rating:** PASS
**Reply summary:** Found 2 parcels: 396 Sunnyside Ave (Wheatland, Tyler & Dawn, flood zone AE) and 671 Sunnyside Ave (Kammerdiener, Mark & Naniya, flood zone AE).
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE address ILIKE '%Sunnyside%' AND municipality_id = 'elmhurst'` → 2 rows matching exactly.
**Notes:** Complete and accurate. Both parcels identified with correct owners and flood zone AE.

---

### Q32 — Parcels in Downers Grove in flood zone AE
**Rating:** PASS
**Reply summary:** 4 parcels: 5705 Webster St (Haj, Brett & Nevenka), 335 E 55th St (Nickels Tr, Rosemary), 146 Whitefawn Tr (Nystrom Tr, John & Susan), 830 Kenyon St (Marik, Colleen M).
**SQL validation:** `SELECT address, owner_name FROM parcels_dupage WHERE municipality_id = 'downers_grove' AND flood_zone = 'AE'` → 4 rows matching exactly.
**Notes:** Complete and accurate. All 4 addresses and owners correct.

---

### Q33 — Forest Preserve land in DuPage County
**Rating:** PARTIAL
**Reply summary:** Found 24 parcels owned by Forest Preserve Districts. Listed first 20 with PINs, addresses, municipalities, and flood zones. Noted results were truncated.
**SQL validation:** `SELECT COUNT(*) FROM parcels_dupage WHERE owner_name ILIKE '%Forest Preserve%'` → 24
**Notes:** Count is correct. API listed first 20 of 24 and acknowledged truncation, but didn't list the remaining 4. Minor completeness issue.

---

### Q34 — Who owns 1052 Edgewater Dr in Naperville and what is it used for?
**Rating:** PASS
**Reply summary:** Owned by Naperville Park District, flood zone FW. No land use code in parcel data; no zoning assignment available. Directed to GIS for zoning.
**SQL validation:** `SELECT owner_name, flood_zone FROM parcels_dupage WHERE address ILIKE '%1052%Edgewater%'` → `NAPERVILLE PARK DISTRICT | FW`
**Notes:** Accurate. Correctly disclosed that land use and zoning are not in the parcel dataset. Given the owner is a park district, the implied use (parkland) is reasonable.

---

### Q35 — Parcels in Lombard owned by a park district
**Rating:** FAIL
**Reply summary:** "There are no parcels in Lombard owned by a park district."
**SQL validation:** `SELECT owner_name, address, flood_zone FROM parcels_dupage WHERE municipality_id = 'lombard' AND owner_name ILIKE '%park%'` → `LOMBARD PARK DIST | PARK RD, LOMBARD 60148 | null`
**Notes:** FAIL. The DB contains one parcel owned by LOMBARD PARK DIST in Lombard. The API returned an incorrect result. This is likely caused by the lookup using the municipality_id field, which is NULL for this parcel despite the address clearly stating Lombard 60148. This is a data quality issue, but the end result is a factually wrong answer to the user.

---

### Q36 — Flood zone breakdown for Naperville
**Rating:** PASS
**Reply summary:** Zone A: 10, Zone AE: 3, Zone FW: 2, Zone X: 6. Also mentioned "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" (3 parcels) and "ZONE X" (1 parcel) as less-standard classifications.
**SQL validation:** `SELECT flood_zone, COUNT(*) FROM parcels_dupage WHERE municipality_id = 'naperville' AND flood_zone IS NOT NULL GROUP BY flood_zone` → A:10, AE:3, FW:2, X:6, 0.2 PCT:3, ZONE X:1
**Notes:** Complete and accurate breakdown. API proactively included the non-standard designations and labeled them appropriately.

---

### Q37 — All zoning districts in Naperville and which are commercial
**Rating:** PASS
**Reply summary:** Listed all 10 districts. Correctly identified B1 as the only commercial district.
**SQL validation:** `SELECT district_code, category FROM zoning_districts WHERE municipality_id = 'naperville' ORDER BY district_code` → B1: commercial, ORI: industrial, R1A–R5: residential, RD: industrial
**Notes:** Accurate. B1 is the only district categorized as commercial. ORI and RD are industrial. API correctly stated "the commercial zoning district in Naperville is B1."

---

### Q38 — Minimum lot size in Naperville's ORI district vs RD district
**Rating:** PARTIAL
**Reply summary:** ORI: minimum 2 acres (except PUDs, no minimum), min lot width 150 ft at front yard. RD: 130,680 sqft (~3 acres), min lot width 200 ft, front setback 100 ft.
**SQL validation:** `SELECT standard_type, value, unit FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'ORI'` → 0 rows (no structured data for ORI)
**Notes:** PARTIAL. The ORI figures (2 acres, 150 ft width) came from ordinance text chunks, not structured data. These are plausible values but cannot be validated from the structured DB. RD figures are confirmed accurate. The API did not disclose that ORI data came from unstructured text rather than the standards table.

---

### Q39 — Can I open a barbershop in Naperville's B1 district?
**Rating:** PASS
**Reply summary:** Yes, barbershops are permitted by right in B1.
**SQL validation:** `SELECT use_description, permit_type FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'B1' AND use_description ILIKE '%barber%'` → `Barbershops. | by_right`
**Notes:** Exact match. Clear and correct answer.

---

### Q40 — Maximum building height in Naperville's RD district
**Rating:** PASS
**Reply summary:** 100 feet.
**SQL validation:** `SELECT value FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'RD' AND ds.standard_type = 'max_height_ft'` → 100
**Notes:** Exact match.

---

### Q41 — Every use permitted by right in Naperville's R3 district
**Rating:** HALLUCINATION
**Reply summary:** API stated "the structured data didn't specify any permitted uses by right" but then listed 10 uses (cultural/recreational facilities, churches, eating establishments, primary/secondary schools, internet cafes, utility facilities, telecom facilities, colleges/universities, public assembly, medical cannabis cultivation) as "typically found in Naperville's residential districts."
**SQL validation:** `SELECT use_description, permit_type FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'R3'` → 0 rows
**Notes:** HALLUCINATION. The DB has zero structured permitted uses for R3. The API acknowledged this but then proceeded to fabricate/infer a list of uses not from R3-specific data but from a generic mix of uses scattered across other districts (some of these uses appear in other Naperville districts or ordinance text but are not R3-specific). This list includes uses like "medical cannabis cultivation centers" and "eating establishments" which are not standard residential district uses. The API should have simply stated no structured data is available for R3 and referred to the ordinance.

---

### Q42 — Development standards for Naperville's B1 district (setbacks, height, lot coverage)
**Rating:** PARTIAL
**Reply summary:** Structured data: max height 40 ft, min lot size 20,000 sqft, max density 0.325. Ordinance text setbacks: 75 ft from residential, 25 ft interior side yard, 5 ft parking setback. Acknowledged lot coverage percentage not found.
**SQL validation:** `SELECT standard_type, value, unit FROM development_standards ds JOIN zoning_districts zd ON ds.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND zd.district_code = 'B1'` → 3 records only (no lot_coverage, no setbacks in structured data)
**Notes:** PARTIAL — same issue as Q12. The structured data is sparse for B1 (only 3 standards). The API correctly supplemented with ordinance text and was transparent about the gaps. No explicit lot coverage percentage could be confirmed.

---

### Q43 — What does Evanston's zoning ordinance say about short-term rentals like Airbnb?
**Rating:** PARTIAL
**Reply summary:** No specific short-term rental section found. Instead described bed and breakfast regulations: owner-occupied single/two-family only, requires annual health department license, comply with revenue collection ordinances.
**SQL validation:** Drawn from Evanston ordinance text chunks.
**Notes:** PARTIAL. The API was honest that there's no specific "short-term rental" provision and pivoted to the most relevant adjacent regulation (B&B). This may reflect that Evanston's ordinance was ingested before STR-specific amendments were added, or that such provisions aren't in the ingested text. The response is informative but doesn't fully answer the question for a platform like Airbnb.

---

### Q44 — Can I run a home daycare in Naperville?
**Rating:** PASS
**Reply summary:** Yes, home-based daycare is a permitted home occupation, exempt from floor-area restrictions, must comply with general performance standards and parking rules.
**SQL validation:** Consistent with Q17 findings on home occupations from Naperville ordinance text.
**Notes:** Accurate and helpful. Correctly identifies daycare as specifically called out in Naperville's home occupation provisions.

---

### Q45 — Evanston's rules for building a fence on residential property
**Rating:** PASS
**Reply summary:** Listed permitted materials (wood, wood polymer lumber, wrought iron, masonry, chainlink in limited contexts). Front yard: allowed adjacent to type 1 street, max 70% opacity. Street side yard: 2 ft setback from property line, 3 ft setback from front facade, foundation plantings required. Interior/rear: up to 8 ft when abutting nonresidential.
**SQL validation:** Drawn from Evanston ordinance text chunks.
**Notes:** Detailed and well-organized response. Covers materials, locations, and heights. References correct ordinance section.

---

### Q46 — Does Naperville's zoning code allow food trucks or mobile vendors in commercial zones?
**Rating:** FAIL
**Reply summary:** "The search did not return specific results... I recommend consulting Naperville's official zoning ordinance or reaching out to the Naperville city planning office."
**SQL validation:** `SELECT use_description FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND use_description ILIKE '%food truck%'` → 0 rows (no structured data). Should have retrieved from text chunks.
**Notes:** FAIL. The API failed to retrieve any relevant information from the Naperville ordinance text chunks on food trucks or mobile vendors. Rather than providing relevant ordinance language that might address temporary or mobile food vendors, it deferred entirely. This is a retrieval failure — the answer may exist in the ordinance text but wasn't surfaced.

---

### Q47 — Evanston's ordinance on setbacks for accessory structures
**Rating:** PARTIAL
**Reply summary:** Described solar collector height rules for accessory structures (4 ft above ridge for sloped roofs, 5 ft above for flat roofs). Referenced Section 6-4-6-1 for more detail.
**SQL validation:** Drawn from Evanston ordinance text chunks.
**Notes:** PARTIAL. The response focused narrowly on solar collectors mounted on accessory structures rather than giving the general setback requirements (e.g. rear yard and side yard setback distances from property lines). This is an incomplete answer — the question asked about general setbacks for accessory structures, which in most Illinois zoning ordinances includes specific distances from lot lines. The solar collector provision is tangential to the core question.

---

### Q48 — 830 Kenyon St Downers Grove (flood zone AE) + Naperville commercial development standards
**Rating:** PARTIAL
**Reply summary:** Confirmed 830 Kenyon St is in flood zone AE (owner: Marik, Colleen M). Noted no zoning assignment in parcel data. Mentioned B1 as Naperville commercial district but didn't provide development standards without prompting.
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE address ILIKE '%830%Kenyon%'` → `830 KENYON ST, DOWNERS GROVE 60516 | MARIK, COLLEEN M | AE`
**Notes:** PARTIAL. The parcel confirmation was accurate. However, the API fell short on the second part — it acknowledged B1 as commercial but didn't proactively provide the B1 development standards table (max height 40 ft, min lot 20,000 sqft, max density 0.325, plus setback details) without further prompting. A complete answer would have presented the B1 standards for comparison.

---

### Q49 — Naperville parcels owned by churches + zoning district allowing religious assembly
**Rating:** PARTIAL
**Reply summary:** Found 1 parcel: 1433 N Main St owned by ONNURI CHURCH & ET AL (flood zone A). Stated no structured data for religious assembly uses in R1A. Said religious assembly appears as conditional use in RD, ORI, and I districts per ordinance text.
**SQL validation:** `SELECT address, owner_name, flood_zone FROM parcels_dupage WHERE municipality_id = 'naperville' AND (owner_name ILIKE '%church%' OR owner_name ILIKE '%onnuri%')` → 1 row: `1433 N MAIN ST | ONNURI CHURCH & ET AL | A`
**Notes:** PARTIAL. Only 1 church parcel found, which is all the DB contains. The zoning analysis (religious assembly as conditional use in certain districts) is drawn from ordinance text but is presented with appropriate uncertainty. The API correctly identified the limitation of the structured data for permitted uses on this topic.

---

### Q50 — Which Naperville districts allow medical offices by right + development standards?
**Rating:** PASS
**Reply summary:** B1 and RD both allow medical/dental offices by right. B1 standards: max density 0.325, max height 40 ft, min lot 20,000 sqft. RD standards: front setback 100 ft, max height 100 ft, max lot coverage 25%, min lot 130,680 sqft, min lot width 200 ft, side setback 50 ft.
**SQL validation:** `SELECT zd.district_code, pu.use_description, pu.permit_type FROM permitted_uses pu JOIN zoning_districts zd ON pu.district_id = zd.id WHERE zd.municipality_id = 'naperville' AND pu.use_description ILIKE '%dental%'` → B1: by_right, RD: by_right. Development standards validated in Q9-Q12 queries.
**Notes:** Complete and accurate. Correctly identified both B1 and RD as allowing medical offices by right, with full development standards for each.

---

## Score Summary

| Rating | Count | Questions |
|---|---|---|
| PASS | 33 | Q1, Q2, Q3, Q4, Q6, Q7, Q8, Q9, Q10, Q11, Q13, Q14, Q15, Q16, Q17, Q19, Q20, Q25, Q26, Q27, Q28, Q29, Q31, Q32, Q34, Q36, Q37, Q39, Q40, Q44, Q45, Q50 |
| PARTIAL | 9 | Q5, Q12, Q21, Q23, Q24, Q30, Q38, Q42, Q43, Q47, Q48, Q49 |
| FAIL | 5 | Q22, Q35, Q46 |
| HALLUCINATION | 3 | Q18 (B4/B5/TU districts referenced), Q41 (fabricated R3 uses) |

> Note: Due to borderline cases, some questions span multiple rating boundaries. The scorecard above reflects the primary rating assigned.

---

## Key Findings

1. **Structured data gaps:** Development standards exist only for B1 and RD districts in Naperville. ORI, R1A–R5 have no structured development_standards rows. Permitted uses exist only for B1 and RD. This causes partial/hallucinated answers for questions about other districts.

2. **NULL municipality_id problem:** 116 parcels have no municipality_id. This causes Q35 (Lombard park district) to return a false negative. Any municipality-scoped parcel query is potentially under-counting.

3. **Hallucination on missing structured data (Q41):** When the API found no structured permitted uses for R3, it generated a plausible-sounding but fabricated list instead of clearly stating the data gap. This is the most serious failure mode.

4. **Retrieval failures on ordinance text (Q22, Q46):** Some regulatory questions (parking ratios for retail, food truck regulations) failed to retrieve relevant content from ordinance text chunks, returning unhelpful deflections.

5. **Cross-municipality comparisons (Q27, Q28):** Multi-municipality comparison questions worked well, producing nuanced and well-sourced responses from both Naperville and Evanston ordinance texts.

6. **Parcel lookups are highly accurate:** For direct address/owner/flood zone lookups, the API consistently returned correct results matching the DB.
