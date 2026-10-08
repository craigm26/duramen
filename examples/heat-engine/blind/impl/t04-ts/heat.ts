import { canonical } from "./canonical.ts";

export type Audit = Record<string, unknown>;
export type Outcome = { result: unknown; audit: Audit };

const WB_CITATION = "Stull (2011) eq. 1";
const FLAG_CITATION = "USMC 6200.1E Table 3-1";
const FLAG_CONSTANTS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };

// Non-finite numbers are written as strings in audit inputs (REQ-AU-002).
function inputNum(x: number): number | string {
  if (Number.isFinite(x)) return x;
  return Number.isNaN(x) ? "NaN" : x > 0 ? "Infinity" : "-Infinity";
}

function record(fn: string, citation: string, inputs: Audit, constants: Audit, summary: string, clock: string): Audit {
  return {
    spec_version: "0.2.0",
    function: fn,
    inputs,
    constants,
    citation,
    result_summary: summary,
    computed_at: clock,
  };
}

export function wetBulb(tempC: number, rhPercent: number, clock: string): Outcome {
  const inputs = { tempC: inputNum(tempC), rhPercent: inputNum(rhPercent) };
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    const which = !Number.isFinite(tempC) ? "tempC" : "rhPercent";
    return { result: null, audit: record("calculateWetBulb", WB_CITATION, inputs, {}, "invalid_input:" + which, clock) };
  }
  const T = tempC;
  const RH = rhPercent < 5 ? 5 : rhPercent > 100 ? 100 : rhPercent;
  const clamped = RH !== rhPercent;
  const term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
  const term2 = Math.atan(T + RH);
  const term3 = Math.atan(RH - 1.676331);
  const term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
  const wetBulbC = term1 + term2 - term3 + term4 + -4.686035;
  const wetBulbF = (wetBulbC * 9) / 5 + 32;
  const result: Audit = { wetBulbC, wetBulbF };
  const constants: Audit = {
    stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331,
    stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035,
  };
  const markers: string[] = [];
  if (clamped) {
    result.clampedRhPct = RH;
    constants.rh_clamp_min = 5;
    constants.rh_clamp_max = 100;
    markers.push("rh_clamped");
  }
  if (T < -20 || T > 50) markers.push("out_of_validity_range");
  const rh = clamped ? `${rhPercent}→${RH}%` : `${RH}%`;
  const mk = markers.length ? ` (${markers.join(",")})` : "";
  const summary = `T=${T.toFixed(1)}°C RH=${rh}${mk} → Tw=${wetBulbC.toFixed(2)}°C`;
  return { result, audit: record("calculateWetBulb", WB_CITATION, inputs, constants, summary, clock) };
}

export function wetBulbFromF(tempF: number, rhPercent: number, clock: string): Outcome {
  return wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);
}

function classify(w: number): [string, string] {
  if (w < 80) return ["white", "low"];
  if (w < 85) return ["green", "moderate"];
  if (w < 88) return ["yellow", "high"];
  if (w < 90) return ["red", "extreme"];
  return ["black", "critical"];
}

export function flagF(wetBulbF: number, clock: string): Outcome {
  const inputs = { wetBulbF: inputNum(wetBulbF) };
  if (!Number.isFinite(wetBulbF)) {
    return { result: null, audit: record("flagFromWetBulbF", FLAG_CITATION, inputs, {}, "invalid_input:wetBulbF", clock) };
  }
  const [flag, flagDartLabel] = classify(wetBulbF);
  const range = wetBulbF < -50 || wetBulbF > 200 ? " (out_of_observed_range)" : "";
  const summary = `wetBulbF=${wetBulbF} → ${flag}${range}`;
  return { result: { flag, flagDartLabel }, audit: record("flagFromWetBulbF", FLAG_CITATION, inputs, { ...FLAG_CONSTANTS }, summary, clock) };
}

export function flagC(wetBulbC: number, clock: string): Outcome {
  const inputs = { wetBulbC: inputNum(wetBulbC) };
  if (!Number.isFinite(wetBulbC)) {
    return { result: null, audit: record("flagFromWetBulbC", FLAG_CITATION, inputs, {}, "invalid_input:wetBulbC", clock) };
  }
  const f = (wetBulbC * 9) / 5 + 32;
  const child = flagF(f, clock);
  const flag = child.result === null ? "invalid_input" : (child.result as Audit).flag;
  const summary = `wetBulbC=${wetBulbC} → wetBulbF=${f.toFixed(4)} → ${flag}`;
  const audit = record("flagFromWetBulbC", FLAG_CITATION, inputs, { ...FLAG_CONSTANTS }, summary, clock);
  audit.children = [child.audit];
  return { result: child.result, audit };
}

export function auditText(a: Audit): string {
  return canonical(a);
}
