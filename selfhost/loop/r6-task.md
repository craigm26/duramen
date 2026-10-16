# Write a test suite for duramen-core

This folder holds two files, SPEC.md and DECISIONS.md. Together they specify duramen-core, a
program that is judged only through a driver that speaks the protocol under "Driver protocol" in
SPEC.md. No implementation of it is in this folder, and you must not write one. Your job is to
write a suite of test cases that every correct implementation passes and that catches
implementations that misread the specification.

## Rules

1. Use only SPEC.md and DECISIONS.md. Do not search the web, fetch anything, install anything,
   or read outside this folder. If you recognize this program, do not use anything you remember
   of it; use only these two files.
2. Assert only what the two files decide. Never assert anything an `OPEN-` item leaves open,
   such as the text of a message or the column a diagnostic points at. When the files decide
   part of a response and not the rest, check only that part (see `checks` below).
3. Work out every expected value from the files yourself. Do not write an implementation of
   duramen-core, in whole or in part, to compute expected values. You may write small scripts
   that check the format of your own file.
4. Never stop to ask a question. Where the files are silent, vague or contradictory, leave that
   point out of the suite and write it down in NOTES.md.

## What to produce

`outside-suite.jsonl` in this folder: one JSON object per line, one test case per object, in
one of two forms.

**A single request:**

    {"name": "<unique name>", "line": "<the request line exactly as sent, without its line ending>", "expect": <expectation>, "cites": ["<ID or section>", ...]}

where `<expectation>` is one of:

- `{"response": <object>}`: the whole response the driver must write for this line, compared
  as a JSON value (members in any order, numbers compared exactly);
- `{"checks": [{"path": "<path>", "value": <JSON value>}, ...]}`: values the response must
  have at these paths. A path is read in the response as SPEC.md reads a path in an answer
  (REQ-JU-002): names separated by dots, each naming a member of an object or an element of an
  array, as in `result.cases.0.id`, `result.errors` or `error`. Use this when the files decide
  only part of the response.

**A session** of several lines sent to one driver process, for what the driver protocol says
about the stream itself:

    {"name": "<unique name>", "session": ["<line>", ...], "expect": {"responses": [<object>, ...], "exit": <status>}, "cites": ["<ID or section>", ...]}

where `responses` is every line the driver must write, in order, each compared as a JSON value,
and `exit` is its exit status (leave `exit` out to leave the status unchecked).

How the cases are run: each case starts the driver afresh, in the implementation's own folder,
and sends its line or lines as given, each followed by LF, then closes standard input. A request
carries the texts of its record's files inside it, as REQ-RQ-001 says, so no file of the record
is on disk. When a record needs an oracle, such as `fixtures/echo.mjs`, put that file's text,
from the Files section of SPEC.md, into the request's `files`, as the specification's own
examples do.

`cites` names what decides the expectation: requirement IDs (`REQ-...`), decisions (`D-...`),
or a section heading such as "Driver protocol" or "Errors".

## What to cover

Write at least 300 cases. Cover every `REQ-` requirement in SPEC.md at least once beyond its own
examples, and the Interface section: the driver protocol, the operations and the order of the
errors. Favor cases on which a careful reader and a careless one would answer differently: edges,
orders, counts, which error wins, the diagnostics a record gets and in what order, and the forms
`judge` rejects. You may include some of the specification's own examples, but most cases should
be new.

## Finish with

- `outside-suite.jsonl`: every line valid JSON in one of the two forms, every name unique.
- `NOTES.md`: how many cases there are and which requirements each group covers, and every
  place where you found the files silent, vague or contradictory and kept the point out of the
  suite.
