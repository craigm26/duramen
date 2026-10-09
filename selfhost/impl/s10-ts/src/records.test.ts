// Records: which files make a record, their order, versions, one spec, one oracle, one
// list of errors, the stop after reading, and the order of diagnostics (REQ-RC-001 to 006).

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOf, diagsOf, withEcho } from "./testkit.ts";

const A = "duramen 0.1\nspec a 1\n";

test("REQ-RC-001: a folder record holds the .duramen files below it, skipping dot names, build and node_modules", async () => {
  const files = {
    "a.duramen": A,
    "notes.md": "frobnicate",
    "build/x.duramen": "frobnicate",
    "sub/build/x.duramen": "frobnicate",
    "node_modules/x.duramen": "frobnicate",
    ".hidden.duramen": "frobnicate",
    "sub/.hidden/x.duramen": "frobnicate",
    "sub/b.duramen": "duramen 0.1",
  };
  assert.deepEqual(await diagsOf(files), []);
});

test("REQ-RC-001: a record named by a file is that file alone, whatever its name", async () => {
  const files = { "notes.md": "duramen 0.1\nspec n 1\n", "a.duramen": "frobnicate" };
  assert.deepEqual(await diagsOf(files, "notes.md"), []);
});

test("REQ-RC-001: a folder record takes only its own folder; build below the folder is left out", async () => {
  assert.deepEqual(
    await diagsOf({ "sub/a.duramen": A, "sub/deeper/b.duramen": "duramen 0.1", "c.duramen": "frobnicate" }, "sub"),
    [],
  );
  assert.deepEqual(
    await diagsOf({ "build/a.duramen": A, "build/build/b.duramen": "frobnicate" }, "build"),
    [],
  );
});

test("REQ-RC-001: a record named by a missing file, or a folder with no files, gets P046 at line 1 of its name", async () => {
  assert.deepEqual(await diagsOf({ "a.duramen": A }, "missing.duramen"), ["missing.duramen:1: error P046"]);
  assert.deepEqual(await diagsOf({ "a.duramen": A }, "sub"), ["sub:1: error P046"]);
  const none = await checkOf({ "notes.md": "duramen 0.1\nspec a 1\n" });
  assert.deepEqual(none, { diagnostics: [".:1: error P046"], errors: 1, warnings: 0 });
});

test("REQ-RC-002: files are read in the order of their names, compared as UTF-16 code units", async () => {
  assert.deepEqual(
    await diagsOf({ "b.duramen": "duramen 0.1\nspec b 1\n", "a.duramen": A }),
    ["b.duramen:2: error P044"],
  );
  assert.deepEqual(
    await diagsOf({ "a.duramen": A, "B.duramen": "duramen 0.1\nspec b 1\n" }),
    ["a.duramen:2: error P044"],
  );
  assert.deepEqual(
    await diagsOf({ "a/z.duramen": "duramen 0.1\nspec z 1\n", "a.duramen": A }),
    ["a/z.duramen:2: error P044"],
  );
  assert.deepEqual(
    await diagsOf({ "｡.duramen": "duramen 0.1\nspec x 1\n", "\u{1F600}.duramen": "duramen 0.1\nspec y 1\n" }),
    ["｡.duramen:2: error P044"],
  );
});

test("REQ-RC-003: a file that states no version gets P020 at line 1", async () => {
  assert.deepEqual(await diagsOf({ "s.duramen": "spec s 1\n" }), ["s.duramen:1: error P020"]);
});

test("REQ-RC-003: a version other than 0.1 and 0.2 gets P023; a second duramen statement gets P023 each", async () => {
  assert.deepEqual(await diagsOf({ "s.duramen": "duramen 0.3\nspec s 1\n" }), ["s.duramen:1: error P023"]);
  assert.deepEqual(
    await diagsOf({ "s.duramen": "duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n" }),
    ["s.duramen:3: error P023", "s.duramen:4: error P023"],
  );
  assert.deepEqual(await diagsOf({ "s.duramen": "duramen\nspec s 1\n" }), ["s.duramen:1: error P023"]);
});

test("REQ-RC-003: files of one record that state different read versions get P047 at the record's name", async () => {
  assert.deepEqual(
    await diagsOf({ "a.duramen": A, "b.duramen": "duramen 0.2\n" }),
    [".:1: error P047"],
  );
  assert.deepEqual(
    await diagsOf({ "r/a.duramen": "duramen 0.2\nspec s 1\n", "r/b.duramen": "duramen 0.1\n" }, "r"),
    ["r:1: error P047"],
  );
  assert.deepEqual(
    await diagsOf({ "a.duramen": "duramen 0.2\nspec s 1\n", "b.duramen": "duramen 0.2\n" }),
    [],
  );
  assert.deepEqual(
    await diagsOf({ "a.duramen": "duramen 0.2\nspec s 1\n", "b.duramen": "duramen 2\n" }),
    ["b.duramen:1: error P023"],
  );
});

test("REQ-RC-004: a record with no spec gets P021 at line 1 of its name", async () => {
  assert.deepEqual(await diagsOf({ "s.duramen": "duramen 0.1\n" }), [".:1: error P021"]);
  assert.deepEqual(await diagsOf({ "s.duramen": "duramen 0.1\n" }, "s.duramen"), ["s.duramen:1: error P021"]);
  assert.deepEqual(await diagsOf({ "r/s.duramen": "duramen 0.1\n" }, "r"), ["r:1: error P021"]);
});

test("REQ-RC-004: a second spec gets P044 at its line, and a second oracle P044 too", async () => {
  assert.deepEqual(
    await diagsOf({ "s.duramen": "duramen 0.1\nspec a 1\n\nspec b 1\n" }),
    ["s.duramen:4: error P044"],
  );
  assert.deepEqual(
    await diagsOf({
      "a.duramen": "duramen 0.1\nspec s 1\noracle node a.mjs\n",
      "b.duramen": "duramen 0.1\noracle node b.mjs\n",
    }),
    ["b.duramen:2: error P044"],
  );
});

test("REQ-RC-004: a second errors statement gets P032 at its line", async () => {
  assert.deepEqual(
    await diagsOf({ "s.duramen": "duramen 0.1\nspec s 1\nerrors\n  e1 when x\nerrors\n  e2 when y\n" }),
    ["s.duramen:5: error P032"],
  );
  assert.deepEqual(
    await diagsOf({
      "a.duramen": "duramen 0.1\nspec s 1\nerrors\n  e1 when x\n",
      "b.duramen": "duramen 0.1\n\nerrors\n  e2 when y\n",
    }),
    ["b.duramen:3: error P032"],
  );
  assert.deepEqual(
    await diagsOf({ "s.duramen": "duramen 0.1\nspec s 1\nerrors\nerrors\n" }),
    ["s.duramen:4: error P032"],
  );
});

test("REQ-RC-004: a second statement is still read, and its own problems reported", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "duramen 0.1",
    '  title "t"',
    "spec s",
    "oracle",
    "  source o.mjs",
    "    more",
    "errors x",
    "  e if",
    "",
  ].join("\n");
  assert.deepEqual(await diagsOf({ "s.duramen": text }), [
    "s.duramen:3: error P023",
    "s.duramen:4: error P015",
    "s.duramen:5: error P021",
    "s.duramen:5: error P044",
    "s.duramen:6: error P028",
    "s.duramen:8: error P006",
    "s.duramen:9: error P050",
    "s.duramen:10: error P019",
  ]);
});

test("REQ-RC-004: an oracle that is a second one after an empty one gets P044; the first with no command is P028", async () => {
  assert.deepEqual(
    await diagsOf({
      "a.duramen": "duramen 0.1\nspec s 1\noracle\noracle node a.mjs\n",
      "b.duramen": "duramen 0.1\noracle node b.mjs\n",
    }),
    ["a.duramen:3: error P028", "a.duramen:4: error P044", "b.duramen:2: error P044"],
  );
});

test("REQ-RC-005: when reading finds an error, the checks do not run; only the reading diagnostics are reported", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "frobnicate",
    'req A "a"',
    "  example nope {}",
    "",
  ].join("\n");
  assert.deepEqual(await diagsOf({ "s.duramen": text }), ["s.duramen:3: error P002"]);
});

test("REQ-RC-006: diagnostics are in file, line, code, then level order; errors and warnings are counted", async () => {
  const r = await checkOf({
    "b.duramen": "frobnicate\nduramen 0.1\n",
    "a.duramen": "duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n",
  });
  assert.deepEqual(r.diagnostics, [
    "a.duramen:5: error P002",
    "a.duramen:6: error P002",
    "b.duramen:1: error P002",
  ]);
  assert.equal(r.errors, 3);
  assert.equal(r.warnings, 0);
});

test("REQ-RC-006: warnings and errors of the checks come out in the same order", async () => {
  const r = await checkOf({
    "s.duramen": "duramen 0.1\nspec s 1\n\ndecision D-1 \"one\"\n  text\n    No source, and cited by nothing.\n\nreq A \"a\"\n  decision D-2\n",
  });
  assert.deepEqual(r, {
    diagnostics: [
      "s.duramen:4: warning T012",
      "s.duramen:4: warning T013",
      "s.duramen:8: error T001",
      "s.duramen:8: error T008",
    ],
    errors: 2,
    warnings: 2,
  });
});

test("REQ-RC-001 and the echo oracle: a record may hold the oracle's files beside its .duramen files", async () => {
  const r = await checkOf(withEcho({ "s.duramen": "duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input x? json\nreq A \"a\"\n  example f {\"x\": 1}\n    expect result.x = 1\n" }));
  assert.deepEqual(r, { diagnostics: [], errors: 0, warnings: 0 });
});
