# heat-engine 1.0.2-slice: trace

| requirement | examples | suite cases | decisions |
|---|---|---|---|
| REQ-IF-004 | 2 | 2 | — |
| REQ-IF-006 | 2 | 2 | D-007 |
| REQ-IF-007 | 11 | 11 | D-019, D-024 |
| REQ-IF-008 | 1 | 1 | — |
| REQ-CJ-005 | 2 | 2 | D-017 |
| REQ-AU-001 | 1 | 1 | D-001, D-003 |
| REQ-AU-002 | 1 | 1 | D-007 |
| REQ-WB-001 | 4 | 4 | D-009, D-018 |
| REQ-WB-002 | 2 | 2 | — |
| REQ-WB-003 | 6 | 6 | D-001 |
| REQ-WB-004 | 5 | 5 | D-007, D-019 |
| REQ-WB-005 | 4 | 4 | D-010 |
| REQ-FL-001 | 7 | 7 | D-010 |
| REQ-FL-002 | 4 | 4 | D-001 |
| REQ-FL-003 | 1 | 1 | D-007 |
| REQ-FL-004 | 4 | 4 | D-010 |
| REQ-FL-005 | 2 | 2 | D-001 |
| REQ-FL-006 | 1 | 1 | D-007 |

| edge | bound to | suite cases |
|---|---|---|
| number-text/ecmascript | canonical.value | 23 |
| fixed-text/ecmascript | not bound | 0 |
| json/sorted-utf16 | canonical.value | 19 |

Open (never tested): OPEN-IF-001, OPEN-IF-002, OPEN-IF-003, OPEN-IF-005, OPEN-CJ-001, OPEN-WB-001, OPEN-WB-002, OPEN-FL-001

Total suite cases: 102, plus 3 protocol cases in every run.
