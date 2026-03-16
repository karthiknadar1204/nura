# Nura — 50 Test Questions

Questions are grouped by complexity. All are answerable from ingested data:
- **DuPage County ArcGIS**: ~4,000 parcels with address, owner, flood zone
- **Naperville zoning ordinance**: 10 districts, 86 permitted uses, development standards
- **Evanston zoning ordinance**: 19 chapters of full ordinance text (RAG)
- **Spatial features**: 13k flood zone polygons, 681 municipality boundary features

---

## Parcel Lookups (DuPage ArcGIS)

1. Who owns the parcel at 1333 Goldenrod Dr in Naperville?
2. Show me all parcels owned by the Naperville Park District.
3. List all parcels in Elmhurst that are in a flood zone.
4. How many parcels in DuPage County have a flood zone designation of AE?
5. Find all parcels owned by any Forest Preserve District in DuPage County.
6. Which municipality in DuPage County has the most parcels in flood zones?

---

## Zoning District Lookups (Naperville Structured Data)

7. What zoning districts exist in Naperville?
8. What is the R1A district in Naperville and what category does it fall under?
9. What is the minimum lot size required in Naperville's RD (Research and Development) district?
10. What is the maximum building height allowed in Naperville's B1 district?
11. What is the maximum lot coverage percentage for the RD district in Naperville?
12. What are all the development standards for Naperville's B1 district?

---

## Permitted Uses (Naperville Structured Data)

13. What uses are permitted by right in Naperville's B1 (Neighborhood Convenience Shopping Center) district?
14. Is a drive-through restaurant allowed by right in Naperville's B1 district?
15. What uses are permitted in Naperville's RD (Research and Development) district?
16. Are there any prohibited uses listed for Naperville's ORI district?

---

## Ordinance Text Search (RAG — Naperville + Evanston)

17. What does Naperville's zoning code say about home occupations and running a business from a residential property?
18. What are the sign regulations for commercial areas in Naperville?
19. How does Evanston regulate accessory dwelling units (ADUs)?
20. What are Evanston's rules around nonconforming uses — can a nonconforming building be expanded?
21. What does Evanston's zoning ordinance say about cannabis dispensaries and where they're allowed?
22. What are the parking requirements for retail uses in Naperville?

---

## Cross-Data Composable Queries (Parcel + Zoning)

23. What zoning district would a parcel on 304 S RT 59 in Naperville fall under, and what uses are permitted by right there?
24. A developer owns a parcel at 1052 Edgewater Dr in Naperville — what are the development standards for the zoning districts in that municipality?
25. Find all Naperville parcels that are in flood zone AE and tell me what the B1 district's setback requirements are — could a commercial development there face constraints?

---

## Cross-Municipality Comparisons

26. Compare the development standards for Naperville's RD district versus the B1 district — which has stricter height limits?
27. Naperville has R1A, R1B, R2, R3 residential districts and Evanston also has residential districts — how does Evanston describe its residential zoning philosophy compared to Naperville's?
28. Both Naperville and Evanston are in the Chicago metro area — what does each municipality's zoning ordinance say about planned unit developments (PUDs)?

---

## Multi-Layer / Complex Queries

29. Find all parcels in Naperville that are in a flood zone, then tell me what zoning districts exist in Naperville and which of those districts have the strictest development standards — could flood-zone parcels realistically be developed under those standards?
30. List all DuPage County municipalities that have parcels with flood zone designations, then for Naperville specifically show me which zoning districts allow commercial uses by right — I'm looking for flood-adjacent commercial development opportunities.

---

## Conversational / Natural Language Format (Chat-Style)

These questions are in the format you'd send to `POST /chat` as a JSON body.

### Parcel + Flood Queries


```json
{ "message": "Show me every parcel on Sunnyside Ave in Elmhurst — who owns them and are any in a flood zone?" }
```

```json
{ "message": "How many parcels in Downers Grove are in flood zone AE? Give me the addresses." }
```

```json
{ "message": "I'm looking for Forest Preserve land in DuPage County — list all parcels owned by any Forest Preserve District." }
```

```json
{ "message": "Who owns 1052 Edgewater Dr in Naperville and what is that parcel used for?" }
```

```json
{ "message": "Are there any parcels in Lombard owned by a park district?" }
```

```json
{ "message": "Give me a flood zone breakdown for Naperville — how many parcels are in zone A, AE, FW, and X?" }
```

---

### Zoning Lookups

```json
{ "message": "What are all the zoning districts in Naperville and which ones are commercial?" }
```

```json
{ "message": "What is the minimum lot size in Naperville's ORI district and how does it compare to the RD district?" }
```

```json
{ "message": "Can I open a barbershop in Naperville's B1 district? Is it by right or conditional?" }
```

```json
{ "message": "What's the maximum building height allowed in Naperville's RD district?" }
```

```json
{ "message": "List every use that's permitted by right in Naperville's R3 district." }
```

```json
{ "message": "What development standards apply to Naperville's B1 district — setbacks, height, lot coverage?" }
```

---

### Ordinance Text / RAG

```json
{ "message": "What does Evanston's zoning ordinance say about short-term rentals like Airbnb?" }
```

```json
{ "message": "Can I run a home daycare out of my house in Naperville? What does the zoning code say?" }
```

```json
{ "message": "What are Evanston's rules for building a fence or wall on a residential property?" }
```

```json
{ "message": "Does Naperville's zoning code allow food trucks or mobile vendors in commercial zones?" }
```

```json
{ "message": "What does Evanston's ordinance say about building setbacks for accessory structures?" }
```

---

### Cross-Data / Multi-Step

```json
{ "message": "The parcel at 830 Kenyon St in Downers Grove is in flood zone AE — what are the development standards for commercial zoning in Naperville that I could compare against?" }
```

```json
{ "message": "Find all parcels in Naperville owned by a church or religious organization and tell me what zoning district allows religious assembly by right." }
```

```json
{ "message": "I want to open a dental office in Naperville — which zoning districts allow medical offices by right, and what are the development standards for those districts?" }
```

```json
{ "message": "Compare Naperville's R1A and R3 residential districts — which has more permissive development standards for a developer building multifamily housing?" }
```
