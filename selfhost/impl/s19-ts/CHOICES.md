# Choices

Where SPEC.md was silent, ambiguous or (as far as I could tell) self-contradictory, this is
what the implementation does.

## C-1: What makes a request line blank
- Spec reference: Interface, Driver protocol
- Situation: ambiguous
- What I chose: Standard input is split at LF bytes. One trailing CR is removed from each line (so CR LF input works). After that, a line is blank only if it is empty or holds only spaces and tabs. Any other white space (U+00A0, U+3000, a CR in the middle) makes it a non-blank line, which then gets `bad_request`.
- Alternatives: treat every ECMAScript `\s` line as blank; keep the CR and answer `bad_request` for a line holding only `\r`.
- Should the spec pin this? no. It already says this is open, and a judge has no reason to send such lines.

## C-2: Failures of the checker itself
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: Same as the reference. An exception while handling an accepted request gets `{"id": <id>, "error": "internal_error"}`, the stack goes to standard error, and the driver moves on to the next line.
- Alternatives: crash; answer `bad_request`.
- Should the spec pin this? no. It is open on purpose.

## C-3: How long an oracle run may take
- Spec reference: OPEN-RQ-001, REQ-OR-004
- Situation: missing
- What I chose: Each oracle run gets 60 seconds. After that the process is killed with SIGKILL and the run counts as "stopped for taking too long" (T020). Any responses that arrived before that are still used.
- Alternatives: no limit; a limit taken from an environment variable.
- Should the spec pin this? unsure. Records with slow oracles would give different answers on different checkers, but the right number depends on the machine.

## C-4: Where the oracle runs
- Spec reference: REQ-OR-002, OPEN-RQ-003
- Situation: missing
- What I chose: All of the request's files (not only the record's) are written to a new temporary folder. The oracle starts in the subfolder that holds the file with the `oracle` statement, and the folder is deleted afterwards. A name that cannot be written is skipped without a diagnostic. Files are written only when at least one example will be run. The oracle's standard error is discarded.
- Alternatives: write only the record's files; report a failed write.
- Should the spec pin this? no. "The request's files are the folder" already follows from REQ-RQ-001.

## C-5: Statements from the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are recognised as statements (no P002), and their bodies are ignored completely, like the body of an unknown statement. They add nothing to the model.
- Alternatives: give them P002; read their clauses and report P015.
- Should the spec pin this? no. It is open.

## C-6: Where the `duramen` statement may stand
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: Anywhere in the file. The first `duramen` statement in line order is the file's version statement.
- Alternatives: require it to come first.
- Should the spec pin this? no. It is open.

## C-7: P001 everywhere
- Spec reference: REQ-SY-001, REQ-SY-002
- Situation: ambiguous
- What I chose: A non-blank line whose indentation holds anything other than spaces gets P001 wherever it is. That includes the ignored body of an unknown statement and the lines before the first statement (P001 there, not P003). I read "P001 ... and is otherwise ignored" as a check on lines that runs before statements are read.
- Alternatives: no P001 inside the body of an unknown statement, since that body "MUST be ignored".
- Should the spec pin this? yes. Both readings are reasonable, and the two give different diagnostics.

## C-8: Lines indented one space in an ignored body
- Spec reference: REQ-SY-002, REQ-SY-003
- Situation: ambiguous
- What I chose: Inside the body of an unknown statement (or one from the rest of the language), a line indented one space gets nothing. The body is ignored.
- Alternatives: P007 there too.
- Should the spec pin this? unsure. It is the same question as C-7, and it would be good to answer both the same way.

## C-9: A statement with no ID
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `section`, `req`, `open` or `decision` with nothing after the keyword gets P005. The title is missing too, so the ID problem is folded into the title problem and no separate diagnostic is given.
- Alternatives: a P005 and a second diagnostic for the ID.
- Should the spec pin this? yes. A record can easily contain this mistake.

## C-10: `#` lines under clauses that take lines
- Spec reference: REQ-SY-003, REQ-SY-005, REQ-SY-008, REQ-SY-010, REQ-SY-012
- Situation: ambiguous
- What I chose: Under an example or a table, a line starting with `#` at any indent of 3 or more is a comment. The exception is the text of an `input` line, where lines indented six or more are text, `#` included. Under a `text` clause, a line indented three gets P008 even when it starts with `#`. Under an `errors` clause, a line indented three gets P006 even when it starts with `#`, because every line under such a clause is part of its condition.
- Alternatives: comments only at indent 4 under examples, and P006 for `#` at 3 or 5.
- Should the spec pin this? yes. "neither blank nor a comment" does not say at which indents a comment may stand.

## C-11: A `from` name that is not a JSON string
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: An `input` line is the `from` form only when it ends with `from` and a quoted string that parses as a JSON string. Otherwise, as with `input a from "\q"`, the whole rest is the path, which then gets P049, and the lines indented six after it are taken as its text.
- Alternatives: treat any `"…"` ending as the `from` form and give P048 or P049 for a bad string.
- Should the spec pin this? unsure. It only changes things when a P006 would follow.

## C-12: A `from` name that climbs above the request's files
- Spec reference: REQ-SY-011, D-012
- Situation: ambiguous
- What I chose: The name is resolved from the example file's folder. A `..` that would climb above the folder holding all the request's files makes the name leave the record, so it gets P048, even if later parts would come back down. Otherwise only the final location matters: it must be one of the request's files inside the record's folder.
- Alternatives: P048 whenever any step leaves the record's folder.
- Should the spec pin this? yes. "a name that leaves the record's folder" can mean the path taken or the place it ends up.

## C-13: `from` files that are not part of the record
- Spec reference: REQ-SY-011, REQ-RC-001
- Situation: ambiguous
- What I chose: Any request file inside the record's folder can be read, including files the record itself leaves out (under `build/`, `node_modules/`, or names starting with `.`) and files that do not end in `.duramen`.
- Alternatives: allow only files that would belong to a folder record.
- Should the spec pin this? unsure.

## C-14: Brackets between input fields
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: Brackets, braces and parentheses are counted separately. A closer is ordinary when none of its own kind is open. A comma splits fields only when no kind is open. So in `a (x}, b c` the `}` is ordinary and the `(` never closes, and the whole clause is one field.
- Alternatives: a single nesting stack where a closer only closes a matching top; one counter for all three kinds.
- Should the spec pin this? no. These are malformed type texts, and the field names come out the same in every reasonable case.

## C-15: The text of a version
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: "Everything after the keyword" means the rest of the line after the keyword and the white space that follows it. So `duramen   0.2` states `0.2`. The line end is already trimmed.
- Alternatives: require exactly one space.
- Should the spec pin this? no.

## C-16: Words of `spec`, `op`, `table` and `decision` lists
- Spec reference: REQ-SY-004, REQ-SY-007, REQ-SY-009, REQ-SY-012
- Situation: missing
- What I chose: Words are separated by any ECMAScript white space. `spec`'s two words, `op`'s one word and `table`'s one word are all counted that way.
- Alternatives: spaces only.
- Should the spec pin this? no.

## C-17: T010 and T011 with `omit input`
- Spec reference: REQ-CK-004
- Situation: missing
- What I chose: The fields are checked against the input the example wrote, after its input lines, even when an `omit` line leaves `input` out of the request.
- Alternatives: count an omitted input as having no fields, so every required field gets T010.
- Should the spec pin this? unsure. It probably only happens when an example is about a missing input, and such an example would usually expect an error anyway.

## C-18: The `audit` path through an audit that is not a string
- Spec reference: REQ-OR-003, REQ-JU-002
- Situation: missing
- What I chose: `audit.<path>` reads the JSON value inside the `audit` text. When the response's `audit` is missing or is not a string, the path has no value. `audit` on its own reads the member as it is.
- Alternatives: walk into a non-string `audit` as an ordinary JSON value.
- Should the spec pin this? yes. Both the oracle comparison and `judge` depend on it.

## C-19: Checks of other kinds in `judge`
- Spec reference: OPEN-JU-001, REQ-JU-001
- Situation: missing
- What I chose: A check whose `kind` is a string other than `eq` or `approx` is accepted. It is never met, so it is listed as `checks.<n>` in `failed`. A `kind` that is not a string is a `bad_request`.
- Alternatives: ignore unknown checks, which means they pass; refuse them as `bad_request`.
- Should the spec pin this? no. It is open, and failing closed seems the safer default for a judge.

## C-20: `entry` that is JSON null
- Spec reference: Errors, REQ-RQ-001
- Situation: ambiguous
- What I chose: `"entry": null` is present and is neither `"."` nor a relative path, so it is a `bad_request`.
- Alternatives: treat null as absent.
- Should the spec pin this? no.

## C-21: Which `entry` is a file
- Spec reference: REQ-RC-001
- Situation: missing
- What I chose: An entry that is exactly one of the file names is a file record. Otherwise it is a folder if some file name starts with it followed by `/`. Otherwise it does not exist (P046). The request check that no name is the folder of another means both cannot be true at once.
- Alternatives: none really.
- Should the spec pin this? no.

## C-22: Several problems in one table row
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: Every bad cell of a row gets its own P009 or P010, at the row's line. A row with the wrong number of cells gets only P014.
- Alternatives: one diagnostic per row.
- Should the spec pin this? yes. The count is visible in `errors`.

## C-23: Order and concurrency of oracle runs
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: The batched run and every solo run start at the same time and are awaited together. Each run's diagnostics go to its own lines, so the order does not affect the result.
- Alternatives: run them one after another.
- Should the spec pin this? no. It would only matter for oracles with side effects.

## C-24: An example whose JSON input is followed by more text
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example f {} extra` is "text that is not JSON", so it gets P009.
- Alternatives: P012.
- Should the spec pin this? no.

## C-25: Empty `title` and empty `on`
- Spec reference: REQ-SY-006, REQ-SY-009
- Situation: missing
- What I chose: `title` with nothing after it gets P004, because the empty string is not a JSON string. `on` with nothing after it gets P033, because it is not one of the three platforms.
- Alternatives: count either as absent.
- Should the spec pin this? no.

## C-26: Comments at indent 2 inside a text
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: ambiguous
- What I chose: A `#` line at indent 2 is a comment. It does not end the `text` clause it sits in and is not part of the text. Lines indented four or more after it still belong to the same text, because a comment starts no clause.
- Alternatives: the comment ends the text, and later lines get P006.
- Should the spec pin this? unsure. REQ-SY-011 states this for input texts but not for `text` clauses.

## C-27: Codes named in T005
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "Names two or more of the codes" counts distinct declared codes. A code named twice counts once. A code listed twice under `errors` is one code.
- Alternatives: count mentions.
- Should the spec pin this? no. Example 1 of REQ-CK-008 already implies it.

## C-28: The condition text checked for obligations
- Spec reference: REQ-CK-006, REQ-SY-008
- Situation: ambiguous
- What I chose: For an `errors` clause, the text scanned is what comes after `when` on the clause's own line plus every continuation line. The code is not scanned.
- Alternatives: scan the whole clause line.
- Should the spec pin this? no.

## C-29: Duplicate requirement IDs and the oracle
- Spec reference: REQ-CK-002, REQ-OR-002
- Situation: missing
- What I chose: Two requirements with one ID give their examples the same request IDs (`A#1`, …). In the batched run, every example with an ID takes the first response that carries it. The record already has T007, which is an error, so no suite is written.
- Alternatives: number the examples across the duplicates.
- Should the spec pin this? no. The example in REQ-CK-002 needs exactly this: no T021.

## C-30: The member order of responses and cases
- Spec reference: Interface
- Situation: missing
- What I chose: Responses are written as `{"id":…,"result":…}` or `{"id":…,"error":…}`. Cases are written as `id, kind, reqs, platform, line, solo, checks, full`. Results are compared as parsed JSON, so this is cosmetic.
- Alternatives: sorted members.
- Should the spec pin this? no.
