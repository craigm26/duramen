# jsonpath: decisions

Why the specification says what it says. Each decision names where its claim came from.

## D-001: Object members in name order

- Source: RFC 9535, sections 2.3.2.2, 2.3.5.2 and 2.5.2.2 ("The order in which the children of an object appear in the resultant nodelist is not stipulated, since JSON objects are unordered"), and section 2.1.2 (an implementation "may produce distinct orderings in successive runs")
- Cited by: REQ-SE-003, REQ-SE-007, REQ-SE-008, EV-EV-RFC
- Waives: EV-EV-RFC row T6-1, EV-EV-RFC row T6-3, EV-EV-RFC row T6-4, EV-EV-RFC row T12-7, EV-EV-RFC row T12-12, EV-EV-RFC row T16-1, EV-EV-RFC row T16-4, EV-EV-RFC row T16-5, EV-EV-RFC row T16-7

RFC 9535 lets an implementation take an object's members in any order, even a different
one each time. A suite cannot state a result that depends on that order, and two
implementations rebuilt from this record would answer the same request differently.
Decision: members are taken in ascending order of their names, compared code point by code
point (REQ-SE-008). Why: it is one of the orders the RFC allows; it does not depend on how a
JSON parser keeps members (JavaScript's JSON.parse puts names such as "10" before the
others, Python's json keeps the text's order); and it is the order REQ-FI-005 already gives
strings.

Rejected:
- The order of the members in the request's JSON text: in JavaScript that needs a JSON parser of its own.
- Leave the order open, as the RFC does: no example could state the result of a wildcard, a filter or a descendant segment over an object with two members or more.

## D-002: The I-JSON range applies to indexes and slices

- Source: RFC 9535, section 2.1 ("Integer numbers in the JSONPath query that are relevant to the JSONPath processing (e.g., index values and steps) MUST be within the range of exact integer values defined in Internet JSON"), and sections 2.3.3.1 and 2.3.4.1
- Cited by: REQ-SY-004, REQ-SY-005, REQ-SY-008

The RFC requires the range of integers "relevant to the JSONPath processing" and gives
index values and steps as its examples; the sections on index and slice selectors require
it of their integers. A number literal in a filter is compared as a number and never used
as an integer. Decision: the integers of index selectors and of slices (start, end and
step) are checked against the range; number literals in filters are not, whatever their
size. How such a literal compares is open (OP-003).

Rejected:
- Check every integer-valued literal too: 2^53 in a comparison would make a query invalid, though nothing in the processing uses it as an integer.

## D-003: Singular queries as the grammar writes them

- Source: RFC 9535, section 2.3.5.1 (singular-query-segments = *(S (name-segment / index-segment)); name-segment = ("[" name-selector "]") / ("." member-name-shorthand); index-segment = "[" index-selector "]"), and section 1.1 ("JSONPath expressions that always produce a singular nodelist but do not conform to the syntax in Section 2.3.5.1 are not singular queries")
- Cited by: REQ-SY-009

The grammar of a singular query allows blank space before each segment but not inside its
brackets, where a bracketed selection elsewhere allows it (`[ 'a' ]`). Decision: the
grammar as written: `@[ 'a' ]` is a test like any query, but not a singular query, so as a
comparable or as an argument where a value is expected it makes the query invalid. Why: the
RFC states the rule in its ABNF, and says that a query is singular by its syntax, not by
what it selects.

Rejected:
- Allow blank space inside a singular query's brackets, as in other bracketed selections: a rule the RFC's grammar does not have, however natural it looks.

## D-004: A function the RFC does not define is not well typed

- Source: RFC 9535, section 2.4 ("A function extension defines a registered name ... that can be applied to a sequence of zero or more arguments"), section 2.4.3 (well-typedness rests on declared types), and section 3.2 (the five functions of the registry)
- Cited by: REQ-SY-010

The grammar accepts any lower-case name as a function name; well-typedness rests on the
declared types that only a defined function has. Decision: `length`, `count`, `match`,
`search` and `value` are the functions; any other name, and a call with another number of
arguments, makes the query invalid. Why: without declared types the expression cannot be
well typed, and the RFC requires an error for a query that is not.

Rejected:
- Treat an unknown function as false, or Nothing, when the query is evaluated: the RFC decides validity before evaluation, and allows no errors during it.

## D-005: The result: values and Normalized Paths

- Source: RFC 9535, section 2.1.2 ("Depending on the specific API, it might be presented as an array of the JSON values at the nodes, an array of Normalized Paths referencing the nodes, or both")
- Cited by: REQ-RQ-002

Decision: both, as two arrays in the nodelist's order. Why: the paths say which node each
value came from, so a result can be checked for its order and its duplicates, and the
RFC's own examples give both.

Rejected:
- Values only: two different nodes with equal values could not be told apart.
