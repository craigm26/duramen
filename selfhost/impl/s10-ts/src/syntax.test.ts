// Reading a file: lines, statements, clauses, text and quoted titles (REQ-SY-001 to 003,
// REQ-SY-005, REQ-SY-006).

import { test } from "node:test";
import assert from "node:assert/strict";
import { diagsOf } from "./testkit.ts";

const one = (text: string) => diagsOf({ "s.duramen": text });

test("REQ-SY-001: CR LF, lone CR and a byte order mark are line ends and BOM; white space is what \\s matches", async () => {
  assert.deepEqual(await one("﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n"), []);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\n\tnote\n"), ["s.duramen:3: error P001"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nnote\n  \ttext\n"), ["s.duramen:4: error P001"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\n note\n"), ["s.duramen:3: error P001"]);
  assert.deepEqual(await one("  \t \nduramen 0.1\n\t\nspec s 1\n   \n"), []);
  assert.deepEqual(await one("duramen 0.1　\nspec s 1 \nnote\n  text\n"), ["s.duramen:4: error P001"]);
});

test("REQ-SY-002: comments are lines starting with #; an unknown keyword gets P002 and its body is ignored", async () => {
  assert.deepEqual(
    await one("# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title \"ignored\"\n    ignored too\nNote\n"),
    ["s.duramen:5: error P002", "s.duramen:8: error P002"],
  );
});

test("REQ-SY-002: an indented line before the first statement gets P003", async () => {
  assert.deepEqual(
    await one("  indented\n # indented too\nduramen 0.1\nspec s 1\n"),
    ["s.duramen:1: error P003", "s.duramen:2: error P003"],
  );
});

test("REQ-SY-003: a clause is indented two spaces; a comment under a clause is a comment", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nnote\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n"),
    [],
  );
});

test("REQ-SY-003: one space of indent gets P007, even for a comment", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nnote\n text\n"),
    ["s.duramen:4: error P007"],
  );
});

test("REQ-SY-003: three spaces or more with no clause before them get P006, even a comment", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nnote\n    Text without a clause.\n  text\n    Text.\n"),
    ["s.duramen:4: error P006"],
  );
});

test("REQ-SY-003: a clause that the statement does not take gets P015, and its lines are ignored", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\n  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n"),
    ["s.duramen:3: error P015", "s.duramen:6: error P015"],
  );
});

test("REQ-SY-003: a clause taken at most once gets P052 at its line, even when the first had a problem", async () => {
  assert.deepEqual(
    await one('duramen 0.1\nspec s 1\n  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\n'),
    ["s.duramen:4: error P052", "s.duramen:9: error P052"],
  );
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\n  title x\n  title \"two\"\nop f\n  request [1]\n  request {}\n"),
    ["s.duramen:3: error P004", "s.duramen:4: error P052", "s.duramen:6: error P009", "s.duramen:7: error P052"],
  );
});

test("REQ-SY-003: a line under a clause that takes no lines gets P006; a comment does not", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\n  title \"A title\"\n    that goes on\n  # A comment.\n    # Another.\n"),
    ["s.duramen:4: error P006"],
  );
});

test("REQ-SY-005: text takes nothing after its keyword; a line under it indented three gets P008", async () => {
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nnote\n  text Here.\n"), ["s.duramen:4: error P008"]);
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nnote\n  text\n    One.\n   Two.\n"),
    ["s.duramen:6: error P008"],
  );
});

test("REQ-SY-005: a line starting with # in a text is text, and it must not be a T004 quotation", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nnote\n  text\n    # It MUST be text.\n"),
    ["s.duramen:3: error T004"],
  );
});

test("REQ-SY-006: a title that is not a quoted string gets P005; a quoted one that is not JSON gets P004", async () => {
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nsection S A title\n"), ["s.duramen:3: error P005"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nsection S \"A title\" and more\n"), ["s.duramen:3: error P005"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nsection S\n"), ["s.duramen:3: error P005"]);
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nsection S \"unclosed\nsection T \"A\" \"B\"\nsection U \"\n"),
    ["s.duramen:3: error P005", "s.duramen:4: error P004", "s.duramen:5: error P005"],
  );
  assert.deepEqual(await one('duramen 0.1\nspec s 1\nsection S "A \\q title"\n'), ["s.duramen:3: error P004"]);
  assert.deepEqual(await one('duramen 0.1\nspec s 1\nsection S "A "quoted" title"\n'), ["s.duramen:3: error P004"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\n  title A title\n"), ["s.duramen:3: error P004"]);
});

test("REQ-SY-006: a valid quoted title with escapes and non-ASCII letters is fine", async () => {
  assert.deepEqual(await one('duramen 0.1\nspec s 1\nsection S-1.x "A \\"quoted\\" title, é and all"\n'), []);
});
