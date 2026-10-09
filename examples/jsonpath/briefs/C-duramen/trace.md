# jsonpath 1.0.0: trace

| requirement | examples | evidence rows | properties | static | suite cases | decisions | backed by more than the oracle |
|---|---|---|---|---|---|---|---|
| REQ-RQ-001 | 13 | 0 | 0 | 0 | 13 | — | yes |
| REQ-RQ-002 | 3 | 0 | 0 | 0 | 3 | D-005 | yes |
| REQ-RQ-003 | 8 | 0 | 0 | 0 | 8 | — | yes |
| REQ-RQ-004 | 6 | 0 | 0 | 0 | 6 | — | yes |
| REQ-SY-001 | 18 | 0 | 0 | 0 | 18 | — | yes |
| REQ-SY-002 | 37 | 0 | 0 | 0 | 37 | — | yes |
| REQ-SY-003 | 53 | 0 | 0 | 0 | 53 | — | yes |
| REQ-SY-004 | 19 | 0 | 0 | 0 | 19 | D-002 | yes |
| REQ-SY-005 | 19 | 0 | 0 | 0 | 19 | D-002 | yes |
| REQ-SY-006 | 15 | 0 | 0 | 0 | 15 | — | yes |
| REQ-SY-007 | 43 | 0 | 0 | 0 | 43 | — | yes |
| REQ-SY-008 | 32 | 0 | 0 | 0 | 32 | D-002 | yes |
| REQ-SY-009 | 19 | 0 | 0 | 0 | 19 | D-003 | yes |
| REQ-SY-010 | 21 | 0 | 0 | 0 | 21 | D-004 | yes |
| REQ-SY-011 | 39 | 0 | 0 | 0 | 39 | — | yes |
| REQ-SE-001 | 1 | 52 | 0 | 0 | 53 | — | yes |
| REQ-SE-002 | 12 | 52 | 0 | 0 | 64 | — | yes |
| REQ-SE-003 | 7 | 52 | 0 | 0 | 59 | D-001 | yes |
| REQ-SE-004 | 7 | 52 | 0 | 0 | 59 | — | yes |
| REQ-SE-005 | 29 | 52 | 0 | 0 | 81 | — | yes |
| REQ-SE-006 | 10 | 52 | 1 | 0 | 63 | — | yes |
| REQ-SE-007 | 12 | 52 | 1 | 0 | 65 | D-001 | yes |
| REQ-SE-008 | 6 | 0 | 0 | 0 | 6 | D-001 | yes |
| REQ-SE-009 | 4 | 52 | 0 | 0 | 56 | — | yes |
| REQ-FI-001 | 6 | 52 | 1 | 0 | 59 | — | yes |
| REQ-FI-002 | 7 | 52 | 1 | 0 | 60 | — | yes |
| REQ-FI-003 | 11 | 0 | 0 | 0 | 11 | — | yes |
| REQ-FI-004 | 19 | 0 | 0 | 0 | 19 | — | yes |
| REQ-FI-005 | 21 | 0 | 0 | 0 | 21 | — | yes |
| REQ-FI-006 | 18 | 0 | 0 | 0 | 18 | — | yes |
| REQ-FI-007 | 10 | 0 | 1 | 0 | 11 | — | yes |
| REQ-FN-001 | 6 | 0 | 0 | 0 | 6 | — | yes |
| REQ-FN-002 | 6 | 0 | 0 | 0 | 6 | — | yes |
| REQ-FN-003 | 4 | 0 | 0 | 0 | 4 | — | yes |
| REQ-FN-004 | 9 | 52 | 0 | 0 | 61 | — | yes |
| REQ-FN-005 | 6 | 52 | 0 | 0 | 58 | — | yes |
| REQ-RX-001 | 24 | 0 | 0 | 0 | 24 | — | yes |
| REQ-RX-002 | 9 | 0 | 0 | 0 | 9 | — | yes |
| REQ-RX-003 | 17 | 0 | 0 | 0 | 17 | — | yes |
| REQ-RX-004 | 17 | 0 | 0 | 0 | 17 | — | yes |
| REQ-RX-005 | 12 | 0 | 0 | 0 | 12 | — | yes |
| REQ-RX-006 | 14 | 0 | 0 | 0 | 14 | — | yes |
| REQ-NP-001 | 8 | 0 | 1 | 0 | 9 | — | yes |
| REQ-NP-002 | 18 | 0 | 1 | 0 | 19 | — | yes |
| REQ-BU-001 | 0 | 0 | 0 | 1 | 1 | — | yes |
| REQ-BU-002 | 0 | 0 | 0 | 1 | 1 | — | yes |
| REQ-BU-003 | 0 | 0 | 0 | 2 | 2 | — | yes |
| REQ-BU-004 | 0 | 0 | 0 | 1 | 1 | — | yes |

| evidence | kind | rows | waived | supports | source |
|---|---|---|---|---|---|
| EV-EV-RFC | published | 52 | 9 | REQ-SE-001, REQ-SE-002, REQ-SE-003, REQ-SE-004, REQ-SE-005, REQ-SE-006, REQ-SE-007, REQ-SE-009, REQ-FI-001, REQ-FI-002, REQ-FN-004, REQ-FN-005 | RFC 9535 (rfc-editor.org, rfc9535.txt; its sha256 is pinned in CONFIDENCE-2.md), Tables 3, 5, 6, 7, 9, 12, 15, 16 and 17, transcribed by evidence/rfc-tables.mjs |

Open (never tested): OPEN-OP-001, OPEN-OP-002, OPEN-OP-003, OPEN-OP-004, OPEN-OP-005, OPEN-OP-006, OPEN-OP-007, OPEN-OP-008

Total suite cases: 735 (675 example, 5 static, 52 evidence, 3 property), plus 3 protocol cases in every run.
