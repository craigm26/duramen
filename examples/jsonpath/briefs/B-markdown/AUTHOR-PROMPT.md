# Write a specification of jsonpath

You are writing the specification of a program, `jsonpath`, for a builder who will implement it
from your specification alone, in TypeScript or Python, without seeing anything else: no RFC,
no web. The program evaluates JSONPath queries as RFC 9535 defines them, with RFC 9485
(I-Regexp) for the regular expressions of the `match()` and `search()` functions. Its interface
(how it is run, the shape of its requests and responses, and its error codes) is fixed and
given in `protocol.md`; do not change it. Your specification describes the behavior behind that
interface.

Write it in the style of spec-driven development tools such as Kiro and OpenSpec: numbered
requirements, each stated with SHALL, and under each, scenarios in WHEN/THEN form that give a
concrete query, a concrete JSON document, and the expected response (its `values` and `paths`,
or the error). Cover everything a conformant implementation needs: the syntax and when a query
is well formed and valid, every segment and selector, filter expressions and comparisons, the
type system and the five function extensions, I-Regexp, normalized paths, and the order of the
results. Be complete and precise: the builder sees only your specification and `protocol.md`.

## Rules
1. Read only `rfc9535.txt`, `rfc9485.txt` and `protocol.md` in this folder. Do not open any other
   file, search the web or fetch anything.
2. You cannot run code, and you do not need to: work out every expected result by hand from the
   RFC text.
3. Write the specification to `SPEC-B.md` in this folder, in Markdown. Where the RFC leaves a
   choice to the implementation and you make one, record it in `DECISIONS-B.md`; if you make
   none, write `None.` there.
4. Finish in this one session. Never stop to ask a question.
