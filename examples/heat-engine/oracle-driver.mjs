// The heat-engine oracle (./oracle.mjs) behind the driver protocol of heat.duramen: JSON request
// lines on standard input, one canonical JSON response line per request on standard output.
// duramen runs every example in the spec through this program before it renders anything.
import * as O from './oracle.mjs';

class Bad extends Error {}
const SPECIAL = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const has = (o, k) => Object.hasOwn(o, k);

function num(i, k) {
  if (has(i, k) && typeof i[k] === 'number') return i[k];
  if (has(i, k) && typeof i[k] === 'string' && has(SPECIAL, i[k])) return SPECIAL[i[k]];
  throw new Bad();
}
function str(i, k) { if (has(i, k) && typeof i[k] === 'string') return i[k]; throw new Bad(); }
function bool(i, k) { if (has(i, k) && typeof i[k] === 'boolean') return i[k]; throw new Bad(); }
function strOrNull(i, k, optional) {
  if (!has(i, k)) { if (optional) return undefined; throw new Bad(); }
  if (i[k] === null || typeof i[k] === 'string') return i[k];
  throw new Bad();
}

const OPS = {
  wetBulb: (i, c) => O.wetBulb(num(i, 'tempC'), num(i, 'rhPercent'), c),
  wetBulbF: (i, c) => O.wetBulbF(num(i, 'tempF'), num(i, 'rhPercent'), c),
  flagF: (i, c) => O.flagF(num(i, 'wetBulbF'), c),
  flagC: (i, c) => O.flagC(num(i, 'wetBulbC'), c),
  workRest: (i, c) => O.workRest(str(i, 'flag'), bool(i, 'acclimatized'), num(i, 'workMinutesRequested'), c),
  verdict: (i, c) => O.verdict(strOrNull(i, 'priorVerdict', false), strOrNull(i, 'priorFlag', true), str(i, 'currentFlag'), bool(i, 'hasAlternateAvailable'), c),
  cascade: (i, c, req) => {
    const input = { lat: num(i, 'lat'), lng: num(i, 'lng') };
    if (has(i, 'isoTimestamp')) input.isoTimestamp = str(i, 'isoTimestamp');
    if (!Array.isArray(req.responses)) throw new Bad();
    return O.cascade(input, req.responses, c);
  },
  canonical: null,
};

function handle(line) {
  let req;
  try { req = JSON.parse(line); } catch { req = undefined; }
  if (!isObj(req) || typeof req.id !== 'string') return O.canon({ id: null, error: 'bad_request' });
  const { id } = req;
  if (typeof req.op !== 'string' || !has(OPS, req.op)) return O.canon({ id, error: 'unknown_op' });
  try {
    const i = req.input;
    if (!isObj(i)) throw new Bad();
    if (req.op === 'canonical') {
      if (!has(i, 'value')) throw new Bad();
      return O.canon({ id, result: O.canon(i.value) });
    }
    if (typeof req.clock !== 'string') throw new Bad();
    const out = OPS[req.op](i, req.clock, req);
    return O.canon({ id, result: out.result, audit: O.canon(out.audit) });
  } catch (e) {
    if (e instanceof Bad) return O.canon({ id, error: 'bad_request' });
    throw e;
  }
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const out = [];
for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
  if (line.trim() === '') continue;
  // The oracle cannot answer everything (for example a non-finite number in a result, which the
  // spec leaves open); it says so instead of stopping, and `duramen check` reports the example.
  try { out.push(handle(line) + '\n'); } catch (e) {
    let id = null;
    try { id = JSON.parse(line).id ?? null; } catch {}
    out.push(JSON.stringify({ id, oracle_error: e.message }) + '\n');
  }
}
process.stdout.write(out.join(''));
