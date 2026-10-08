// heat-engine core: canonical JSON, wet-bulb (Stull 2011), USMC heat flags.

const ESC: Record<number, string> = { 0x22: '\\"', 0x5c: '\\\\', 8: '\\b', 12: '\\f', 10: '\\n', 13: '\\r', 9: '\\t' };

function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (ESC[c] !== undefined) out += ESC[c];
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else out += '\\u' + c.toString(16);
    } else if (c >= 0xdc00 && c <= 0xdfff) out += '\\u' + c.toString(16);
    else out += s[i];
  }
  return out + '"';
}

export function canonical(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? '0' : String(v)) : 'null';
  if (typeof v === 'string') return quote(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return '{' + keys.map((k) => quote(k) + ':' + canonical(o[k])).join(',') + '}';
}

const nonFinite = (x: number): number | string => (Number.isFinite(x) ? x : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity');
// toFixed matches the fixed-text edge (including the >= 1e21 fallback)
const fixed = (x: number, f: number): string => x.toFixed(f);

type Audit = Record<string, unknown>;
export interface Out {
  result: unknown;
  audit: Audit;
}

function record(fn: string, citation: string, inputs: Audit, constants: Audit, summary: string, clock: string): Audit {
  return { spec_version: '0.2.0', function: fn, inputs, constants, citation, result_summary: summary, computed_at: clock };
}

export function wetBulb(tempC: number, rhPercent: number, clock: string): Out {
  const inputs = { tempC: nonFinite(tempC), rhPercent: nonFinite(rhPercent) };
  const cite = 'Stull (2011) eq. 1';
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    const bad = !Number.isFinite(tempC) ? 'tempC' : 'rhPercent';
    return { result: null, audit: record('calculateWetBulb', cite, inputs, {}, 'invalid_input:' + bad, clock) };
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
  const result: Audit = { wetBulbC, wetBulbF };
  if (clamped) result.clampedRhPct = RH;
  const constants: Audit = { stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331, stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035 };
  if (clamped) {
    constants.rh_clamp_min = 5;
    constants.rh_clamp_max = 100;
  }
  const markers: string[] = [];
  if (clamped) markers.push('rh_clamped');
  if (tempC < -20 || tempC > 50) markers.push('out_of_validity_range');
  const rh = clamped ? `${canonical(rhPercent)}→${canonical(RH)}%` : `${canonical(RH)}%`;
  const mk = markers.length ? ` (${markers.join(',')})` : '';
  const summary = `T=${fixed(tempC, 1)}°C RH=${rh}${mk} → Tw=${fixed(wetBulbC, 2)}°C`;
  return { result, audit: record('calculateWetBulb', cite, inputs, constants, summary, clock) };
}

export function wetBulbFromF(tempF: number, rhPercent: number, clock: string): Out {
  return wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);
}

const CITE_FLAG = 'USMC 6200.1E Table 3-1';
const FLAG_CONSTANTS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };

function classify(w: number): [string, string] {
  if (w < 80) return ['white', 'low'];
  if (w < 85) return ['green', 'moderate'];
  if (w < 88) return ['yellow', 'high'];
  if (w < 90) return ['red', 'extreme'];
  return ['black', 'critical'];
}

export function flagF(w: number, clock: string): Out {
  const inputs = { wetBulbF: nonFinite(w) };
  if (!Number.isFinite(w)) {
    return { result: null, audit: record('flagFromWetBulbF', CITE_FLAG, inputs, {}, 'invalid_input:wetBulbF', clock) };
  }
  const [flag, flagDartLabel] = classify(w);
  const oor = w < -50 || w > 200 ? ' (out_of_observed_range)' : '';
  const summary = `wetBulbF=${canonical(w)} → ${flag}${oor}`;
  return { result: { flag, flagDartLabel }, audit: record('flagFromWetBulbF', CITE_FLAG, inputs, FLAG_CONSTANTS, summary, clock) };
}

export function flagC(c: number, clock: string): Out {
  const inputs = { wetBulbC: nonFinite(c) };
  if (!Number.isFinite(c)) {
    return { result: null, audit: record('flagFromWetBulbC', CITE_FLAG, inputs, {}, 'invalid_input:wetBulbC', clock) };
  }
  const f = (c * 9) / 5 + 32;
  const child = flagF(f, clock);
  const flag = (child.result as { flag: string } | null)?.flag ?? 'invalid';
  const summary = `wetBulbC=${canonical(c)} → wetBulbF=${fixed(f, 4)} → ${flag}`;
  const audit = record('flagFromWetBulbC', CITE_FLAG, inputs, FLAG_CONSTANTS, summary, clock);
  audit.children = [child.audit];
  return { result: child.result, audit };
}
