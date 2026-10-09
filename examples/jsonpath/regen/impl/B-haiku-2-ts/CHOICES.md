# Choices

Each entry records a point where SPEC.md or DECISIONS.md was missing, ambiguous, or contradictory,
and what the implementation does about it.

## C-1: Standard input is decoded as UTF-8, invalid bytes become U+FFFD
- Spec reference: Interface, Driver protocol (the spec fixes UTF-8 only for standard output)
- Situation: missing
- What I chose: `process.stdin.setEncoding('utf8')`, so invalid byte sequences are replaced by U+FFFD and the line is then processed as usual.
- Alternatives: reject a line with invalid UTF-8 as `bad_request`; or treat the input as bytes and decode per line.
- Should the spec pin this? yes: the input encoding is as important as the output encoding, and the spec pins only one of them.

## C-2: Lines are split on LF only
- Spec reference: Interface, Driver protocol; R1.1
- Situation: ambiguous
- What I chose: a line ends at LF (0x0A). A lone CR inside a line does not end it, so `{"id":...}\r{"id":...}` is one line and gets one `bad_request`. Node's `readline` would split on CR too, so I did not use it.
- Alternatives: split on CR as well (`readline` behaviour), which would give two responses.
- Should the spec pin this? yes: "line" is used throughout but never defined.

## C-3: The request line is parsed with a strict RFC 8259 JSON parser of my own
- Spec reference: R1.2.1 (`bad_request` for a line that is not JSON); R30.3 (order); R31.4 (escapes)
- Situation: ambiguous
- What I chose: strict JSON: no trailing commas, no leading zeros, raw control characters (U+0000–U+001F) rejected in strings, JSON white space (space, tab, LF, CR) allowed around values. A leading byte-order mark makes the line `bad_request`. A `\uD800`-style escape that is not part of a pair is accepted as a single code unit, so it reaches the query check (R2.1) or a document string.
- Alternatives: use `JSON.parse` (which reorders integer-like keys and cannot keep number text, so it cannot satisfy R30.3 and R31.2); or accept lone surrogates in the request as `bad_request`.
- Should the spec pin this? unsure: the spec says the protocol is JSON but does not say how strict the parser is.

## C-4: Duplicate names in the request object: last value, first position
- Spec reference: R1.4 (members other than those named are ignored); R31.3 (for documents)
- Situation: missing (R31.3 covers documents only)
- What I chose: the same rule as documents, so a repeated `"id"`, `"op"`, `"input"`, `"query"` or `"document"` takes the last value. For `document` this means the last occurrence of the member is what is queried.
- Alternatives: `bad_request` for a duplicate member of the request or of `input`.
- Should the spec pin this? yes: whether a duplicate in the request is an error is not stated, and it changes the response.

## C-5: Objects are Maps, and numbers keep their text
- Spec reference: R30.3 (guidance on key order), R31.2 (number text)
- Situation: missing (the spec gives guidance, not a required structure)
- What I chose: objects are `Map`s keyed by member name. Integer-like names keep their document order, and names such as `constructor` or `__proto__` are ordinary names. Numbers are `JsonNumber`s holding the original text (output) and `Number(text)` (comparison).
- Alternatives: plain objects (wrong order, and `constructor` and `__proto__` cause trouble); numbers as bare JavaScript numbers (loses `12345678901234567890`).
- Should the spec pin this? no: the guidance already covers it.

## C-6: Lone surrogates in document strings are passed through
- Spec reference: R31.4 (strings are sequences of characters; escapes decoded "as usual")
- Situation: ambiguous
- What I chose: a lone surrogate from a document escape is kept as a single code unit. It is output as the JSON escape `\udXXX` (what `JSON.stringify` writes), so the output stays valid ASCII JSON. Inside a comparison or regular expression it is one character.
- Alternatives: reject the document (no error code exists for this); replace it with U+FFFD.
- Should the spec pin this? yes: R31.4 talks about characters, and a lone surrogate is not one.

## C-7: `\p{Cs}` is not accepted, although Appendix C lists `Cs`
- Spec reference: R27 (charProp grammar), R28.6 and Appendix C
- Situation: contradictory
- What I chose: the grammar is normative for validity, and it has `"C" ["c" / "f" / "n" / "o"]`, with no `Cs`. So a pattern containing `\p{Cs}` or `\P{Cs}` is invalid and gives LogicalFalse (R24). Appendix C says "C = Cc Cf Cs Co Cn" for the one-letter form `\p{C}`, which is still accepted because it is a different name.
- Alternatives: accept `Cs` as Appendix C says (surrogates never occur in strings, so it can only ever match nothing).
- Should the spec pin this? yes: the two places disagree, and the test is observable (`match(@, '\p{Cs}|a')` on `"a"`).

## C-8: I-Regexps are checked by my parser and run by the JavaScript RegExp engine
- Spec reference: Appendix D (translation to a host engine is acceptable); DECISIONS 9 (Unicode version for `\p`)
- Situation: missing (the spec allows either a host engine or a matcher written from the grammar)
- What I chose: a parser for the R27 grammar and its three extra rules emits JavaScript source with the `u` flag. Every literal character is written as `\u{…}`, `.` becomes `[^\u{a}\u{d}]`, and a class keeps its ranges and `\p`/`\P` items. `match` uses `^(?:…)$`, `search` uses the source as is. The `\p` names are the runtime's Unicode version, as DECISIONS 9 says.
- Alternatives: a backtracking matcher written from the parsed form.
- Should the spec pin this? no.

## C-9: A lone surrogate in an I-Regexp is invalid, so the function gives LogicalFalse
- Spec reference: R27 ("characters are Unicode scalar values"), R24
- Situation: ambiguous
- What I chose: a pattern containing a lone surrogate (only possible from a document string) is invalid, and `match` and `search` give LogicalFalse. A subject string with a lone surrogate is matched as one character.
- Alternatives: treat the lone surrogate as an ordinary character in patterns too.
- Should the spec pin this? yes: the spec says characters are scalar values but does not say what a non-scalar input does.

## C-10: Quantifier counts above 2^53 are kept as written
- Spec reference: DECISIONS 8 (no limit on range quantifiers); R12.2 (the range does not apply to quantifiers)
- Situation: missing
- What I chose: `a{99999999999999999999}` is valid. The count is normalized with `BigInt` (for the `n <= m` check) and passed to the RegExp engine as written. I tested that the engine accepts it, and that the pattern matches nothing for `"a"`.
- Alternatives: cap the count, or reject counts above a limit.
- Should the spec pin this? unsure: it is a limit on what the engine accepts, and DECISIONS 8 already says no limit.

## C-11: A parenthesized argument is a logical expression, even when it holds one query
- Spec reference: R20.4 (argument classes); R21.3 (parameter rules); the grammar in Appendix A (`paren-expr` is a `logical-expr`)
- Situation: ambiguous
- What I chose: `length((@.a))` and `count((@.*))` are invalid, because `(...)` is a logical expression, and a logical expression is not accepted for a ValueType or NodesType parameter. DECISIONS 13 covers bare queries and does not mention parentheses.
- Alternatives: treat `((@.a))` as the query `@.a`, which would make `length((@.a))` valid.
- Should the spec pin this? yes: the grammar and R21 read differently for parentheses.

## C-12: A bare literal is rejected in a static check, not in the parser
- Spec reference: R13.4 (a literal alone is not a logical expression); R20.4 (a literal is a valid function argument)
- Situation: missing
- What I chose: the parser accepts a bare literal as an operand, which lets it be a function argument. The static check (`checkTest`) rejects it anywhere a test is needed: `$[?1]`, `$[?!1]`, `$[?(1)]`, `$[?1 && @.a]`. `length((1))` is still invalid because the parentheses make a logical expression.
- Alternatives: a separate parse path for function arguments.
- Should the spec pin this? no: the result is the same as the grammar.

## C-13: Unknown function names are rejected by the static check
- Spec reference: R20.2; DECISIONS 11
- Situation: missing (R20.2 gives the five names but no order for checks)
- What I chose: a call whose name is not one of the five, or whose arity is wrong, is `invalid_query`, found during the static check after the parse. A name such as `constructor` or `__proto__` is looked up in a `Map`, so it cannot match an inherited property.
- Alternatives: none that the spec allows.
- Should the spec pin this? no.

## C-14: Output of a document value is the document's own JSON text, with normal string escaping
- Spec reference: R31.2 (numbers reproduced exactly; JSON-equivalent spellings are acceptable)
- Situation: ambiguous
- What I chose: a number is written as its document text (`1.0` stays `1.0`, `1.5e3` stays `1.5e3`, `-0` stays `-0`). A string is written with `JSON.stringify`, so a control character becomes an escape and a non-ASCII character stays as written.
- Alternatives: normalise numbers to their shortest form; escape non-ASCII characters too.
- Should the spec pin this? no: R31.2 allows either.

## C-15: Blank lines and CR at the end of a line
- Spec reference: R1.1; DECISIONS 14
- Situation: ambiguous (DECISIONS 14 decides the main cases; a second CR is not covered)
- What I chose: a line of spaces, tabs and CRs only is blank. One CR at the end of a line is removed before parsing. A second CR is left in place, which is still valid JSON white space, so `…}\r\r` gives a normal response.
- Alternatives: remove every trailing CR; treat a second CR as `bad_request`.
- Should the spec pin this? no: the effect is the same for every case the spec describes.

## C-16: The response is written with `process.stdout.write`, and the process exits when input ends
- Spec reference: Interface, Driver protocol (exit status 0 after end of input); R1.7 (should flush after each response)
- Situation: missing (flushing is only a SHOULD)
- What I chose: each response is written as its request is read, and the process is not closed with `process.exit`, so Node flushes standard output before it exits.
- Alternatives: collect the responses and write them at the end.
- Should the spec pin this? no.

## C-17: An unexpected internal error is not caught
- Spec reference: R1.1 (exactly one response per non-blank line)
- Situation: missing (the spec has no error code for an internal failure)
- What I chose: the evaluator does not throw for any well-formed, valid query (R1.6, R14.4), so a thrown error means a bug. It is not turned into a response, and it stops the driver.
- Alternatives: catch it and answer with an invented error code, or with `bad_request`.
- Should the spec pin this? yes: a rule for internal failure would decide what the driver prints.

## C-18: The implementation folder has a `package.json` that declares `"type": "module"`
- Spec reference: REQ-BU-003 (a `package.json`, if present, declares no dependencies); REGEN.json
- Situation: missing (the spec does not say how Node should treat `.ts` files)
- What I chose: `"type": "module"` makes the `.ts` files ES modules and avoids module-type detection. It declares no dependencies, so REQ-BU-003 holds.
- Alternatives: no `package.json`, with Node's module detection.
- Should the spec pin this? no.

## C-19: The test command is `node --test`, with the default file discovery
- Spec reference: REQ-BU-002 (the command in REGEN.json `test` must exit 0)
- Situation: missing
- What I chose: `node --test` with no arguments. Node 22.22 finds the `*.test.ts` files by its default pattern, and the suite runs in about 2 seconds. Helpers are in `helpers.ts`, which the pattern does not match.
- Alternatives: a glob such as `node --test "*.test.ts"`, which depends on the platform shell expanding it.
- Should the spec pin this? no.

## C-20: The files the spec names are not all in the folder
- Spec reference: SPEC.md preamble ("described in `protocol.md`", "listed in `DECISIONS-B.md`")
- Situation: missing
- What I chose: the driver protocol is taken from the Interface section of SPEC.md, and the decisions are taken from `DECISIONS.md`. The folder has no `protocol.md` or `DECISIONS-B.md`.
- Alternatives: stop and ask. The prompt says not to, and the content needed is present.
- Should the spec pin this? yes: the file names should match the files that are delivered.
