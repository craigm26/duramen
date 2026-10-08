import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { handleInput, handleLine } from "../src/driver.ts";

const CLOCK = "2026-05-26T17:00:00.000Z";

// Send one request in-process; returns the parsed response.
function call(op: string, input: unknown, extra: Record<string, unknown> = {}): any {
  return JSON.parse(handleLine(JSON.stringify({ id: "t", op, input, clock: CLOCK, ...extra })));
}
const audit = (r: any) => JSON.parse(r.audit);
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("REQ-IF-004 clock is copied to every audit", () => {
  const c = "1999-12-31T23:59:59.999Z";
  assert.equal(audit(call("flagF", { wetBulbF: 70 }, { clock: c })).computed_at, c);
  const a = audit(call("flagC", { wetBulbC: 30 }, { clock: c }));
  assert.equal(a.computed_at, c);
  assert.equal(a.children[0].computed_at, c);
});

test("REQ-IF-006 numbers are binary64; special strings accepted", () => {
  const r = handleLine('{"id":"a","op":"wetBulb","input":{"tempC":2.0e1,"rhPercent":50.000},"clock":"' + CLOCK + '"}');
  assert.equal(audit(JSON.parse(r)).result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  const f = call("flagC", { wetBulbC: "-Infinity" });
  assert.equal(f.result, null);
  assert.equal(audit(f).inputs.wetBulbC, "-Infinity");
  assert.equal(audit(f).inputs.wetBulbC, "-Infinity");
});

test("REQ-IF-007 errors and their order", () => {
  const e = (line: string) => JSON.parse(handleLine(line));
  assert.deepEqual(e("{not json"), { id: null, error: "bad_request" });
  assert.deepEqual(e("[1,2]"), { id: null, error: "bad_request" });
  assert.deepEqual(e('{"op":"flagF","input":{"wetBulbF":80},"clock":"x"}'), { id: null, error: "bad_request" });
  assert.deepEqual(e('{"id":5,"op":"flagF"}'), { id: null, error: "bad_request" });
  assert.deepEqual(e('{"id":"a","op":"heatIndex","input":{"tempC":20},"clock":"x"}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(e('{"id":"a","input":{"wetBulbF":80},"clock":"x"}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(e('{"id":"a","op":"heatIndex"}'), { id: "a", error: "unknown_op" });
  assert.deepEqual(e('{"id":"a","op":"flagF","clock":"x"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(e('{"id":"a","op":"flagF","input":[],"clock":"x"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(e('{"id":"a","op":"flagF","input":{"wetBulbF":80}}'), { id: "a", error: "bad_request" });
  assert.deepEqual(e('{"id":"a","op":"wetBulb","input":{"tempC":20},"clock":"x"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(e('{"id":"a","op":"flagF","input":{"wetBulbF":true},"clock":"x"}'), { id: "a", error: "bad_request" });
  assert.deepEqual(e('{"id":"a","op":"flagF","input":{"wetBulbF":"80"},"clock":"x"}'), { id: "a", error: "bad_request" });
  // the driver continues after errors
  const out = handleInput('{bad\n\n  \t\n{"id":"b","op":"canonical","input":{"value":1}}\n').split("\n");
  assert.equal(out.length, 3);
  assert.equal(JSON.parse(out[1]).result, "1");
});

test("REQ-IF-008 extra members ignored", () => {
  const r = JSON.parse(handleLine('{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},"clock":"' + CLOCK + '","trace":true}'));
  assert.deepEqual(r.result, { flag: "yellow", flagDartLabel: "high" });
});

test("REQ-CJ-005 canonical operation and edges", () => {
  const c = (value: unknown) => call("canonical", { value }, { clock: undefined });
  assert.equal(c({ b: [1, 2.5, 1e21], a: null }).result, '{"a":null,"b":[1,2.5,1e+21]}');
  assert.equal(c({ y: "Infinity", x: "NaN" }).result, '{"x":"NaN","y":"Infinity"}');
  assert.equal(c(null).result, "null");
  assert.ok(!("audit" in c(1)));
  assert.deepEqual(JSON.parse(handleLine('{"id":"a","op":"canonical","input":{}}')), { id: "a", error: "bad_request" });
  const t = (line: string) => JSON.parse(handleLine(`{"id":"a","op":"canonical","input":{"value":${line}}}`)).result;
  assert.equal(t("1e-7"), "1e-7");
  assert.equal(t("123456789012345680000"), "123456789012345680000");
  assert.equal(t("-0"), "0");
  assert.equal(t("0.000001"), "0.000001");
  assert.equal(t("1.5e300"), "1.5e+300");
  assert.equal(t('"\\ud800 \\u0001\\u007f/\\u2028\\b\\f\\n\\r\\t\\"\\\\"'), '"\\ud800 \\u0001\x7f/\u2028\\b\\f\\n\\r\\t\\"\\\\"');
  assert.equal(t('"\\ud83d\\ude00"'), '"😀"');
  assert.equal(t('{"\\ue000":1,"\\ud83d\\ude00":2}'), '{"😀":2,"\ue000":1}');
});

test("PROP-CJ-P1 / PROP-AU-P1 canonical is a fixed point", () => {
  for (let i = 0; i < 100; i++) {
    const t = -20 + (i * 70) / 100, rh = (i * 1.2 * 37) % 120;
    const a = call("wetBulb", { tempC: t, rhPercent: rh });
    const b = call("flagC", { wetBulbC: a.result.wetBulbC });
    assert.equal(call("canonical", { value: JSON.parse(a.audit) }).result, a.audit);
    assert.equal(call("canonical", { value: JSON.parse(b.audit) }).result, b.audit);
  }
});

test("REQ-AU-001 audit members", () => {
  const a = audit(call("flagF", { wetBulbF: 85 }));
  assert.deepEqual(Object.keys(a).sort(), ["citation", "computed_at", "constants", "function", "inputs", "result_summary", "spec_version"]);
  assert.equal(a.spec_version, "0.2.0");
  assert.equal(a.function, "flagFromWetBulbF");
  assert.deepEqual(Object.keys(audit(call("flagC", { wetBulbC: 30 }))).includes("children"), true);
  const raw = call("flagF", { wetBulbF: 86.5 }).audit;
  assert.ok(!raw.includes(" ") || raw.includes("→"));
  assert.equal(raw, '{"citation":"USMC 6200.1E Table 3-1","computed_at":"' + CLOCK + '","constants":{"green_max":85,"red_max":90,"white_max":80,"yellow_max":88},"function":"flagFromWetBulbF","inputs":{"wetBulbF":86.5},"result_summary":"wetBulbF=86.5 → yellow","spec_version":"0.2.0"}');
});

test("REQ-AU-002 non-finite inputs in audits", () => {
  const r = call("wetBulb", { tempC: "Infinity", rhPercent: "NaN" });
  assert.deepEqual(audit(r).inputs, { rhPercent: "NaN", tempC: "Infinity" });
});

test("REQ-WB-001 formula and clamping", () => {
  const rows: [number, number, number, number | undefined][] = [
    [20, 50, 13.69934, undefined], [25, 120, 25.04558, 100], [30, 2.5, 10.77218, 5], [25, 99.5, 24.97823, undefined],
    [20, 80, 17.529271, undefined], [40, 20, 22.703918, undefined], [-40, 50, -37.960282, undefined], [-60, 10, -42.258361, undefined],
  ];
  for (const [t, rh, c, clamp] of rows) {
    const r = call("wetBulb", { tempC: t, rhPercent: rh }).result;
    near(r.wetBulbC, c, 0.00001);
    assert.equal(r.clampedRhPct, clamp);
    assert.equal(r.wetBulbF, (r.wetBulbC * 9) / 5 + 32);
  }
  near(call("wetBulb", { tempC: 20, rhPercent: 80 }).result.wetBulbF, 63.552687, 0.000018001);
  near(call("wetBulb", { tempC: -60, rhPercent: 90 }).result.wetBulbF, -76.085181, 0.000018001);
});

test("PROP-WB-P8/P2/P3 clamping", () => {
  for (const rh of [4.999999, 5, 5.000001, 5.5, 6, 50, 99.999999, 100, 100.000001, 101]) {
    const r = call("wetBulb", { tempC: 22, rhPercent: rh }).result;
    assert.equal("clampedRhPct" in r, rh < 5 || rh > 100);
  }
  for (const rh of [100.001, 250, 1000]) {
    const a = call("wetBulb", { tempC: 31, rhPercent: rh }).result, b = call("wetBulb", { tempC: 31, rhPercent: 100 }).result;
    assert.equal(a.wetBulbC, b.wetBulbC);
    assert.equal(a.wetBulbF, b.wetBulbF);
    assert.equal(a.clampedRhPct, 100);
    assert.ok(!("clampedRhPct" in b));
  }
  for (const rh of [-100, -1, 0, 4.999]) {
    const a = call("wetBulb", { tempC: 12, rhPercent: rh }).result, b = call("wetBulb", { tempC: 12, rhPercent: 5 }).result;
    assert.equal(a.wetBulbC, b.wetBulbC);
    assert.equal(a.clampedRhPct, 5);
  }
});

test("PROP-WB-P5 monotonic from 5 C", () => {
  for (let t = 5; t <= 50; t += 5) {
    for (let rh = 5; rh <= 99; rh += 7) {
      assert.ok(call("wetBulb", { tempC: t, rhPercent: rh + 1 }).result.wetBulbC > call("wetBulb", { tempC: t, rhPercent: rh }).result.wetBulbC);
    }
  }
});

test("REQ-WB-002 temperature not clamped", () => {
  near(call("wetBulb", { tempC: 60, rhPercent: 50 }).result.wetBulbC, 48.08736, 0.00001);
  near(call("wetBulb", { tempC: -30, rhPercent: 50 }).result.wetBulbC, -29.31486, 0.00001);
});

test("REQ-WB-003 wet-bulb audit", () => {
  const a = audit(call("wetBulb", { tempC: 25, rhPercent: 120 }));
  assert.equal(a.function, "calculateWetBulb");
  assert.equal(a.citation, "Stull (2011) eq. 1");
  assert.deepEqual(a.inputs, { rhPercent: 120, tempC: 25 });
  assert.deepEqual(a.constants, { rh_clamp_max: 100, rh_clamp_min: 5, stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331, stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035 });
  const rows: [number, number, string][] = [
    [20, 50, "T=20.0°C RH=50% → Tw=13.70°C"],
    [25, 120, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"],
    [60, 2.5, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"],
    [20.25, 50, "T=20.3°C RH=50% → Tw=13.91°C"],
    [-0.04, 50, "T=-0.0°C RH=50% → Tw=-3.53°C"],
  ];
  for (const [t, rh, s] of rows) assert.equal(audit(call("wetBulb", { tempC: t, rhPercent: rh })).result_summary, s);
  assert.equal(Object.keys(audit(call("wetBulb", { tempC: 20, rhPercent: 50 })).constants).length, 6);
});

test("PROP-WB-P7 / P6 validity marker and inputs as given", () => {
  for (const t of [-20, 50, -20.000001, 50.000001, -19.999999, 49.999999, -60, 60, 0]) {
    const a = audit(call("wetBulb", { tempC: t, rhPercent: 40 }));
    assert.equal(a.result_summary.includes("out_of_validity_range"), t < -20 || t > 50);
    assert.deepEqual(a.inputs, { tempC: t, rhPercent: 40 });
  }
});

test("REQ-WB-004 non-finite wet-bulb input", () => {
  const rows: [unknown, unknown, string][] = [
    ["NaN", 50, "tempC"], [20, "NaN", "rhPercent"], ["Infinity", 50, "tempC"], [20, "-Infinity", "rhPercent"], ["NaN", "NaN", "tempC"],
  ];
  for (const [t, rh, bad] of rows) {
    const r = call("wetBulb", { tempC: t, rhPercent: rh });
    assert.equal(r.result, null);
    const a = audit(r);
    assert.equal(a.result_summary, "invalid_input:" + bad);
    assert.deepEqual(a.constants, {});
    assert.equal(a.function, "calculateWetBulb");
    assert.equal(a.citation, "Stull (2011) eq. 1");
    assert.deepEqual(a.inputs, { tempC: t, rhPercent: rh });
  }
});

test("REQ-WB-005 / PROP-WB-P1 wetBulbF", () => {
  const a = call("wetBulbF", { tempF: 68, rhPercent: 50 });
  assert.equal(audit(a).result_summary, "T=20.0°C RH=50% → Tw=13.70°C");
  assert.deepEqual(audit(a).inputs, { rhPercent: 50, tempC: 20 });
  assert.deepEqual(audit(call("wetBulbF", { tempF: 100, rhPercent: 40 })).inputs, { rhPercent: 40, tempC: 37.77777777777778 });
  assert.deepEqual(audit(call("wetBulbF", { tempF: 98.6, rhPercent: 50 })).inputs, { rhPercent: 50, tempC: 37 });
  const n = call("wetBulbF", { tempF: "NaN", rhPercent: 50 });
  assert.equal(n.result, null);
  assert.equal(audit(n).result_summary, "invalid_input:tempC");
  for (let f = -100; f <= 200; f += 13.7) {
    const x = call("wetBulbF", { tempF: f, rhPercent: 33 }), y = call("wetBulb", { tempC: ((f - 32) * 5) / 9, rhPercent: 33 });
    assert.deepEqual(x.result, y.result);
    assert.equal(x.audit, y.audit);
  }
});

test("REQ-FL-001 flag bands", () => {
  const rows: [number, string, string][] = [
    [79.99, "white", "low"], [80, "green", "moderate"], [84.99, "green", "moderate"], [85, "yellow", "high"],
    [88, "red", "extreme"], [89.99, "red", "extreme"], [90, "black", "critical"], [-60, "white", "low"], [250, "black", "critical"],
  ];
  for (const [w, f, l] of rows) assert.deepEqual(call("flagF", { wetBulbF: w }).result, { flag: f, flagDartLabel: l });
});

test("PROP-FL-P3 monotonic flags", () => {
  const rank: Record<string, number> = { white: 0, green: 1, yellow: 2, red: 3, black: 4 };
  let prev = 0;
  for (let w = -60; w <= 250; w += 0.5) {
    const r = rank[call("flagF", { wetBulbF: w }).result.flag];
    assert.ok(r >= prev);
    prev = r;
  }
});

test("REQ-FL-002 flag audit", () => {
  const rows: [number, string][] = [
    [85, "wetBulbF=85 → yellow"], [250, "wetBulbF=250 → black (out_of_observed_range)"],
    [-60, "wetBulbF=-60 → white (out_of_observed_range)"], [200, "wetBulbF=200 → black"], [-50, "wetBulbF=-50 → white"],
    [200.000001, "wetBulbF=200.000001 → black (out_of_observed_range)"],
  ];
  for (const [w, s] of rows) assert.equal(audit(call("flagF", { wetBulbF: w })).result_summary, s);
  assert.deepEqual(audit(call("flagF", { wetBulbF: 86.5 })).constants, { green_max: 85, red_max: 90, white_max: 80, yellow_max: 88 });
});

test("REQ-FL-003 non-finite F", () => {
  const r = call("flagF", { wetBulbF: "NaN" });
  assert.equal(r.result, null);
  const a = audit(r);
  assert.equal(a.result_summary, "invalid_input:wetBulbF");
  assert.deepEqual(a.constants, {});
  assert.deepEqual(a.inputs, { wetBulbF: "NaN" });
  assert.equal(a.function, "flagFromWetBulbF");
});

test("REQ-FL-004 flag from C", () => {
  const rows: [number, string][] = [[26.66666666666666, "white"], [30, "yellow"], [29.444444444444443, "yellow"], [29.444444443444443, "green"]];
  for (const [c, f] of rows) assert.equal(call("flagC", { wetBulbC: c }).result.flag, f);
});

test("REQ-FL-005 / PROP-FL-P1 flagC audit with child", () => {
  const r = call("flagC", { wetBulbC: 30 });
  const a = audit(r);
  assert.equal(a.result_summary, "wetBulbC=30 → wetBulbF=86.0000 → yellow");
  assert.equal(a.children[0].result_summary, "wetBulbF=86 → yellow");
  assert.equal(a.function, "flagFromWetBulbC");
  assert.equal(a.citation, "USMC 6200.1E Table 3-1");
  assert.equal(audit(call("flagC", { wetBulbC: 26.66666666666666 })).result_summary, "wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white");
  for (let c = -50; c <= 60; c += 1.37) {
    const x = call("flagC", { wetBulbC: c }), y = call("flagF", { wetBulbF: (c * 9) / 5 + 32 });
    assert.deepEqual(x.result, y.result);
    assert.deepEqual(audit(x).children, [audit(y)]);
  }
});

test("REQ-FL-006 non-finite C", () => {
  const r = call("flagC", { wetBulbC: "NaN" });
  assert.equal(r.result, null);
  const a = audit(r);
  assert.equal(a.result_summary, "invalid_input:wetBulbC");
  assert.equal(a.function, "flagFromWetBulbC");
  assert.equal(a.citation, "USMC 6200.1E Table 3-1");
  assert.deepEqual(a.constants, {});
  assert.ok(!("children" in a));
});

test("driver process: stdin to stdout, LF only, exit 0", () => {
  const input = '{"id":"1","op":"flagF","input":{"wetBulbF":85},"clock":"' + CLOCK + '"}\r\n\n   \n[1]\n';
  const p = spawnSync("node", ["driver.ts"], { input, encoding: "utf8" });
  assert.equal(p.status, 0);
  const lines = p.stdout.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  assert.ok(!p.stdout.includes("\r"));
  assert.equal(JSON.parse(lines[0]).id, "1");
  assert.deepEqual(JSON.parse(lines[1]), { id: null, error: "bad_request" });
});

test("REQ-BU-001 REGEN.json shape", async () => {
  const { readFileSync } = await import("node:fs");
  const r = JSON.parse(readFileSync(new URL("../REGEN.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(r).sort(), ["build", "driver", "lang", "test"]);
  assert.equal(r.lang, "ts");
});
