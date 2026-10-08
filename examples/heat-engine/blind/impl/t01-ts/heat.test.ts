import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { handle } from "./driver.ts";

const CLK = "2026-05-26T17:00:00.000Z";

function run(op: string, input: unknown, extra: Record<string, unknown> = { clock: CLK }) {
  const line = JSON.stringify({ id: "t", op, input, ...extra });
  const r = JSON.parse(handle(line));
  if (r.audit !== undefined) r.auditObj = JSON.parse(r.audit);
  return r;
}

test("REQ-IF-004 clock is echoed in audit and children", () => {
  const c = "1999-12-31T23:59:59.999Z";
  assert.equal(run("flagF", { wetBulbF: 70 }, { clock: c }).auditObj.computed_at, c);
  assert.equal(run("flagC", { wetBulbC: 30 }, { clock: c }).auditObj.children[0].computed_at, c);
});

test("REQ-IF-006 numbers and special strings", () => {
  const line = '{"id":"a","op":"wetBulb","input":{"tempC":2.0e1,"rhPercent":50.000},"clock":"' + CLK + '"}';
  assert.equal(JSON.parse(JSON.parse(handle(line)).audit).result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  const r = run("flagC", { wetBulbC: "-Infinity" });
  assert.equal(r.result, null);
  assert.equal(r.audit, JSON.stringify(r.auditObj).length ? r.audit : "");
  assert.deepEqual(r.auditObj.inputs, { wetBulbC: "-Infinity" });
});

test("REQ-IF-007 errors and order", () => {
  const e = (l: string) => JSON.parse(handle(l));
  assert.deepEqual(e("{not json"), { id: null, error: "bad_request" });
  assert.deepEqual(e("[1,2]"), { id: null, error: "bad_request" });
  assert.deepEqual(e('{"op":"flagF","input":{"wetBulbF":80},"clock":"x"}'), { id: null, error: "bad_request" });
  assert.deepEqual(e('{"id":"1","op":"heatIndex","input":{"tempC":20}}'), { id: "1", error: "unknown_op" });
  assert.deepEqual(e('{"id":"1","input":{}}'), { id: "1", error: "unknown_op" });
  assert.deepEqual(e('{"id":"1","op":"flagF"}'), { id: "1", error: "bad_request" });
  assert.deepEqual(e('{"id":"1","op":"flagF","input":{"wetBulbF":80}}'), { id: "1", error: "bad_request" });
  assert.deepEqual(run("wetBulb", { tempC: 20 }), { id: "t", error: "bad_request" });
  assert.deepEqual(run("flagF", { wetBulbF: true }), { id: "t", error: "bad_request" });
  assert.deepEqual(run("flagF", { wetBulbF: "80" }), { id: "t", error: "bad_request" });
});

test("REQ-IF-008 extra members ignored", () => {
  const l = '{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},"clock":"' + CLK + '","trace":true}';
  assert.deepEqual(JSON.parse(handle(l)).result, { flag: "yellow", flagDartLabel: "high" });
});

test("REQ-CJ-005 canonical", () => {
  const c = (l: string) => JSON.parse(handle(l)).result;
  assert.equal(c('{"id":"c","op":"canonical","input":{"value":{"b":[1,2.50,1e21],"a":null}}}'), '{"a":null,"b":[1,2.5,1e+21]}');
  assert.equal(c('{"id":"c","op":"canonical","input":{"value":{"y":"Infinity","x":"NaN"}}}'), '{"x":"NaN","y":"Infinity"}');
  assert.equal(c('{"id":"c","op":"canonical","input":{"value":[-0,1e-7,0.000001,123456789012345680000]}}'), "[0,1e-7,0.000001,123456789012345680000]");
  assert.equal(c('{"id":"c","op":"canonical","input":{"value":"\\u0001\\ud800/\\u007f\\u2028\\ud83d\\ude00\\n"}}'), '"\\u0001\\ud800/\x7f 😀\\n"');
  assert.equal(c('{"id":"c","op":"canonical","input":{"value":{"\\uffee":1,"\\ud83d\\ude00":2}}}'), '{"😀":2,"￮":1}');
  assert.equal(JSON.parse(handle('{"id":"c","op":"canonical","input":{"value":1}}')).audit, undefined);
});

test("REQ-AU-001 audit members", () => {
  const a = run("flagF", { wetBulbF: 85 }).auditObj;
  assert.equal(a.spec_version, "0.2.0");
  assert.equal(a.function, "flagFromWetBulbF");
  assert.equal(a.computed_at, CLK);
  assert.deepEqual(Object.keys(a).sort(), ["citation", "computed_at", "constants", "function", "inputs", "result_summary", "spec_version"]);
  assert.equal(run("flagF", { wetBulbF: 85 }).audit, JSON.stringify(Object.fromEntries(Object.entries(a).sort())).replace(/ /g, " "));
});

test("REQ-AU-002 non-finite inputs", () => {
  const r = run("wetBulb", { tempC: "Infinity", rhPercent: "NaN" });
  assert.match(r.audit, /"inputs":\{"rhPercent":"NaN","tempC":"Infinity"\}/);
});

test("REQ-WB-001 wet-bulb values", () => {
  const rows: [number, number, number, number | undefined][] = [
    [20, 50, 13.69934, undefined], [25, 120, 25.04558, 100], [30, 2.5, 10.77218, 5], [25, 99.5, 24.97823, undefined],
  ];
  for (const [t, rh, w, cl] of rows) {
    const r = run("wetBulb", { tempC: t, rhPercent: rh });
    assert.ok(Math.abs(r.result.wetBulbC - w) <= 0.00001);
    assert.equal(r.result.clampedRhPct, cl);
    assert.ok(Math.abs(r.result.wetBulbF - ((w * 9) / 5 + 32)) <= 0.000018001);
  }
});

test("REQ-WB-002 no temperature clamp", () => {
  assert.ok(Math.abs(run("wetBulb", { tempC: 60, rhPercent: 50 }).result.wetBulbC - 48.08736) <= 0.00001);
  assert.ok(Math.abs(run("wetBulb", { tempC: -30, rhPercent: 50 }).result.wetBulbC + 29.31486) <= 0.00001);
});

test("REQ-WB-003 wet-bulb audit", () => {
  const a = run("wetBulb", { tempC: 25, rhPercent: 120 }).auditObj;
  assert.deepEqual(a.inputs, { tempC: 25, rhPercent: 120 });
  assert.deepEqual(a.constants, { stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331, stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035, rh_clamp_min: 5, rh_clamp_max: 100 });
  const rows: [number, number, string][] = [
    [20, 50, "T=20.0°C RH=50% → Tw=13.70°C"],
    [25, 120, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"],
    [60, 2.5, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"],
    [20.25, 50, "T=20.3°C RH=50% → Tw=13.91°C"],
    [-0.04, 50, "T=-0.0°C RH=50% → Tw=-3.53°C"],
  ];
  for (const [t, rh, s] of rows) assert.equal(run("wetBulb", { tempC: t, rhPercent: rh }).auditObj.result_summary, s);
  assert.equal(run("wetBulb", { tempC: 20, rhPercent: 50 }).auditObj.constants.rh_clamp_min, undefined);
});

test("REQ-WB-004 non-finite wet-bulb", () => {
  const rows: [unknown, unknown, string][] = [
    ["NaN", 50, "tempC"], [20, "NaN", "rhPercent"], ["Infinity", 50, "tempC"], [20, "-Infinity", "rhPercent"], ["NaN", "NaN", "tempC"],
  ];
  for (const [t, rh, f] of rows) {
    const r = run("wetBulb", { tempC: t, rhPercent: rh });
    assert.equal(r.result, null);
    assert.equal(r.auditObj.result_summary, "invalid_input:" + f);
    assert.deepEqual(r.auditObj.constants, {});
    assert.equal(r.auditObj.citation, "Stull (2011) eq. 1");
  }
});

test("REQ-WB-005 wet-bulb from F", () => {
  let r = run("wetBulbF", { tempF: 68, rhPercent: 50 });
  assert.equal(r.auditObj.result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  assert.deepEqual(r.auditObj.inputs, { tempC: 20, rhPercent: 50 });
  assert.equal(r.auditObj.function, "calculateWetBulb");
  assert.deepEqual(run("wetBulbF", { tempF: 100, rhPercent: 40 }).auditObj.inputs, { tempC: 37.77777777777778, rhPercent: 40 });
  assert.deepEqual(run("wetBulbF", { tempF: 98.6, rhPercent: 50 }).auditObj.inputs, { tempC: 37, rhPercent: 50 });
  r = run("wetBulbF", { tempF: "NaN", rhPercent: 50 });
  assert.equal(r.result, null);
  assert.equal(r.auditObj.result_summary, "invalid_input:tempC");
});

test("REQ-FL-001 flag bands", () => {
  const rows: [number, string, string][] = [
    [79.99, "white", "low"], [80, "green", "moderate"], [84.99, "green", "moderate"], [85, "yellow", "high"],
    [88, "red", "extreme"], [89.99, "red", "extreme"], [90, "black", "critical"],
  ];
  for (const [w, f, l] of rows) assert.deepEqual(run("flagF", { wetBulbF: w }).result, { flag: f, flagDartLabel: l });
});

test("REQ-FL-002 flag audit", () => {
  const rows: [number, string][] = [
    [85, "wetBulbF=85 → yellow"], [250, "wetBulbF=250 → black (out_of_observed_range)"],
    [-60, "wetBulbF=-60 → white (out_of_observed_range)"], [200, "wetBulbF=200 → black"],
  ];
  for (const [w, s] of rows) assert.equal(run("flagF", { wetBulbF: w }).auditObj.result_summary, s);
  const a = run("flagF", { wetBulbF: 85 }).auditObj;
  assert.equal(a.citation, "USMC 6200.1E Table 3-1");
  assert.deepEqual(a.constants, { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 });
  assert.deepEqual(a.inputs, { wetBulbF: 85 });
});

test("REQ-FL-003 non-finite F", () => {
  const r = run("flagF", { wetBulbF: "NaN" });
  assert.equal(r.result, null);
  assert.equal(r.auditObj.result_summary, "invalid_input:wetBulbF");
  assert.deepEqual(r.auditObj.constants, {});
});

test("REQ-FL-004 flag from C", () => {
  const rows: [number, string][] = [[26.66666666666666, "white"], [30, "yellow"], [29.444444444444443, "yellow"], [29.444444443444443, "green"]];
  for (const [c, f] of rows) assert.equal(run("flagC", { wetBulbC: c }).result.flag, f);
});

test("REQ-FL-005 flag C audit", () => {
  let a = run("flagC", { wetBulbC: 30 }).auditObj;
  assert.equal(a.result_summary, "wetBulbC=30 → wetBulbF=86.0000 → yellow");
  assert.equal(a.children.length, 1);
  assert.equal(a.children[0].result_summary, "wetBulbF=86 → yellow");
  assert.equal(a.function, "flagFromWetBulbC");
  a = run("flagC", { wetBulbC: 26.66666666666666 }).auditObj;
  assert.equal(a.result_summary, "wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white");
});

test("REQ-FL-006 non-finite C", () => {
  const r = run("flagC", { wetBulbC: "NaN" });
  assert.equal(r.result, null);
  assert.equal(r.auditObj.result_summary, "invalid_input:wetBulbC");
  assert.equal(r.auditObj.children, undefined);
});

test("driver process: blank lines, order, exit status", () => {
  const input = '\n{"id":"1","op":"flagF","input":{"wetBulbF":80},"clock":"' + CLK + '"}\n   \nbad\n';
  const p = spawnSync("node", ["driver.ts"], { input, encoding: "utf8" });
  assert.equal(p.status, 0);
  const lines = p.stdout.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).id, "1");
  assert.deepEqual(JSON.parse(lines[1]), { id: null, error: "bad_request" });
});
