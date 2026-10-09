// The reference model of rcan-gate: whether a robot may carry out a command, as a pure function
// of the gate's state and the command. Written to gate.duramen, which takes its rules from the
// RCAN specification (rcan.dev, rcan-spec at 0f425ec) and from rcan-ts at b563fb5: the role
// ladder and the minimum role of each scope (src/identity.ts), the replay window with a
// 10-second cap for safety messages and 5 seconds of allowed clock drift (src/replay.ts), the
// confidence gate (src/gates.ts) and the rule that an ESTOP is never blocked (src/safety.ts).

export const ROLE_LEVEL = { GUEST: 1, OPERATOR: 2, CONTRIBUTOR: 2.5, ADMIN: 3, M2M_PEER: 4, CREATOR: 5, M2M_TRUSTED: 6 };
export const SCOPE_MIN_ROLE = {
  status: 'GUEST', discover: 'GUEST', chat: 'GUEST', observer: 'GUEST',
  contribute: 'CONTRIBUTOR', control: 'OPERATOR', teleop: 'OPERATOR',
  training: 'ADMIN', training_data: 'ADMIN', config: 'ADMIN', authority: 'ADMIN',
  admin: 'CREATOR', safety: 'CREATOR', estop: 'CREATOR', 'fleet.trusted': 'M2M_TRUSTED',
};
const EVENTS = ['ESTOP', 'STOP', 'RESUME', 'ESTOP_CLEAR'];
const TIERS = ['root', 'authoritative', 'community'];
const SAFETY_WINDOW_CAP = 10;
const FUTURE_DRIFT = 5;

const has = (o, k) => Object.hasOwn(o, k);
const val = (o, k, dflt) => (has(o, k) ? o[k] : dflt);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isLoa = (v) => v === 1 || v === 2 || v === 3;
const asciiLower = (s) => s.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));

// null when the state is well formed, else which member is not.
export function stateProblem(s) {
  if (!isObj(s)) return 'state';
  if (!isNum(val(s, 'now'))) return 'now';
  for (const k of ['estopped', 'stopped']) if (has(s, k) && typeof s[k] !== 'boolean') return k;
  for (const k of ['minLoaControl', 'minLoaSafety']) if (has(s, k) && !isLoa(s[k])) return k;
  if (has(s, 'window') && !(isNum(s.window) && s.window > 0)) return 'window';
  if (has(s, 'maxSpeed') && !(isNum(s.maxSpeed) && s.maxSpeed >= 0)) return 'maxSpeed';
  if (has(s, 'limits')) {
    if (!isObj(s.limits)) return 'limits';
    for (const l of Object.values(s.limits)) {
      if (!isObj(l) || !isNum(val(l, 'min')) || !isNum(val(l, 'max')) || l.min > l.max) return 'limits';
    }
  }
  if (has(s, 'gates')) {
    if (!isObj(s.gates)) return 'gates';
    for (const g of Object.values(s.gates)) {
      if (!isObj(g) || !isNum(val(g, 'min')) || g.min < 0 || g.min > 1 || !['block', 'escalate'].includes(val(g, 'onFail'))) return 'gates';
    }
  }
  if (has(s, 'seen') && !(Array.isArray(s.seen) && s.seen.every((e) => isObj(e) && isStr(val(e, 'id')) && isNum(val(e, 'expires'))))) return 'seen';
  return null;
}

export function commandProblem(c) {
  if (!isObj(c)) return 'command';
  if (!isStr(val(c, 'id')) || c.id === '') return 'id';
  if (!isNum(val(c, 'timestamp'))) return 'timestamp';
  if (!isStr(val(c, 'role')) || !has(ROLE_LEVEL, c.role)) return 'role';
  if (has(c, 'loa') && !isLoa(c.loa)) return 'loa';
  if (has(c, 'tier') && !TIERS.includes(c.tier)) return 'tier';
  const kind = val(c, 'kind');
  if (kind === 'safety') return EVENTS.includes(val(c, 'event')) ? null : 'event';
  if (kind === 'status') return null;
  if (kind !== 'move') return 'kind';
  if (!isStr(val(c, 'scope')) || c.scope === '') return 'scope';
  const ts = val(c, 'targets');
  if (!Array.isArray(ts) || ts.length === 0 || !ts.every((t) => isObj(t) && isStr(val(t, 'joint')) && isNum(val(t, 'position')))) return 'targets';
  if (!isNum(val(c, 'speed')) || c.speed < 0) return 'speed';
  if (has(c, 'confidence') && !(isNum(c.confidence) && c.confidence >= 0 && c.confidence <= 1)) return 'confidence';
  return null;
}

// The decision for a well-formed state and command.
export function decide(state, command) {
  const now = state.now;
  let estopped = val(state, 'estopped', false);
  let stopped = val(state, 'stopped', false);
  const seen = val(state, 'seen', []).filter((e) => e.expires > now);
  // The next state: the state as given, with the latches and the replay set written out.
  const out = (decision, reason) => ({ decision, reason, state: { ...state, estopped, stopped, seen } });
  const kind = command.kind;
  const event = kind === 'safety' ? command.event : null;

  // 1. An ESTOP is never blocked.
  if (event === 'ESTOP') { estopped = true; return out('execute', 'estop'); }
  // 2. Freshness, then replay; the id is used up from here on, whatever comes next.
  const w = kind === 'safety' ? Math.min(val(state, 'window', 30), SAFETY_WINDOW_CAP) : val(state, 'window', 30);
  if (now - command.timestamp > w) return out('refuse', 'stale');
  if (command.timestamp > now + FUTURE_DRIFT) return out('refuse', 'future');
  if (seen.some((e) => e.id === command.id)) return out('refuse', 'replay');
  seen.push({ id: command.id, expires: now + w });
  // 3. The ESTOP latch stops anything that could make the robot move.
  if (estopped && (kind === 'move' || event === 'RESUME')) return out('refuse', 'estopped');
  // 4. Role, then level of assurance.
  const scope = kind === 'status' ? 'status' : event === 'ESTOP_CLEAR' ? 'safety' : event ? 'control' : command.scope;
  const key = asciiLower(scope);
  const minRole = has(SCOPE_MIN_ROLE, key) ? SCOPE_MIN_ROLE[key] : 'OPERATOR';
  if (ROLE_LEVEL[command.role] < ROLE_LEVEL[minRole]) return out('refuse', 'role');
  if (kind !== 'status') {
    const loa = has(command, 'loa') ? command.loa : val(command, 'tier') === 'authoritative' ? 2 : 1;
    let need = val(state, 'minLoaControl', 1);
    if (key === 'safety') need = Math.max(need, val(state, 'minLoaSafety', 1));
    if (loa < need) return out('refuse', 'loa');
  }
  // 5. Status queries and safety events.
  if (kind === 'status') return out('execute', 'status');
  if (event === 'ESTOP_CLEAR') { estopped = false; return out('execute', 'estop_clear'); }
  if (event === 'STOP') { stopped = true; return out('execute', 'stop'); }
  if (event === 'RESUME') { stopped = false; return out('execute', 'resume'); }
  // 6. Moves.
  if (stopped) return out('refuse', 'stopped');
  const limits = val(state, 'limits', {});
  const named = new Set();
  for (const t of command.targets) {
    if (!has(limits, t.joint)) return out('refuse', 'unknown_joint');
    if (named.has(t.joint)) return out('refuse', 'duplicate_joint');
    named.add(t.joint);
    if (t.position < limits[t.joint].min || t.position > limits[t.joint].max) return out('refuse', 'limits');
  }
  if (command.speed > val(state, 'maxSpeed', 0)) return out('refuse', 'speed');
  const gates = val(state, 'gates', {});
  if (has(command, 'confidence') && has(gates, key) && command.confidence < gates[key].min) {
    return out(gates[key].onFail === 'escalate' ? 'hold' : 'refuse', 'confidence');
  }
  return out('execute', 'ok');
}
