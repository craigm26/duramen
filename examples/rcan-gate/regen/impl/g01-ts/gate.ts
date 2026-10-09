// rcan-gate: a pure function from (state, command) to a decision, a reason and the next state.

type Obj = Record<string, any>;
export type Result = { decision: string; reason: string; state: Obj };

const ROLE_LEVEL = new Map<string, number>([
  ["GUEST", 1], ["OPERATOR", 2], ["CONTRIBUTOR", 2.5], ["ADMIN", 3],
  ["M2M_PEER", 4], ["CREATOR", 5], ["M2M_TRUSTED", 6],
]);
const SCOPE_ROLE = new Map<string, string>([
  ["status", "GUEST"], ["discover", "GUEST"], ["chat", "GUEST"], ["observer", "GUEST"],
  ["contribute", "CONTRIBUTOR"], ["control", "OPERATOR"], ["teleop", "OPERATOR"],
  ["training", "ADMIN"], ["training_data", "ADMIN"], ["config", "ADMIN"], ["authority", "ADMIN"],
  ["admin", "CREATOR"], ["safety", "CREATOR"], ["estop", "CREATOR"],
  ["fleet.trusted", "M2M_TRUSTED"],
]);
const EVENTS = ["ESTOP", "STOP", "RESUME", "ESTOP_CLEAR"];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const has = (o: Obj, k: string): boolean => Object.hasOwn(o, k);
const lower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const isLoa = (v: unknown): boolean => v === 1 || v === 2 || v === 3;

export function validState(s: unknown): boolean {
  if (!isObj(s) || !has(s, "now") || !isNum(s.now)) return false;
  for (const k of ["estopped", "stopped"]) if (has(s, k) && typeof s[k] !== "boolean") return false;
  for (const k of ["minLoaControl", "minLoaSafety"]) if (has(s, k) && !isLoa(s[k])) return false;
  if (has(s, "window") && !(isNum(s.window) && s.window > 0)) return false;
  if (has(s, "maxSpeed") && !(isNum(s.maxSpeed) && s.maxSpeed >= 0)) return false;
  if (has(s, "limits")) {
    if (!isObj(s.limits)) return false;
    for (const l of Object.values(s.limits)) {
      if (!isObj(l) || !isNum(l.min) || !isNum(l.max) || l.min > l.max) return false;
    }
  }
  if (has(s, "gates")) {
    if (!isObj(s.gates)) return false;
    for (const g of Object.values(s.gates)) {
      if (!isObj(g) || !isNum(g.min) || g.min < 0 || g.min > 1) return false;
      if (g.onFail !== "block" && g.onFail !== "escalate") return false;
    }
  }
  if (has(s, "seen")) {
    if (!Array.isArray(s.seen)) return false;
    for (const e of s.seen) if (!isObj(e) || typeof e.id !== "string" || !isNum(e.expires)) return false;
  }
  return true;
}

export function validCommand(c: unknown): boolean {
  if (!isObj(c)) return false;
  if (typeof c.id !== "string" || c.id.length < 1 || !isNum(c.timestamp)) return false;
  if (typeof c.role !== "string" || !ROLE_LEVEL.has(c.role)) return false;
  if (has(c, "loa") && !isLoa(c.loa)) return false;
  if (has(c, "tier") && !["root", "authoritative", "community"].includes(c.tier)) return false;
  if (c.kind === "status") return true;
  if (c.kind === "safety") return typeof c.event === "string" && EVENTS.includes(c.event);
  if (c.kind !== "move") return false;
  if (typeof c.scope !== "string" || c.scope.length < 1) return false;
  if (!Array.isArray(c.targets) || c.targets.length < 1) return false;
  for (const t of c.targets) if (!isObj(t) || typeof t.joint !== "string" || !isNum(t.position)) return false;
  if (!isNum(c.speed) || c.speed < 0) return false;
  if (has(c, "confidence") && !(isNum(c.confidence) && c.confidence >= 0 && c.confidence <= 1)) return false;
  return true;
}

// Both arguments must already be validated.
export function decide(state: Obj, c: Obj): Result {
  const now: number = state.now;
  const window: number = has(state, "window") ? state.window : 30;
  const isSafety = c.kind === "safety";
  const w = isSafety ? Math.min(window, 10) : window;
  const estopped = has(state, "estopped") ? state.estopped : false;
  const stopped = has(state, "stopped") ? state.stopped : false;
  const replaySet: Obj[] = (has(state, "seen") ? state.seen : []).filter((e: Obj) => e.expires > now);

  const out = (decision: string, reason: string, seen: Obj[], e = estopped, s = stopped): Result => {
    const next: Obj = { ...state };
    next.estopped = e;
    next.stopped = s;
    next.seen = seen;
    return { decision, reason, state: next };
  };

  // 1. ESTOP is never blocked and does not use up its ID.
  if (isSafety && c.event === "ESTOP") return out("execute", "estop", replaySet, true, stopped);

  // 2. freshness
  if (now - c.timestamp > w) return out("refuse", "stale", replaySet);
  if (c.timestamp > now + 5) return out("refuse", "future", replaySet);

  // 3. replay
  if (replaySet.some((e) => e.id === c.id)) return out("refuse", "replay", replaySet);
  const seen = [...replaySet, { id: c.id, expires: now + w }];
  const refuse = (reason: string) => out("refuse", reason, seen);

  // 4. ESTOP latch
  if (estopped && (c.kind === "move" || (isSafety && c.event === "RESUME"))) return refuse("estopped");

  // 5. role
  const scope = c.kind === "status" ? "status" : isSafety
    ? (c.event === "ESTOP_CLEAR" ? "safety" : "control") : lower(c.scope);
  const needRole = SCOPE_ROLE.get(scope) ?? "OPERATOR";
  if (ROLE_LEVEL.get(c.role)! < ROLE_LEVEL.get(needRole)!) return refuse("role");

  // 6. level of assurance
  if (c.kind !== "status") {
    const loa = has(c, "loa") ? c.loa : c.tier === "authoritative" ? 2 : 1;
    const minC = has(state, "minLoaControl") ? state.minLoaControl : 1;
    const minS = has(state, "minLoaSafety") ? state.minLoaSafety : 1;
    const need = scope === "safety" ? Math.max(minC, minS) : minC;
    if (loa < need) return refuse("loa");
  }

  // 7. status
  if (c.kind === "status") return out("execute", "status", seen);

  // 8. STOP, RESUME, ESTOP_CLEAR
  if (isSafety) {
    if (c.event === "STOP") return out("execute", "stop", seen, estopped, true);
    if (c.event === "RESUME") return out("execute", "resume", seen, estopped, false);
    return out("execute", "estop_clear", seen, false, stopped);
  }

  // 9. STOP latch
  if (stopped) return refuse("stopped");

  // 10. targets
  const limits: Obj = has(state, "limits") ? state.limits : {};
  const named = new Set<string>();
  for (const t of c.targets) {
    if (!has(limits, t.joint)) return refuse("unknown_joint");
    if (named.has(t.joint)) return refuse("duplicate_joint");
    named.add(t.joint);
    const l = limits[t.joint];
    if (t.position < l.min || t.position > l.max) return refuse("limits");
  }

  // 11. speed
  if (c.speed > (has(state, "maxSpeed") ? state.maxSpeed : 0)) return refuse("speed");

  // 12. confidence
  const gates: Obj = has(state, "gates") ? state.gates : {};
  if (has(c, "confidence") && has(gates, scope)) {
    const g = gates[scope];
    if (c.confidence < g.min) return out(g.onFail === "block" ? "refuse" : "hold", "confidence", seen);
  }

  // 13.
  return out("execute", "ok", seen);
}
