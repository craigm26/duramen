// The driver as REGEN.json starts it: the driver command split on single spaces, run without a
// shell, in the implementation folder (SPEC.md, Driver protocol and REQ-BU-001).

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const regen = JSON.parse(readFileSync(join(root, "REGEN.json"), "utf8")) as { driver: string };
const [program, ...args] = regen.driver.split(" ");

// Runs the driver on the given standard input; returns its standard output and exit status.
function drive(input: string): { stdout: string; status: number | null; stderr: string } {
  const r = spawnSync(program, args, { cwd: root, input, encoding: "utf8" });
  return { stdout: r.stdout, status: r.status, stderr: r.stderr };
}

test("the driver answers each request line in order, skipping blank lines", () => {
  const input = [
    '{"id":"a","op":"query","input":{"query":"$[1]","document":[1,2]}}',
    "",
    "   ",
    "{not json",
    '{"id":"b","op":"query","input":{"query":"$.x","document":{"x":true}}}',
    '{"id":"c","op":"query","input":{"query":"$[","document":1}}',
    "",
  ].join("\n");
  const r = drive(input);
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.split("\n");
  assert.strictEqual(lines.pop(), "", "every response ends with LF");
  assert.deepStrictEqual(lines.map((line) => JSON.parse(line)), [
    { id: "a", result: { values: [2], paths: ["$[1]"] } },
    { id: null, error: "bad_request" },
    { id: "b", result: { values: [true], paths: ["$['x']"] } },
    { id: "c", error: "invalid_query" },
  ]);
});

test("the last line may lack its LF, and CRLF line ends are accepted", () => {
  const r = drive('{"id":"a","op":"query","input":{"query":"$","document":1}}\r\n{"id":"b","op":"query","input":{"query":"$","document":2}}');
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.split("\n");
  assert.strictEqual(lines.pop(), "");
  assert.deepStrictEqual(lines.map((line) => JSON.parse(line)), [
    { id: "a", result: { values: [1], paths: ["$"] } },
    { id: "b", result: { values: [2], paths: ["$"] } },
  ]);
});

test("empty input gives no output and exit status 0", () => {
  const r = drive("");
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
});

test("every response line is UTF-8 with LF ends and no CR", () => {
  const r = drive('{"id":"é","op":"query","input":{"query":"$","document":"\u{1F600}"}}\n');
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.endsWith("\n"));
  assert.ok(!r.stdout.includes("\r"));
  assert.deepStrictEqual(JSON.parse(r.stdout.trimEnd()), { id: "é", result: { values: ["\u{1F600}"], paths: ["$"] } });
});
