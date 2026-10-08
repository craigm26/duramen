// The heat-engine operations: each returns { result, audit }.
import { canonical, fixedText, numText } from "./canon.ts";

export const SPEC_VERSION = "0.2.0";

type Json = Record<string, unknown>;
export type Outcome = { result: unknown; audit: Json };

// Inputs are written as numbers, or as strings when not finite (REQ-AU-002).
function inputNum(x: number): number | string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  return x;
}

const WB_CITATION = "Stull (2011) eq. 1";

export function wetBulb(tempC: number, rhPercent: number, clock: string): Outcome {
  const inputs = { tempC: inputNum(tempC), rhPercent: inputNum(rhPercent) };
  const base = { spec_version: SPEC_VERSION, function: "calculateWetBulb", citation: WB_CITATION, computed_at: clock, inputs };
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    const bad = Number.isFinite(tempC) ? "rhPercent" : "tempC";
    return { result: null, audit: { ...base, constants: {}, result_summary: "invalid_input:" + bad } };
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
  const result: Json = { wetBulbC, wetBulbF };
  if (clamped) result.clampedRhPct = RH;
  const constants: Json = {
    stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331,
    stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035,
  };
  if (clamped) {
    constants.rh_clamp_min = 5;
    constants.rh_clamp_max = 100;
  }
  const markers: string[] = [];
  if (clamped) markers.push("rh_clamped");
  if (tempC < -20 || tempC > 50) markers.push("out_of_validity_range");
  const rh = clamped ? numText(rhPercent) + "→" + numText(RH) + "%" : numText(RH) + "%";
  const summary = `T=${fixedText(tempC, 1)}°C RH=${rh}${markers.length ? " (" + markers.join(",") + ")" : ""} → Tw=${fixedText(wetBulbC, 2)}°C`;
  return { result, audit: { ...base, constants, result_summary: summary } };
}

export function wetBulbFromF(tempF: number, rhPercent: number, clock: string): Outcome {
  return wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);
}

const FL_CITATION = "USMC 6200.1E Table 3-1";
const FL_CONSTANTS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };

function classify(w: number): { flag: string; flagDartLabel: string } {
  if (w < 80) return { flag: "white", flagDartLabel: "low" };
  if (w < 85) return { flag: "green", flagDartLabel: "moderate" };
  if (w < 88) return { flag: "yellow", flagDartLabel: "high" };
  if (w < 90) return { flag: "red", flagDartLabel: "extreme" };
  return { flag: "black", flagDartLabel: "critical" };
}

export function flagF(wetBulbF: number, clock: string): Outcome {
  const base = { spec_version: SPEC_VERSION, function: "flagFromWetBulbF", citation: FL_CITATION, computed_at: clock, inputs: { wetBulbF: inputNum(wetBulbF) } };
  if (!Number.isFinite(wetBulbF)) {
    return { result: null, audit: { ...base, constants: {}, result_summary: "invalid_input:wetBulbF" } };
  }
  const result = classify(wetBulbF);
  const out = wetBulbF < -50 || wetBulbF > 200 ? " (out_of_observed_range)" : "";
  return { result, audit: { ...base, constants: FL_CONSTANTS, result_summary: `wetBulbF=${numText(wetBulbF)} → ${result.flag}${out}` } };
}

export function flagC(wetBulbC: number, clock: string): Outcome {
  const base = { spec_version: SPEC_VERSION, function: "flagFromWetBulbC", citation: FL_CITATION, computed_at: clock, inputs: { wetBulbC: inputNum(wetBulbC) } };
  if (!Number.isFinite(wetBulbC)) {
    return { result: null, audit: { ...base, constants: {}, result_summary: "invalid_input:wetBulbC" } };
  }
  const f = (wetBulbC * 9) / 5 + 32;
  const child = flagF(f, clock);
  const flag = child.result === null ? "invalid_input:wetBulbF" : (child.result as { flag: string }).flag;
  return {
    result: child.result,
    audit: {
      ...base, constants: FL_CONSTANTS, children: [child.audit],
      result_summary: `wetBulbC=${numText(wetBulbC)} → wetBulbF=${fixedText(f, 4)} → ${flag}`,
    },
  };
}

export function auditText(a: Json): string {
  return canonical(a);
}
