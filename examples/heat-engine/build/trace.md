# heat-engine 1.2.0-slice: trace

| requirement | examples | evidence rows | properties | static | suite cases | decisions | backed by more than the oracle |
|---|---|---|---|---|---|---|---|
| REQ-IF-004 | 2 | 0 | 0 | 0 | 2 | — | yes |
| REQ-IF-006 | 2 | 0 | 0 | 0 | 2 | D-007 | yes |
| REQ-IF-007 | 11 | 0 | 0 | 0 | 11 | D-019, D-024 | yes |
| REQ-IF-008 | 1 | 0 | 0 | 0 | 1 | — | yes |
| REQ-CJ-005 | 4 | 0 | 1 | 0 | 5 | D-017 | yes |
| REQ-AU-001 | 1 | 0 | 1 | 0 | 2 | D-001, D-003 | yes |
| REQ-AU-002 | 1 | 0 | 0 | 0 | 1 | D-007 | yes |
| REQ-WB-001 | 4 | 38 | 5 | 0 | 47 | D-009, D-018 | yes |
| REQ-WB-002 | 2 | 22 | 0 | 0 | 24 | — | yes |
| REQ-WB-003 | 6 | 0 | 2 | 0 | 8 | D-001 | yes |
| REQ-WB-004 | 5 | 0 | 0 | 0 | 5 | D-007, D-019 | yes |
| REQ-WB-005 | 6 | 0 | 1 | 0 | 7 | D-010, D-025 | yes |
| REQ-FL-001 | 7 | 20 | 2 | 0 | 29 | D-010 | yes |
| REQ-FL-002 | 5 | 0 | 1 | 0 | 6 | D-001 | yes |
| REQ-FL-003 | 1 | 0 | 0 | 0 | 1 | D-007 | yes |
| REQ-FL-004 | 4 | 0 | 1 | 0 | 5 | D-010 | yes |
| REQ-FL-005 | 2 | 0 | 1 | 0 | 3 | D-001 | yes |
| REQ-FL-006 | 1 | 0 | 0 | 0 | 1 | D-007 | yes |
| REQ-BU-001 | 0 | 0 | 0 | 1 | 1 | — | yes |
| REQ-BU-002 | 0 | 0 | 0 | 1 | 1 | — | yes |
| REQ-BU-003 | 0 | 0 | 0 | 2 | 2 | — | yes |
| REQ-BU-004 | 0 | 0 | 0 | 1 | 1 | — | yes |

| edge | bound to | suite cases |
|---|---|---|
| number-text/ecmascript | canonical.value | 23 |
| fixed-text/ecmascript | not bound | 0 |
| json/sorted-utf16 | canonical.value | 19 |

| evidence | kind | rows | waived | supports | source |
|---|---|---|---|---|---|
| EV-WB-FIXTURES | computed | 38 | 0 | REQ-WB-001 | HeatCompass/heat-engine-spec at f621520, spec/tier1-foundation/wet-bulb.fixtures.csv, written by its scripts/build-fixtures.py (Python, not this spec's oracle) |
| EV-WB-EXTENDED | computed | 22 | 0 | REQ-WB-002 | evidence/make-extended.py, which runs stull() copied unchanged from HeatCompass/heat-engine-spec's scripts/build-fixtures.py at f621520 (Python, not this spec's oracle) |
| EV-FL-FIXTURES | derived | 20 | 0 | REQ-FL-001 | HeatCompass/heat-engine-spec at f621520, spec/tier1-foundation/flag-mapping.fixtures.csv |

Open (never tested): OPEN-IF-001, OPEN-IF-002, OPEN-IF-003, OPEN-IF-005, OPEN-CJ-001, OPEN-WB-001, OPEN-WB-002, OPEN-FL-001

Total suite cases: 206 (65 example, 5 static, 80 evidence, 42 edge, 14 property), plus 3 protocol cases in every run.
