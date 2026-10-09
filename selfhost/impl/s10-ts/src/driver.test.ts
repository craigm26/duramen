// The driver: requests, responses, and the errors a request can get (SPEC.md, Interface and
// REQ-RQ-001, REQ-RQ-002).

import { test } from "node:test";
import assert from "node:assert/strict";
import { answer } from "./serve.ts";
import { checkOf, send } from "./testkit.ts";
import { isRelativePath } from "./files.ts";

const A = "duramen 0.1\nspec a 1\n";

test("REQ-RQ-001: a record travels inside the request, and a file's name is its name in the request", async () => {
  const r = await checkOf({ "a.duramen": A, "b.duramen": "frobnicate\n" }, "a.duramen");
  assert.deepEqual(r, { diagnostics: [], errors: 0, warnings: 0 });
  const all = await checkOf({ "a.duramen": A, "b.duramen": "frobnicate\n" });
  assert.deepEqual(all.diagnostics, ["b.duramen:1: error P002", "b.duramen:1: error P020"]);
  assert.equal(all.errors, 2);
});

test("REQ-RQ-001: a name must be a relative path (parts non-empty, not . or .., no backslash, no NUL, no drive)", () => {
  assert.equal(isRelativePath("a/b.duramen"), true);
  assert.equal(isRelativePath("../a.duramen"), false);
  assert.equal(isRelativePath("/a.duramen"), false);
  assert.equal(isRelativePath("x/./a.duramen"), false);
  assert.equal(isRelativePath("x//a.duramen"), false);
  assert.equal(isRelativePath("a\\b.duramen"), false);
  assert.equal(isRelativePath("a\u0000b"), false);
  assert.equal(isRelativePath("c:a.duramen"), false);
  assert.equal(isRelativePath(""), false);
});

test("REQ-RQ-002: a request line that is not a JSON object gets bad_request with id null", async () => {
  assert.deepEqual(await answer("{not json"), { id: null, error: "bad_request" });
  assert.deepEqual(await answer("[1, 2]"), { id: null, error: "bad_request" });
});

test("REQ-RQ-002: a request without a string id gets bad_request with id null", async () => {
  const input = { files: { "a.duramen": A } };
  assert.deepEqual(await answer(JSON.stringify({ op: "check", input })), { id: null, error: "bad_request" });
  assert.deepEqual(
    await answer(JSON.stringify({ id: 7, op: "check", input })),
    { id: null, error: "bad_request" },
  );
});

test("REQ-RQ-002: an op other than check or cases gets unknown_op, also without an input", async () => {
  assert.deepEqual(
    (await send("lint", { files: { "a.duramen": "x" } })),
    { id: "t", error: "unknown_op" },
  );
  assert.deepEqual(await answer('{"id":"t","op":"lint"}'), { id: "t", error: "unknown_op" });
});

test("REQ-RQ-002: input must be an object, with files that are a non-empty map of relative names to strings", async () => {
  assert.deepEqual(await answer('{"id":"t","op":"check"}'), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", {})), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", { files: {} })), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", { files: ["a.duramen"] })), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", { files: { "a.duramen": 1 } })), { id: "t", error: "bad_request" });
  assert.deepEqual(
    (await send("check", { files: { "../a.duramen": A } })),
    { id: "t", error: "bad_request" },
  );
  assert.deepEqual(
    (await send("check", { files: { "/a.duramen": A } })),
    { id: "t", error: "bad_request" },
  );
  assert.deepEqual((await send("check", { files: { "c:a.duramen": A } })), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("cases", { files: { "a\\b.duramen": A } })), { id: "t", error: "bad_request" });
});

test("REQ-RQ-002: a name that is the folder of another name gets bad_request", async () => {
  assert.deepEqual(
    (await send("cases", { files: { a: "x", "a/b.duramen": A } })),
    { id: "t", error: "bad_request" },
  );
});

test("REQ-RQ-002: entry must be '.' or a relative path, and a string", async () => {
  const files = { "a.duramen": A };
  assert.deepEqual((await send("check", { files, entry: "../a.duramen" })), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", { files, entry: 1 })), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", { files, entry: "" })), { id: "t", error: "bad_request" });
  assert.deepEqual((await send("check", { files, entry: "." })).result, { diagnostics: [], errors: 0, warnings: 0 });
});

test("the driver process: one response line per non-blank request, in order, and exit status 0", async () => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const serve = fileURLToPath(new URL("./serve.ts", import.meta.url));
  const child = spawn(process.execPath, [serve], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d: Buffer) => {
    out += d.toString("utf8");
  });
  const requests = [
    JSON.stringify({ id: "1", op: "check", input: { files: { "a.duramen": A } } }),
    "   \t",
    "{not json",
    JSON.stringify({ id: "3", op: "lint", input: {} }),
    "",
  ];
  child.stdin.end(requests.join("\n"));
  const code = await new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
  assert.equal(code, 0);
  assert.equal(out.includes("\r"), false);
  const responses = out.split("\n");
  assert.equal(responses.pop(), "");
  assert.deepEqual(responses.map((l) => JSON.parse(l)), [
    { id: "1", result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: "bad_request" },
    { id: "3", error: "unknown_op" },
  ]);
});

test("Errors: the first condition that holds decides: bad_request before unknown_op", async () => {
  assert.deepEqual(await answer('{"id":"t","op":"lint","input":5}'), { id: "t", error: "unknown_op" });
  assert.deepEqual(await answer('{"id":"t","op":"check","input":5}'), { id: "t", error: "bad_request" });
});
