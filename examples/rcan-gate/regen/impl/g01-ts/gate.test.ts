import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { handle } from "./driver.ts";

const GUEST = { id: "q1", timestamp: 1000, role: "GUEST", kind: "status" };
const LIM = { base: { min: -1, max: 1 }, elbow: { min: 0, max: 2 } };
const MS = { now: 1000, maxSpeed: 1, limits: LIM };
const mv = (o: object = {}) => ({
  id: "m1", timestamp: 1000, role: "OPERATOR", kind: "move", scope: "control",
  targets: [{ joint: "base", position: 0 }], speed: 0, ...o,
});
const sf = (event: string, o: object = {}) => ({ id: "s1", timestamp: 1000, role: "OPERATOR", kind: "safety", event, ...o });
const run = (state: object, command: object): any => handle(JSON.stringify({ id: "x", op: "decide", input: { state, command } }));
const dr = (state: object, command: object, d: string, r: string) => {
  const a = run(state, command);
  assert.deepEqual([a.result?.decision, a.result?.reason], [d, r], JSON.stringify([state, command, a]));
  return a.result;
};
const bad = (state: unknown, command: unknown) => {
  const a = handle(JSON.stringify({ id: "x", op: "decide", input: { state, command } }));
  assert.deepEqual(a, { id: "x", error: "bad_request" }, JSON.stringify([state, command]));
};

test("REQ-RQ-001 errors", () => {
  assert.deepEqual(handle("{not json"), { id: null, error: "bad_request" });
  assert.deepEqual(handle("[1,2]"), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"id":5,"op":"decide","input":{}}'), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"op":"decide","input":{}}'), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"id":"a","input":{}}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(handle('{"id":"a","op":"gate","input":{}}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(handle('{"id":"a","op":"decide"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(handle('{"id":"a","op":"decide","input":[]}'), { id: "a", error: "bad_request" });
  bad(undefined, GUEST);
  bad({ now: 1000 }, undefined);
  dr({ now: 1000 }, mv({ id: "r1" }), "refuse", "unknown_joint"); // refusal is not an error
});

test("REQ-RQ-002 state forms", () => {
  const badStates: object[] = [
    {}, { now: "1000" }, { now: 1000, estopped: 1 }, { now: 1000, stopped: null },
    { now: 1000, minLoaControl: 0 }, { now: 1000, minLoaControl: 2.5 }, { now: 1000, minLoaSafety: true },
    { now: 1000, minLoaSafety: "3" }, { now: 1000, window: 0 }, { now: 1000, maxSpeed: -0.5 },
    { now: 1000, limits: [] }, { now: 1000, limits: { base: { min: 1, max: -1 } } },
    { now: 1000, limits: { base: { min: -1 } } },
    { now: 1000, gates: { control: { min: 1.5, onFail: "block" } } },
    { now: 1000, gates: { control: { min: 0.5, onFail: "warn" } } },
    { now: 1000, seen: [{ id: 1, expires: 1030 }] }, { now: 1000, seen: {} },
  ];
  for (const s of badStates) bad(s, GUEST);
  const r = dr({ now: 1000, minLoaControl: 2.0, window: 0.5, maxSpeed: 0, limits: { base: { min: 1, max: 1 } },
    gates: { control: { min: 0, onFail: "escalate" } } }, GUEST, "execute", "status");
  assert.deepEqual(r.state.seen, [{ expires: 1000.5, id: "q1" }]);
});

test("REQ-RQ-003 command forms", () => {
  const s = { now: 1000 };
  const badCmds: object[] = [
    { ...GUEST, id: "" }, { ...GUEST, id: 7 }, { timestamp: 1000, role: "GUEST", kind: "status" },
    { ...GUEST, timestamp: "1000" }, { ...GUEST, role: "guest" }, { ...GUEST, role: "constructor" },
    { ...GUEST, loa: 0 }, { ...GUEST, loa: true }, { ...GUEST, loa: "2" }, { ...GUEST, tier: "Root" },
    { ...GUEST, kind: "teleport" }, { id: "q1", timestamp: 1000, role: "GUEST" },
    sf("estop"), { id: "e1", timestamp: 1000, role: "GUEST", kind: "safety" },
    mv({ scope: undefined }), mv({ scope: "" }), mv({ targets: [] }),
    mv({ targets: [{ joint: "base" }] }), mv({ targets: [{ joint: "base", position: "0" }] }),
    mv({ targets: [{ joint: 1, position: 0 }] }), mv({ speed: undefined }), mv({ speed: -1 }),
    mv({ confidence: 1.5 }), mv({ confidence: null }),
  ];
  for (const c of badCmds) bad(s, c);
  dr(s, { ...GUEST, loa: 2.0 }, "execute", "status");
  dr(s, sf("STOP", { scope: 5 }), "execute", "stop");
  dr({ now: 1000, maxSpeed: 1, limits: { "": { min: 0, max: 0 } } },
    mv({ targets: [{ joint: "", position: 0 }], speed: 1, confidence: 0 }), "execute", "ok");
});

test("REQ-RQ-004 unknown members ignored and passed on", () => {
  const line = '{"id":"x1","op":"decide","trace":true,"input":{"note":"x","state":{"now":1000,"robot":"arm-7"},' +
    '"command":{"id":"q1","timestamp":1000,"role":"GUEST","kind":"status","targets":[],"via":"lan"}}}';
  assert.deepEqual((handle(line) as any).result, { decision: "execute", reason: "status",
    state: { estopped: false, now: 1000, robot: "arm-7", seen: [{ expires: 1030, id: "q1" }], stopped: false } });
  const out = JSON.stringify(handle('{"id":"x","op":"decide","input":{"state":{"now":1000,"__proto__":{"now":5},"constructor":1},' +
    '"command":{"id":"q1","timestamp":1000,"role":"GUEST","kind":"status"}}}'));
  assert.ok(out.includes('"__proto__":{"now":5}') && out.includes('"constructor":1'));
  const r = dr({ now: 1000, maxSpeed: 1, limits: { base: { min: -1, max: 1, unit: "rad" } },
    gates: { control: { min: 0.5, onFail: "block", by: "ops" } }, seen: [{ id: "a", expires: 1010, from: "lan" }] },
    mv({ id: "m1", speed: 1, confidence: 0.5, targets: [{ joint: "base", position: 1, unit: "rad" }] }), "execute", "ok");
  assert.deepEqual(r.state.seen, [{ expires: 1010, from: "lan", id: "a" }, { expires: 1030, id: "m1" }]);
});

test("REQ-RQ-005 numbers", () => {
  for (const s of [{ now: true }, { now: 1000, window: true }, { now: 1000, maxSpeed: false },
    { now: 1000, limits: { base: { min: true, max: 1 } } }, { now: 1000, gates: { control: { min: false, onFail: "block" } } },
    { now: 1000, seen: [{ id: "a", expires: true }] }]) bad(s, GUEST);
  bad(MS, { ...GUEST, timestamp: false });
  bad(MS, mv({ targets: [{ joint: "base", position: true }] }));
  bad(MS, mv({ speed: false }));
  bad(MS, mv({ confidence: true }));
  dr({ now: 9007199254740993, window: 0.5 }, { ...GUEST, timestamp: 9007199254740992 }, "execute", "status");
  dr({ now: 1006.1, window: 0.1 }, { ...GUEST, timestamp: 1006 }, "refuse", "stale");
  dr({ now: 1009.5, window: 12.7 }, { ...GUEST, timestamp: 996.8 }, "refuse", "stale");
  dr({ now: 1019.9 }, { ...GUEST, timestamp: 1024.9 }, "execute", "status");
  const line = '{"id":"x","op":"decide","input":{"state":{"now":1000,"maxSpeed":1e0,"limits":{"base":{"min":-1.0,"max":10e-1}}},' +
    '"command":{"id":"m1","timestamp":1000.0,"role":"OPERATOR","loa":1.0,"kind":"move","scope":"control","targets":[{"joint":"base","position":1.00}],"speed":100e-2}}}';
  assert.equal((handle(line) as any).result.reason, "ok");
});

test("REQ-GT-001 result and next state", () => {
  const a = run({ now: 1000 }, GUEST);
  assert.deepEqual(a, { id: "x", result: { decision: "execute", reason: "status",
    state: { estopped: false, now: 1000, seen: [{ expires: 1030, id: "q1" }], stopped: false } } });
  const r = dr({ now: 1000, window: 12, maxSpeed: 2, limits: { base: { min: -1, max: 1 } }, gates: {}, minLoaControl: 1 },
    GUEST, "execute", "status");
  assert.deepEqual(r.state, { estopped: false, gates: {}, limits: { base: { max: 1, min: -1 } }, maxSpeed: 2,
    minLoaControl: 1, now: 1000, seen: [{ expires: 1012, id: "q1" }], stopped: false, window: 12 });
});

test("REQ-GT-002 step order", () => {
  const m = { ...MS, gates: { control: { min: 0.5, onFail: "block" } } };
  const wide = mv({ targets: [{ joint: "x", position: 0 }], speed: 9 });
  dr({ now: 1000, estopped: true, seen: [{ id: "e1", expires: 1030 }] }, sf("ESTOP", { id: "e1", timestamp: 1, role: "GUEST" }), "execute", "estop");
  dr({ now: 1000, seen: [{ id: "m1", expires: 1030 }] }, { ...GUEST, id: "m1", timestamp: 900 }, "refuse", "stale");
  dr({ now: 1000, estopped: true, seen: [{ id: "m1", expires: 1030 }] }, { ...wide, role: "GUEST" }, "refuse", "replay");
  dr({ now: 1000, estopped: true, minLoaControl: 3 }, { ...wide, role: "GUEST" }, "refuse", "estopped");
  dr({ now: 1000, stopped: true, minLoaControl: 3 }, { ...wide, role: "GUEST" }, "refuse", "role");
  dr({ now: 1000, stopped: true, minLoaControl: 3 }, wide, "refuse", "loa");
  dr({ now: 1000, stopped: true }, wide, "refuse", "stopped");
  dr({ now: 1000, limits: LIM }, mv({ targets: [{ joint: "base", position: 5 }], speed: 9, confidence: 0 }), "refuse", "limits");
  dr(m, mv({ speed: 9, confidence: 0 }), "refuse", "speed");
  dr({ ...m, maxSpeed: 9 }, mv({ speed: 9, confidence: 0 }), "refuse", "confidence");
  dr({ ...m, maxSpeed: 9 }, mv({ speed: 9, confidence: 0.5 }), "execute", "ok");
});

test("REQ-GT-003 ESTOP never blocked", () => {
  const e = (o: object = {}) => ({ id: "e1", timestamp: 1000, role: "GUEST", kind: "safety", event: "ESTOP", ...o });
  const r = dr({ now: 1000, stopped: true, seen: [{ id: "old", expires: 1000 }, { id: "e1", expires: 1001 }] },
    e({ id: "e2" }), "execute", "estop");
  assert.deepEqual(r.state, { estopped: true, now: 1000, seen: [{ expires: 1001, id: "e1" }], stopped: true });
  for (const c of [e(), e({ timestamp: 1 }), e({ timestamp: 99999 }), e({ loa: 1, tier: "community" })]) {
    assert.equal(run({ now: 1000, minLoaControl: 3, minLoaSafety: 3 }, c).result.state.estopped, true);
    dr({ now: 1000 }, c, "execute", "estop");
  }
  dr({ now: 1000, estopped: true, seen: [{ id: "e1", expires: 1010 }] }, e(), "execute", "estop");
});

test("REQ-GT-004 fresh and once", () => {
  const seenOf = (s: object, c: object) => run(s, c).result.state.seen;
  assert.deepEqual(seenOf({ now: 1000, seen: [{ id: "q1", expires: 1030 }, { id: "q1", expires: 1040 }] }, { ...GUEST, id: "q2" }),
    [{ expires: 1030, id: "q1" }, { expires: 1040, id: "q1" }, { expires: 1030, id: "q2" }]);
  dr({ now: 1000 }, { ...GUEST, timestamp: 970 }, "execute", "status");
  dr({ now: 1000 }, { ...GUEST, timestamp: 969.5 }, "refuse", "stale");
  dr({ now: 1000 }, { ...GUEST, timestamp: 1005 }, "execute", "status");
  dr({ now: 1000 }, { ...GUEST, timestamp: 1005.5 }, "refuse", "future");
  assert.deepEqual(seenOf({ now: 1000 }, { ...GUEST, timestamp: 969.5 }), []);
  dr({ now: 1000 }, sf("STOP", { timestamp: 990 }), "execute", "stop");
  dr({ now: 1000 }, sf("STOP", { timestamp: 989.5 }), "refuse", "stale");
  assert.deepEqual(seenOf({ now: 1000 }, sf("STOP", { timestamp: 990 })), [{ expires: 1010, id: "s1" }]);
  dr({ now: 1000, window: 5 }, sf("RESUME", { timestamp: 994.5 }), "refuse", "stale");
  dr({ now: 1000, window: 5 }, sf("RESUME", { timestamp: 995 }), "execute", "resume");
  dr({ now: 1000, window: 12 }, { ...GUEST, timestamp: 988 }, "execute", "status");
  dr({ now: 1000, seen: [{ id: "q1", expires: 1030 }] }, GUEST, "refuse", "replay");
  dr({ now: 1000, seen: [{ id: "q1", expires: 1000.5 }] }, GUEST, "refuse", "replay");
  dr({ now: 1000, seen: [{ id: "q1", expires: 1000 }] }, GUEST, "execute", "status");
  assert.deepEqual(seenOf({ now: 1000, seen: [{ id: "a", expires: 990 }, { id: "b", expires: 1020 }, { id: "c", expires: 1000 }] },
    { ...GUEST, timestamp: 900 }), [{ expires: 1020, id: "b" }]);
  assert.deepEqual(seenOf({ now: 1000, seen: [{ id: "b", expires: 1020 }, { id: "a", expires: 1010 }] }, mv({ id: "c", role: "GUEST" })),
    [{ expires: 1020, id: "b" }, { expires: 1010, id: "a" }, { expires: 1030, id: "c" }]);
  assert.deepEqual(seenOf({ now: 1000.25, window: 0.5 }, GUEST), [{ expires: 1000.75, id: "q1" }]);
});

test("REQ-GT-005 ESTOP latch", () => {
  const f = (s: object, c: object, d: string, r: string, e: boolean, st: boolean) => {
    const x = dr(s, c, d, r);
    assert.deepEqual([x.state.estopped, x.state.stopped], [e, st]);
  };
  f({ ...MS, estopped: true }, mv(), "refuse", "estopped", true, false);
  f({ now: 1000, estopped: true, stopped: true }, sf("RESUME"), "refuse", "estopped", true, true);
  f({ now: 1000, estopped: true }, sf("STOP"), "execute", "stop", true, true);
  f({ now: 1000, estopped: true }, GUEST, "execute", "status", true, false);
  const c = sf("ESTOP_CLEAR", { id: "c1", role: "CREATOR" });
  f({ now: 1000, estopped: true, stopped: true }, c, "execute", "estop_clear", false, true);
  f({ now: 1000 }, c, "execute", "estop_clear", false, false);
  f({ now: 1000, estopped: true }, { ...c, role: "ADMIN" }, "refuse", "role", true, false);
  f({ now: 1000, estopped: true }, { ...c, timestamp: 989.5 }, "refuse", "stale", true, false);
});

test("REQ-GT-006 roles and scopes", () => {
  const cases: [string, string, string][] = [
    ["GUEST", "control", "role"], ["OPERATOR", "control", "ok"], ["GUEST", "CONTROL", "role"], ["GUEST", "Chat", "ok"],
    ["OPERATOR", "contribute", "role"], ["CONTRIBUTOR", "contribute", "ok"], ["CONTRIBUTOR", "config", "role"],
    ["ADMIN", "training_data", "ok"], ["M2M_PEER", "admin", "role"], ["CREATOR", "Fleet.Trusted", "role"],
    ["M2M_TRUSTED", "fleet.trusted", "ok"], ["GUEST", "dance", "role"], ["OPERATOR", "dance", "ok"],
    ["OPERATOR", "constructor", "ok"], ["OPERATOR", "__proto__", "ok"], ["GUEST", "toString", "role"],
    ["CREATOR", "estop", "ok"], ["CREATOR", "safety", "ok"], ["ADMIN", "authority", "ok"], ["GUEST", "observer", "ok"],
    ["OPERATOR", "Kick", "ok"], ["GUEST", "Kick", "role"],
  ];
  for (const [role, scope, r] of cases) dr(MS, mv({ role, scope }), r === "ok" ? "execute" : "refuse", r);
  dr({ now: 1000 }, sf("STOP", { role: "GUEST" }), "refuse", "role");
  dr({ now: 1000 }, sf("RESUME"), "execute", "resume");
  dr({ now: 1000, estopped: true }, sf("ESTOP_CLEAR", { role: "M2M_PEER" }), "refuse", "role");
  dr({ now: 1000, estopped: true }, sf("ESTOP_CLEAR", { role: "M2M_TRUSTED" }), "execute", "estop_clear");
});

test("REQ-GT-007 level of assurance", () => {
  const s2 = { ...MS, minLoaControl: 2 };
  dr(s2, mv(), "refuse", "loa");
  dr(s2, mv({ loa: 2 }), "execute", "ok");
  dr(s2, mv({ tier: "authoritative" }), "execute", "ok");
  dr({ ...MS, minLoaControl: 3 }, mv({ tier: "authoritative" }), "refuse", "loa");
  dr(s2, mv({ tier: "community" }), "refuse", "loa");
  dr(s2, mv({ tier: "root" }), "refuse", "loa");
  dr(s2, mv({ loa: 1, tier: "authoritative" }), "refuse", "loa");
  dr(s2, mv({ role: "GUEST", scope: "chat" }), "refuse", "loa");
  dr({ now: 1000, minLoaControl: 3 }, GUEST, "execute", "status");
  dr({ now: 1000, minLoaControl: 2 }, sf("STOP"), "refuse", "loa");
  dr({ now: 1000, minLoaControl: 2 }, sf("STOP", { loa: 3 }), "execute", "stop");
  const cl = sf("ESTOP_CLEAR", { id: "c1", role: "CREATOR" });
  dr({ now: 1000, estopped: true, minLoaSafety: 3 }, { ...cl, loa: 2 }, "refuse", "loa");
  dr({ now: 1000, estopped: true, minLoaSafety: 3 }, { ...cl, loa: 3 }, "execute", "estop_clear");
  dr({ now: 1000, estopped: true, minLoaControl: 2, minLoaSafety: 1 }, { ...cl, loa: 1 }, "refuse", "loa");
  dr({ ...MS, minLoaSafety: 3 }, mv({ role: "CREATOR", loa: 2, scope: "SAFETY" }), "refuse", "loa");
  dr({ ...MS, minLoaSafety: 3 }, mv({ role: "CREATOR", loa: 2, scope: "estop" }), "execute", "ok");
  dr({ now: 1000, minLoaControl: 3 }, sf("STOP", { role: "GUEST", loa: 1 }), "refuse", "role");
});

test("REQ-GT-008 STOP and RESUME", () => {
  const st = (s: object, c: object, r: string, stopped: boolean) => assert.equal(dr(s, c, r === "stopped" ? "refuse" : r === "status" || r === "stop" || r === "resume" ? "execute" : "refuse", r).state.stopped, stopped);
  st({ now: 1000 }, sf("STOP"), "stop", true);
  st({ now: 1000, stopped: true }, sf("STOP"), "stop", true);
  st({ now: 1000, stopped: true }, sf("RESUME"), "resume", false);
  st({ now: 1000 }, sf("RESUME"), "resume", false);
  st({ ...MS, stopped: true }, mv(), "stopped", true);
  st({ now: 1000, stopped: true }, GUEST, "status", true);
});

test("REQ-GT-009 joint limits", () => {
  const t = (...ts: [string, number][]) => mv({ targets: ts.map(([joint, position]) => ({ joint, position })) });
  dr(MS, t(["base", 1]), "execute", "ok");
  dr(MS, t(["base", -1]), "execute", "ok");
  dr(MS, t(["base", 1.0000001]), "refuse", "limits");
  dr(MS, t(["elbow", -0.5]), "refuse", "limits");
  dr(MS, t(["gripper", 0]), "refuse", "unknown_joint");
  dr({ now: 1000, maxSpeed: 1 }, t(["base", 0]), "refuse", "unknown_joint");
  dr(MS, t(["Base", 0]), "refuse", "unknown_joint");
  dr(MS, t(["base", 0], ["base", 0]), "refuse", "duplicate_joint");
  dr(MS, t(["base", 5], ["base", 0]), "refuse", "limits");
  dr(MS, t(["elbow", 1], ["base", 0], ["elbow", 9]), "refuse", "duplicate_joint");
  dr(MS, t(["base", 0], ["gripper", 0], ["base", 9]), "refuse", "unknown_joint");
  dr(MS, t(["elbow", 2], ["base", -1]), "execute", "ok");
  for (const j of ["toString", "__proto__", "hasOwnProperty"]) dr({ now: 1000, maxSpeed: 1, limits: { base: { min: -1, max: 1 } } }, t([j, 0]), "refuse", "unknown_joint");
  const own = JSON.parse('{"__proto__":{"min":0,"max":1},"toString":{"min":0,"max":1}}');
  dr({ now: 1000, maxSpeed: 1, limits: own }, t(["__proto__", 1], ["toString", 0]), "execute", "ok");
  dr({ now: 1000, maxSpeed: 1, limits: own }, t(["__proto__", 2]), "refuse", "limits");
});

test("REQ-GT-010 speed", () => {
  const L = { base: { min: -1, max: 1 } };
  dr(MS, mv({ speed: 1 }), "execute", "ok");
  dr(MS, mv({ speed: 1.5 }), "refuse", "speed");
  dr({ now: 1000, limits: L }, mv(), "execute", "ok");
  dr({ now: 1000, limits: L }, mv({ speed: 0.001 }), "refuse", "speed");
  dr({ now: 1000, maxSpeed: 0, limits: L }, mv(), "execute", "ok");
});

test("REQ-GT-011 confidence gates", () => {
  const g = (min: number, onFail: string, name = "control") => ({ ...MS, gates: { [name]: { min, onFail } } });
  dr(g(0.75, "block"), mv({ confidence: 0.5 }), "refuse", "confidence");
  dr(g(0.75, "block"), mv({ confidence: 0.75 }), "execute", "ok");
  dr(g(0.75, "block"), mv({ confidence: 0.7499999 }), "refuse", "confidence");
  dr(g(0.75, "block"), mv(), "execute", "ok");
  dr(g(0.75, "escalate"), mv({ confidence: 0.5 }), "hold", "confidence");
  dr(g(0.75, "block"), mv({ scope: "Control", confidence: 0.5 }), "refuse", "confidence");
  dr(g(0.75, "block", "Control"), mv({ scope: "Control", confidence: 0.5 }), "execute", "ok");
  dr(g(0.75, "block"), mv({ scope: "teleop", confidence: 0.5 }), "execute", "ok");
  dr(g(0.75, "block", "kick"), mv({ scope: "Kick", confidence: 0.5 }), "refuse", "confidence");
  dr({ ...MS, gates: {} }, mv({ scope: "toString", confidence: 0 }), "execute", "ok");
  dr(g(0, "block"), mv({ confidence: 0 }), "execute", "ok");
  dr(g(1, "escalate"), mv({ confidence: 0.9 }), "hold", "confidence");
  dr(g(1, "escalate"), mv({ confidence: 1 }), "execute", "ok");
  const r = run(g(0.75, "escalate"), mv({ confidence: 0.5 })).result;
  assert.deepEqual([r.state.seen, r.state.estopped, r.state.stopped], [[{ expires: 1030, id: "m1" }], false, false]);
});

// Deterministic pseudo-random generator for the properties.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const genState = (): any => {
  const s: any = { now: 1000, maxSpeed: pick([0, 1, 2]), limits: { base: { min: -2, max: 2 }, elbow: { min: -1, max: 1 } },
    gates: { control: { min: pick([0.5, 0.9]), onFail: pick(["block", "escalate"]) } } };
  if (rnd() < 0.5) s.estopped = rnd() < 0.5;
  if (rnd() < 0.5) s.stopped = rnd() < 0.5;
  if (rnd() < 0.3) s.minLoaControl = pick([1, 2, 3]);
  if (rnd() < 0.3) s.window = pick([30, 12, 10, 5]);
  if (rnd() < 0.5) s.seen = [{ id: pick(["a", "b", "c"]), expires: pick([995, 1000, 1000.5, 1010, 1030]) }];
  return s;
};
const genCmd = (): any => {
  const base = { id: pick(["a", "b", "c", "d"]), timestamp: pick([1000, 995, 990, 1004.5, 1005, 970, 989.5, 1005.5, 900]),
    role: pick(["GUEST", "OPERATOR", "CREATOR", "M2M_TRUSTED"]) };
  const k = pick(["safety", "status", "move", "move"]);
  if (k === "status") return { ...base, kind: k };
  if (k === "safety") return { ...base, kind: k, event: pick(["ESTOP", "STOP", "RESUME", "ESTOP_CLEAR"]) };
  return { ...base, kind: k, scope: pick(["control", "teleop", "safety"]), speed: pick([0, 1, 2]),
    targets: [{ joint: pick(["base", "elbow", "wrist"]), position: pick([-2.5, 0, 1, 2]) }],
    ...(rnd() < 0.5 ? { confidence: pick([0, 0.5, 1]) } : {}) };
};

test("PROP-GT-P1 ESTOP always carried out", () => {
  for (let i = 0; i < 200; i++) {
    const c = genCmd();
    const a = run(genState(), { id: c.id, timestamp: c.timestamp, role: c.role, kind: "safety", event: "ESTOP" });
    assert.deepEqual([a.result.decision, a.result.reason, a.result.state.estopped], ["execute", "estop", true]);
  }
});

test("PROP-GT-P2 nothing moves while e-stopped", () => {
  for (let i = 0; i < 200; i++) {
    const s = { ...genState(), estopped: true }, c = genCmd();
    const a = run(s, c);
    assert.ok(a.result.decision !== "execute" || c.kind === "status" || (c.kind === "safety" && c.event !== "RESUME"));
  }
});

test("PROP-GT-P3 only an executed safety event changes a latch", () => {
  for (let i = 0; i < 300; i++) {
    const s = genState(), c = genCmd(), a = run(s, c);
    assert.ok((a.result.decision === "execute" && c.kind === "safety") ||
      (a.result.state.estopped === (s.estopped ?? false) && a.result.state.stopped === (s.stopped ?? false)));
  }
});

test("PROP-GT-P4 a message ID works once", () => {
  for (let i = 0; i < 300; i++) {
    const s = genState(), c = genCmd(), a = run(s, c), b = run(a.result.state, c);
    assert.ok(["estop", "stale", "future"].includes(a.result.reason) || b.result.reason === "replay");
  }
});

test("driver protocol over stdio", () => {
  const input = [JSON.stringify({ id: "1", op: "decide", input: { state: { now: 1000 }, command: GUEST } }),
    "", " \t ", "{bad", JSON.stringify({ id: "2", op: "nope" })].join("\n") + "\n";
  const p = spawnSync(process.execPath, ["driver.ts"], { input, encoding: "utf8" });
  assert.equal(p.status, 0);
  const lines = p.stdout.split("\n");
  assert.equal(lines.pop(), "");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).result.reason, "status");
  assert.deepEqual(JSON.parse(lines[1]), { id: null, error: "bad_request" });
  assert.deepEqual(JSON.parse(lines[2]), { id: "2", error: "unknown_op" });
});

test("REQ-BU-001..004 folder", async () => {
  const fs = await import("node:fs");
  const cfg = JSON.parse(fs.readFileSync("REGEN.json", "utf8"));
  assert.deepEqual(Object.keys(cfg).sort(), ["build", "driver", "lang", "test"]);
  assert.equal(cfg.lang, "ts");
  assert.ok(!fs.existsSync("node_modules") && !fs.existsSync("package-lock.json"));
  let n = 0;
  for (const f of ["gate.ts", "driver.ts"]) n += fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).length;
  assert.ok(n <= 500, `source lines ${n}`);
});
