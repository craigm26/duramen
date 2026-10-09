# Choices

Every point where SPEC.md, DECISIONS.md or PROMPT.md was silent, ambiguous or contradictory, and what I did about it.

## C-1: protocol.md is not in the folder
- Spec reference: SPEC.md, "Interface" (Driver protocol, Operations, Errors); SPEC.md intro, which cites `protocol.md`
- Situation: missing
- What I chose: Treated the "Interface" section of SPEC.md as `protocol.md`. It holds everything the implementation needs (framing, the `query` op, the error order), so I did not look anywhere else.
- Alternatives: Stop and ask for protocol.md (PROMPT.md forbids asking). Or invent the protocol from RFC-style guesses (rejected).
- Should the spec pin this? yes. The spec should ship the file it cites, or cite the section by name, so an implementer knows the interface is complete.

## C-2: DECISIONS-B.md is called DECISIONS.md
- Spec reference: SPEC.md intro ("Choices ... listed in `DECISIONS-B.md`"); DECISIONS.md header ("SPEC-B")
- Situation: missing (name mismatch)
- What I chose: DECISIONS.md is the document meant by DECISIONS-B.md / SPEC-B. I followed its 16 decisions as normative.
- Alternatives: Treat the decisions as unavailable and decide everything from scratch (would have contradicted the file the user supplied).
- Should the spec pin this? yes. The file names should match, so a reader cannot mistake which file is normative.

## C-3: Input is handled line by line as it arrives; a final line with no LF is answered
- Spec reference: SPEC.md Interface, Driver protocol bullets 1-3; R1.1
- Situation: missing (timing; whether an unterminated last line is a line)
- What I chose: Each complete LF-terminated line is answered as soon as it is read. A last piece of input with no LF is treated as a line and answered at end of input. Output order equals request order.
- Alternatives: Read all of stdin before answering anything. Ignore an unterminated last line (would drop a request).
- Should the spec pin this? unsure. Either choice conforms with the wording as written, but the spec should say whether an unterminated last line counts as a request.

## C-4: Only LF ends a line; a bare CR does not
- Spec reference: SPEC.md Interface, Driver protocol bullet 1 ("one JSON object per line"); R1.1 ("A carriage return at the end of a line SHALL be ignored")
- Situation: ambiguous
- What I chose: Lines are split on LF only, by hand. A CR that is not at the end of a line stays in the line and is parsed as JSON white space. I did not use Node's `readline`, which also splits on a lone CR.
- Alternatives: Use `readline` (splits on lone CR too). Reject a bare CR.
- Should the spec pin this? yes. "Line" is defined by LF in the protocol, but R1.1 talks about CR, so the boundary should be stated.

## C-5: Which lines are blank; the protocol and R1.1 disagree on the wording
- Spec reference: SPEC.md Interface (Driver protocol bullet 2: "whether other white space makes a line blank is open"); R1.1; DECISIONS.md 14
- Situation: contradictory (the Interface says this is open; R1.1 and DECISIONS 14 settle it)
- What I chose: A line made only of spaces, tabs and CRs is blank and gets no response. One trailing CR is removed before parsing. Any other white space (for example a form feed) makes the line a request, which gets `bad_request` with `"id": null`.
- Alternatives: Treat every white space character as blank (contradicts R1.1 and DECISIONS 14).
- Should the spec pin this? no. R1.1 and DECISIONS 14 already pin it. The Interface wording should be updated to match so the two documents do not conflict.

## C-6: JSON reading is strict RFC 8259; the decoder replaces invalid UTF-8
- Spec reference: SPEC.md Interface, Errors item 1 ("not a JSON object"); R1.2 item 1 ("not valid JSON")
- Situation: missing (byte order mark, invalid UTF-8)
- What I chose: The parser is strict: no leading zeros, no NaN, no trailing text, no raw control characters in strings. A byte order mark is not accepted (it is not JSON). Invalid UTF-8 bytes become U+FFFD through the standard decoder, so that line may still be answered.
- Alternatives: Reject a line that is not valid UTF-8 with `bad_request`. Accept a leading BOM.
- Should the spec pin this? unsure. The spec says nothing about bytes; rejecting invalid UTF-8 with `bad_request` would be a reasonable alternative.

## C-7: Lone surrogates in document strings and in `id` are accepted
- Spec reference: R2.1 and DECISIONS 10 (surrogates in the query); R31.4 (document strings)
- Situation: missing (documents and ids)
- What I chose: A query with a lone surrogate is `invalid_query` (as R2.1 requires). A document string or `id` with a lone surrogate, written as a `\uD800`-style escape, is accepted. Output writes it back as a JSON escape (`JSON.stringify` escapes lone surrogates), so the response is still valid JSON.
- Alternatives: Reject the whole request with `bad_request`. Replace the surrogate with U+FFFD.
- Should the spec pin this? yes. R2.1 covers only queries. Documents and ids can carry the same value and the spec is silent on them.

## C-8: Length and order of a lone surrogate in a document string
- Spec reference: R22 (`length()` counts characters); R18.3 (string order by scalar values)
- Situation: missing
- What I chose: A lone surrogate in a document string counts as one character for `length()`. In string order it compares by its code unit value, the same as its code point. (C-7 explains why such strings exist.)
- Alternatives: Treat such strings as an error. Count them as zero characters.
- Should the spec pin this? yes, together with C-7.

## C-9: Numbers in `values` keep their document text; comparisons use binary64
- Spec reference: R31.2; DECISIONS 3 and 4; R18.5
- Situation: ambiguous (R31.2 asks for the exact value; the text reproduces it, and the comparison rule is binary64)
- What I chose: Each document number is kept with its original text, and `values` writes that text back (so `1.0` stays `1.0`, `1.5e3` stays `1.5e3`, and `12345678901234567890` is kept). Comparisons, and only comparisons, use the binary64 value (`Number(text)`).
- Alternatives: Write the binary64 value back (loses integers above 2^53, which R31.2 forbids).
- Should the spec pin this? no. R31.2 and DECISIONS 3 and 4 already pin it.

## C-10: Duplicate member names keep the last value at the first position
- Spec reference: R31.3; DECISIONS 2
- Situation: ambiguous (RFC 9535 calls it unpredictable; the spec pins one behaviour)
- What I chose: A `Map` is used for objects. Setting a name again keeps its first position and takes the last value, as DECISIONS 2 says.
- Alternatives: Keep the first value. Reject the document.
- Should the spec pin this? no. It is already pinned.

## C-11: Object member order comes from our own parser (a `Map`), not from JavaScript objects
- Spec reference: R30 and its guidance (the note about `JSON.parse` reordering integer-like keys)
- Situation: ambiguous (the spec pins document order but does not say how a TypeScript implementation must keep it)
- What I chose: A parser of our own builds `Map`s, so member order is the document's text order, including names such as `"1"` and `"10"`. Member names such as `__proto__` are ordinary keys.
- Alternatives: `JSON.parse` with a reviver (cannot recover order after integer-like keys are reordered).
- Should the spec pin this? no. The spec already pins document order.

## C-12: Document nesting is not limited by the call stack
- Spec reference: DECISIONS 5 ("no overflow error is raised"); R6 (descendant order over any depth)
- Situation: missing (how deep a document can be)
- What I chose: The parser, the writer, the descendant walk and the deep equality test all use an explicit stack instead of recursion. Documents nested 50,000 levels deep are parsed, written back, and walked.
- Alternatives: Recursion, which overflows at about 6,000 levels, causing the driver to crash on that request (I found this and changed it). Or an error code for "too deep", which the protocol does not have.
- Should the spec pin this? yes. The spec should state the depth it must support, or say what a deeper document should produce, since the protocol has no error code for it.

## C-13: A query too deeply nested for the parser is `invalid_query`
- Spec reference: R2 (well-formed and valid queries); Errors item 4 (`invalid_query` for queries that are not well formed and valid)
- Situation: missing (a query nested so deep that the parser's recursion overflows)
- What I chose: The query parser is recursive, so a query with 20,000 nested parentheses (the depth my test uses) overflows it. The overflow (a `RangeError`) is reported as `invalid_query`, so the driver keeps running. Queries that parse fine are not affected. I did not measure the exact threshold.
- Alternatives: Make the parser iterative (more code, for a case no real query reaches). Let the driver crash.
- Should the spec pin this? yes. A query can be deep enough to overflow an implementation's stack. The spec should give a minimum nesting depth, or say what should happen.

## C-14: Unexpected internal failures end the driver
- Spec reference: Interface, Errors (only four error codes exist); DECISIONS 5
- Situation: missing (internal failures)
- What I chose: Any exception other than the ones handled above (for example a bug) propagates and ends the process with a non-zero status. The protocol has no code for an internal error, so no response line is written for that request.
- Alternatives: Answer every such failure with a made-up code (not in the protocol). Swallow the exception and write nothing (hides bugs).
- Should the spec pin this? yes. The protocol needs a rule for internal failures, or it has to be left to the implementer and stated in the docs.

## C-15: `&&` and `||` short-circuit
- Spec reference: R14.3; DECISIONS 16
- Situation: ambiguous (RFC 9535 allows either)
- What I chose: Short-circuit evaluation, left to right. R14.3 says both give the same results.
- Alternatives: Full evaluation of both sides.
- Should the spec pin this? no. DECISIONS 16 says either is allowed and the results are the same.

## C-16: I-Regexp is compiled to a JavaScript `u`-flag RegExp, after validation
- Spec reference: R27 (validity); R28 (meaning); Appendix D (translation is allowed); DECISIONS 6, 7, 8
- Situation: ambiguous (the spec allows translation but does not say how the host engine's limits are handled)
- What I chose: The pattern is first checked against the full R27 grammar with its extra rules, then translated: every character becomes `\u{...}`, `.` becomes `[^\n\r]`, groups become `(?:...)`, and `match` is `^(?:...)$`. A valid pattern that the engine would refuse (not seen in testing, including a bound of 10^20) is treated as invalid, giving false.
- Alternatives: A hand-written matcher (more code; no engine limits).
- Should the spec pin this? unsure. It is pinned in outcome, but the spec should say whether engine limits (for example on very large bounds) are an error or a non-match. RFC 9485 §8 allows implementations to limit quantifiers, and DECISIONS 8 says no limit is applied.

## C-17: Unicode data comes from the runtime, so `\p{...}` depends on the Node version
- Spec reference: R28.6; DECISIONS 9; Appendix C
- Situation: ambiguous (the Unicode version is "the runtime's" and the runtime is not named)
- What I chose: JavaScript's `\p{...}` (the Unicode data of the Node.js build in use). Tested with `\p{Cn}`, `\p{Lu}`, `\p{Nd}`, `\p{N}` and `\P{L}`.
- Alternatives: Pin one Unicode version in the code (not possible without building a table).
- Should the spec pin this? yes. Results for `\p{Cn}` and for newly assigned characters depend on the Unicode version. The spec should name a version.

## C-18: The compiled-pattern cache is not bounded
- Spec reference: Appendix D ("Cache compiled regexps by pattern string")
- Situation: missing (cache size)
- What I chose: A `Map` from pattern text to compiled RegExp, with no size limit. A driver process is short-lived, and patterns come from queries.
- Alternatives: An LRU cache.
- Should the spec pin this? no.

## C-19: Wrong-length function calls are `invalid_query` before type checks
- Spec reference: R20.3; R21.4
- Situation: ambiguous (two rules can both apply to one call; the spec does not say which applies first)
- What I chose: Name and arity are checked during parsing; types are checked in a second pass after parsing. The response is `invalid_query` either way, so the order is not observable.
- Alternatives: Check types inside the parser.
- Should the spec pin this? no. The response code is the same.

## C-20: REGEN.json: build is empty, test is `node --test`, driver is `node driver.ts`
- Spec reference: REQ-BU-001; REQ-BU-002
- Situation: missing (the choice of commands)
- What I chose: `build` is `""` (nothing to build), `test` is `node --test` (Node finds `*.test.ts` by default on Node 22.22), `driver` is `node driver.ts`. All three are plain words and work the same on Windows and Linux.
- Alternatives: `npm test` (needs `package.json`). An explicit list of test files (works, but it needs updating each time a test file is added).
- Should the spec pin this? no.

## C-21: `package.json` is present, declares `"type": "module"` and no dependencies
- Spec reference: REQ-BU-003
- Situation: missing (whether `package.json` is needed)
- What I chose: It is there so that `.ts` files load as ES modules under Node's type stripping, with no dependencies, no lock file, and no `node_modules`.
- Alternatives: No `package.json` (Node would detect module syntax, with a warning).
- Should the spec pin this? no. REQ-BU-003 already allows it.
