// Wet-bulb and heat-flag operations, each returning { result, audit }.
import { canonical, fixed, numText } from "./canon.ts";

export type Audit = Record<string, unknown>;
export type Outcome = { result: unknown; audit: Audit };

const SPEC_VERSION = "0.2.0";

function nonFinite(x: number): string {
  return Number.isNaN(x) ? "NaN" : x > 0 ? "Infinity" : "-Infinity";
}

function inputNum(x: number): number | string {
  return Number.isFinite(x) ? x : nonFinite(x);
}

export function wetBulb(tempC: number, rhPercent: number, clock: string): Outcome {
  const base = { spec_version: SPEC_VERSION, function: "calculateWetBulb", citation: "Stull (2011) eq. 1", computed_at: clock };
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    return {
      result: null,
      audit: {
        ...base,
        inputs: { tempC: inputNum(tempC), rhPercent: inputNum(rhPercent) },
        constants: {},
        result_summary: Number.isFinite(tempC) ? "invalid_input:rhPercent" : "invalid_input:tempC",
      },
    };
  }
  const T = tempC;
  const RH = rhPercent < 5 ? 5 : rhPercent > 100 ? 100 : rhPercent;
  const term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
  const term2 = Math.atan(T + RH);
  const term3 = Math.atan(RH - 1.676331);
  const term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
  const wetBulbC = term1 + term2 - term3 + term4 + -4.686035;
  const wetBulbF = (wetBulbC * 9) / 5 + 32;
  const clamped = RH !== rhPercent;
  const result: Record<string, number> = { wetBulbC, wetBulbF };
  if (clamped) result.clampedRhPct = RH;
  const constants: Record<string, number> = {
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
  const rh = clamped ? `${numText(rhPercent)}→${numText(RH)}%` : `${numText(RH)}%`;
  const mk = markers.length ? ` (${markers.join(",")})` : "";
  return {
    result,
    audit: {
      ...base,
      inputs: { tempC, rhPercent },
      constants,
      result_summary: `T=${fixed(tempC, 1)}°C RH=${rh}${mk} → Tw=${fixed(wetBulbC, 2)}°C`,
    },
  };
}

export function wetBulbFromF(tempF: number, rhPercent: number, clock: string): Outcome {
  return wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);
}

const FLAG_CONSTANTS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };
const FLAG_CITATION = "USMC 6200.1E Table 3-1";

function classify(w: number): [string, string] {
  if (w < 80) return ["white", "low"];
  if (w < 85) return ["green", "moderate"];
  if (w < 88) return ["yellow", "high"];
  if (w < 90) return ["red", "extreme"];
  return ["black", "critical"];
}

export function flagF(wetBulbF: number, clock: string): Outcome {
  const base = { spec_version: SPEC_VERSION, function: "flagFromWetBulbF", citation: FLAG_CITATION, computed_at: clock };
  if (!Number.isFinite(wetBulbF)) {
    return {
      result: null,
      audit: { ...base, inputs: { wetBulbF: inputNum(wetBulbF) }, constants: {}, result_summary: "invalid_input:wetBulbF" },
    };
  }
  const [flag, flagDartLabel] = classify(wetBulbF);
  const odd = wetBulbF < -50 || wetBulbF > 200 ? " (out_of_observed_range)" : "";
  return {
    result: { flag, flagDartLabel },
    audit: {
      ...base,
      inputs: { wetBulbF },
      constants: { ...FLAG_CONSTANTS },
      result_summary: `wetBulbF=${numText(wetBulbF)} → ${flag}${odd}`,
    },
  };
}

export function flagC(wetBulbC: number, clock: string): Outcome {
  const base = { spec_version: SPEC_VERSION, function: "flagFromWetBulbC", citation: FLAG_CITATION, computed_at: clock };
  if (!Number.isFinite(wetBulbC)) {
    return {
      result: null,
      audit: { ...base, inputs: { wetBulbC: inputNum(wetBulbC) }, constants: {}, result_summary: "invalid_input:wetBulbC" },
    };
  }
  const f = (wetBulbC * 9) / 5 + 32;
  const child = flagF(f, clock);
  const flag = (child.result as { flag: string } | null)?.flag ?? "invalid_input:wetBulbF";
  return {
    result: child.result,
    audit: {
      ...base,
      inputs: { wetBulbC },
      constants: { ...FLAG_CONSTANTS },
      result_summary: `wetBulbC=${numText(wetBulbC)} → wetBulbF=${fixed(f, 4)} → ${flag}`,
      children: [child.audit],
    },
  };
}

export const auditText = canonical;
