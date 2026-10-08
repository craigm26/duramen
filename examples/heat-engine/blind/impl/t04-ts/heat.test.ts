import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { canonical } from "./canonical.ts";
import { handle } from "./engine.ts";

const CLOCK = "1999-12-31T23:59:59.999Z";
function req(op: string, input: unknown, extra: object = {}) {
  return handle(JSON.stringify({ id: "x", op, input, clock: CLOCK, ...extra })) as any;
}
const audit = (r: any) => JSON.parse(r.audit);

test("REQ-IF-004 clock", () => {
  assert.equal(audit(req("flagF", { wetBulbF: 70 })).computed_at, CLOCK);
  assert.equal(audit(req("flagC", { wetBulbC: 30 })).children[0].computed_at, CLOCK);
});

test("REQ-IF-006 numbers", () => {
  const r = handle('{"id":"x","op":"wetBulb","input":{"tempC":2.0e1,"rhPercent":50.000},"clock":"c"}') as any;
  assert.equal(audit(r).result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  const f = req("flagC", { wetBulbC: "-Infinity" });
  assert.equal(f.result, null);
  assert.equal(JSON.stringify(audit(f).inputs), '{"wetBulbC":"-Infinity"}');
});

test("REQ-IF-007 errors", () => {
  assert.deepEqual(handle("{not json"), { id: null, error: "bad_request" });
  assert.deepEqual(handle("[1,2]"), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"op":"flagF","input":{"wetBulbF":80},"clock":"c"}'), { id: null, error: "bad_request" });
  assert.deepEqual(handle('{"id":"a","op":"heatIndex","input":{"tempC":20}}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(handle('{"id":"a","input":{}}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(handle('{"id":"a","op":"flagF","clock":"c"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(handle('{"id":"a","op":"flagF","input":{"wetBulbF":80}}'), { id: "a", error: "bad_request" });
  assert.equal(req("wetBulb", { tempC: 20 }).error, "bad_request");
  assert.equal(req("flagF", { wetBulbF: true }).error, "bad_request");
  assert.equal(req("flagF", { wetBulbF: "80" }).error, "bad_request");
});

test("REQ-IF-008 extra members", () => {
  const r = req("flagF", { wetBulbF: 86, note: "x" }, { trace: true });
  assert.deepEqual(r.result, { flag: "yellow", flagDartLabel: "high" });
});

test("REQ-CJ-005 canonical", () => {
  const c = (value: unknown) => handle(JSON.stringify({ id: "c", op: "canonical", input: { value } })) as any;
  const raw = handle('{"id":"c","op":"canonical","input":{"value":{"b":[1,2.50,1e21],"a":null}}}') as any;
  assert.equal(raw.result, '{"a":null,"b":[1,2.5,1e+21]}');
  assert.equal(c({ y: "Infinity", x: "NaN" }).result, '{"x":"NaN","y":"Infinity"}');
  assert.equal(c(null).result, "null");
  assert.equal(handle('{"id":"c","op":"canonical","input":{}}').error, "bad_request");
});

test("canonical edges", () => {
  assert.equal(canonical(-0), "0");
  assert.equal(canonical(1e-7), "1e-7");
  assert.equal(canonical(123456789012345680000), "123456789012345680000");
  assert.equal(canonical("\u0001\ud800/\u007f \b"), '"\\u0001\\ud800/\u007f \\b"');
  assert.equal(canonical("😀"), '"😀"');
  assert.equal(canonical({ "": 1, "\u{10000}": 2 }), '{"\u{10000}":2,"":1}');
});

test("REQ-AU-001 members", () => {
  const a = audit(req("flagF", { wetBulbF: 85 }));
  assert.equal(a.spec_version, "0.2.0");
  assert.equal(a.function, "flagFromWetBulbF");
  assert.deepEqual(Object.keys(a).sort(), ["citation", "computed_at", "constants", "function", "inputs", "result_summary", "spec_version"]);
});

test("REQ-AU-002 non-finite inputs", () => {
  const r = req("wetBulb", { tempC: "Infinity", rhPercent: "NaN" });
  assert.equal(JSON.stringify(audit(r).inputs), '{"rhPercent":"NaN","tempC":"Infinity"}');
});

test("REQ-WB-001/002 values", () => {
  const rows: [number, number, number, number | undefined][] = [
    [20, 50, 13.69934, undefined], [25, 120, 25.04558, 100], [30, 2.5, 10.77218, 5],
    [25, 99.5, 24.97823, undefined], [60, 50, 48.08736, undefined], [-30, 50, -29.31486, undefined],
  ];
  for (const [t, rh, w, c] of rows) {
    const r = req("wetBulb", { tempC: t, rhPercent: rh });
    assert.ok(Math.abs(r.result.wetBulbC - w) <= 0.00001);
    assert.equal(r.result.clampedRhPct, c);
    assert.ok(Math.abs(r.result.wetBulbF - ((r.result.wetBulbC * 9) / 5 + 32)) < 1e-9);
  }
});

test("REQ-WB-003 audit", () => {
  const a = audit(req("wetBulb", { tempC: 25, rhPercent: 120 }));
  assert.equal(JSON.stringify(a.inputs), '{"rhPercent":120,"tempC":25}');
  assert.equal(JSON.stringify(a.constants), '{"rh_clamp_max":100,"rh_clamp_min":5,"stull_a":0.151977,"stull_b":8.313659,"stull_c":1.676331,"stull_d":0.00391838,"stull_e":0.023101,"stull_offset":-4.686035}');
  const s = (t: number, rh: number) => audit(req("wetBulb", { tempC: t, rhPercent: rh })).result_summary;
  assert.equal(s(20, 50), "T=20.0°C RH=50% → Tw=13.70°C");
  assert.equal(s(25, 120), "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C");
  assert.equal(s(60, 2.5), "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C");
  assert.equal(s(20.25, 50), "T=20.3°C RH=50% → Tw=13.91°C");
  assert.equal(s(-0.04, 50), "T=-0.0°C RH=50% → Tw=-3.53°C");
  assert.equal(JSON.stringify(audit(req("wetBulb", { tempC: 20, rhPercent: 50 })).constants).includes("rh_clamp"), false);
});

test("REQ-WB-004 non-finite", () => {
  const rows: [any, any, string][] = [
    ["NaN", 50, "tempC"], [20, "NaN", "rhPercent"], ["Infinity", 50, "tempC"],
    [20, "-Infinity", "rhPercent"], ["NaN", "NaN", "tempC"],
  ];
  for (const [t, rh, w] of rows) {
    const r = req("wetBulb", { tempC: t, rhPercent: rh });
    assert.equal(r.result, null);
    const a = audit(r);
    assert.equal(a.result_summary, "invalid_input:" + w);
    assert.deepEqual(a.constants, {});
    assert.equal(a.citation, "Stull (2011) eq. 1");
  }
});

test("REQ-WB-005 from F", () => {
  let a = audit(req("wetBulbF", { tempF: 68, rhPercent: 50 }));
  assert.equal(a.result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  assert.equal(JSON.stringify(a.inputs), '{"rhPercent":50,"tempC":20}');
  assert.equal(a.function, "calculateWetBulb");
  a = audit(req("wetBulbF", { tempF: 100, rhPercent: 40 }));
  assert.equal(JSON.stringify(a.inputs), '{"rhPercent":40,"tempC":37.77777777777778}');
  a = audit(req("wetBulbF", { tempF: 98.6, rhPercent: 50 }));
  assert.equal(JSON.stringify(a.inputs), '{"rhPercent":50,"tempC":37}');
  const r = req("wetBulbF", { tempF: "NaN", rhPercent: 50 });
  assert.equal(r.result, null);
  assert.equal(audit(r).result_summary, "invalid_input:tempC");
});

test("REQ-FL-001 bands", () => {
  const rows: [number, string, string][] = [
    [79.99, "white", "low"], [80, "green", "moderate"], [84.99, "green", "moderate"],
    [85, "yellow", "high"], [88, "red", "extreme"], [89.99, "red", "extreme"], [90, "black", "critical"],
  ];
  for (const [w, f, l] of rows) assert.deepEqual(req("flagF", { wetBulbF: w }).result, { flag: f, flagDartLabel: l });
});

test("REQ-FL-002 audit", () => {
  const s = (w: number) => audit(req("flagF", { wetBulbF: w })).result_summary;
  assert.equal(s(85), "wetBulbF=85 → yellow");
  assert.equal(s(250), "wetBulbF=250 → black (out_of_observed_range)");
  assert.equal(s(-60), "wetBulbF=-60 → white (out_of_observed_range)");
  assert.equal(s(200), "wetBulbF=200 → black");
  const a = audit(req("flagF", { wetBulbF: 85 }));
  assert.equal(a.citation, "USMC 6200.1E Table 3-1");
  assert.deepEqual(a.constants, { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 });
});

test("REQ-FL-003 non-finite F", () => {
  const r = req("flagF", { wetBulbF: "NaN" });
  assert.equal(r.result, null);
  const a = audit(r);
  assert.equal(a.result_summary, "invalid_input:wetBulbF");
  assert.deepEqual(a.constants, {});
});

test("REQ-FL-004 flag from C", () => {
  const rows: [number, string][] = [[26.66666666666666, "white"], [30, "yellow"], [29.444444444444443, "yellow"], [29.444444443444443, "green"]];
  for (const [c, f] of rows) assert.equal(req("flagC", { wetBulbC: c }).result.flag, f);
});

test("REQ-FL-005 C audit", () => {
  let a = audit(req("flagC", { wetBulbC: 30 }));
  assert.equal(a.result_summary, "wetBulbC=30 → wetBulbF=86.0000 → yellow");
  assert.equal(a.children.length, 1);
  assert.equal(a.children[0].result_summary, "wetBulbF=86 → yellow");
  assert.equal(a.function, "flagFromWetBulbC");
  a = audit(req("flagC", { wetBulbC: 26.66666666666666 }));
  assert.equal(a.result_summary, "wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white");
});

test("REQ-FL-006 non-finite C", () => {
  const r = req("flagC", { wetBulbC: "NaN" });
  assert.equal(r.result, null);
  const a = audit(r);
  assert.equal(a.result_summary, "invalid_input:wetBulbC");
  assert.equal("children" in a, false);
  assert.deepEqual(a.constants, {});
});

test("driver protocol", () => {
  const input = '\n  \t\n{"id":"1","op":"flagF","input":{"wetBulbF":80},"clock":"2026-05-26T17:00:00.000Z"}\r\nnope\n{"id":"2","op":"canonical","input":{"value":[1]}}';
  const p = spawnSync("node", ["driver.ts"], { input, encoding: "utf8" });
  assert.equal(p.status, 0);
  const lines = p.stdout.split("\n");
  assert.equal(lines.pop(), "");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).id, "1");
  assert.deepEqual(JSON.parse(lines[1]), { id: null, error: "bad_request" });
  assert.deepEqual(JSON.parse(lines[2]), { id: "2", result: "[1]" });
  assert.ok(!p.stdout.includes("\r"));
});
