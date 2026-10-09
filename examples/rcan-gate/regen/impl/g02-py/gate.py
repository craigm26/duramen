"""rcan-gate: a pure function from (state, command) to (decision, reason, next state)."""
import math

ROLES = {"GUEST": 1, "OPERATOR": 2, "CONTRIBUTOR": 2.5, "ADMIN": 3,
         "M2M_PEER": 4, "CREATOR": 5, "M2M_TRUSTED": 6}
SCOPE_ROLE = {
    "status": "GUEST", "discover": "GUEST", "chat": "GUEST", "observer": "GUEST",
    "contribute": "CONTRIBUTOR", "control": "OPERATOR", "teleop": "OPERATOR",
    "training": "ADMIN", "training_data": "ADMIN", "config": "ADMIN", "authority": "ADMIN",
    "admin": "CREATOR", "safety": "CREATOR", "estop": "CREATOR",
    "fleet.trusted": "M2M_TRUSTED",
}
EVENTS = ("ESTOP", "STOP", "RESUME", "ESTOP_CLEAR")


class BadRequest(Exception):
    pass


def is_num(v):
    return type(v) is float and math.isfinite(v)


def is_str(v):
    return isinstance(v, str)


def need(ok):
    if not ok:
        raise BadRequest()


def lower_ascii(s):
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


def check_state(s):
    need(isinstance(s, dict) and is_num(s.get("now")))
    for k in ("estopped", "stopped"):
        need(k not in s or isinstance(s[k], bool))
    for k in ("minLoaControl", "minLoaSafety"):
        need(k not in s or (is_num(s[k]) and s[k] in (1, 2, 3)))
    need("window" not in s or (is_num(s["window"]) and s["window"] > 0))
    need("maxSpeed" not in s or (is_num(s["maxSpeed"]) and s["maxSpeed"] >= 0))
    if "limits" in s:
        need(isinstance(s["limits"], dict))
        for lim in s["limits"].values():
            need(isinstance(lim, dict) and is_num(lim.get("min")) and is_num(lim.get("max"))
                 and lim["min"] <= lim["max"])
    if "gates" in s:
        need(isinstance(s["gates"], dict))
        for g in s["gates"].values():
            need(isinstance(g, dict) and is_num(g.get("min")) and 0 <= g["min"] <= 1
                 and g.get("onFail") in ("block", "escalate"))
    if "seen" in s:
        need(isinstance(s["seen"], list))
        for e in s["seen"]:
            need(isinstance(e, dict) and is_str(e.get("id")) and is_num(e.get("expires")))


def check_command(c):
    need(isinstance(c, dict))
    need(is_str(c.get("id")) and c["id"] != "" and is_num(c.get("timestamp")))
    need(c.get("role") in ROLES if is_str(c.get("role")) else False)
    need("loa" not in c or (is_num(c["loa"]) and c["loa"] in (1, 2, 3)))
    need("tier" not in c or c["tier"] in ("root", "authoritative", "community")
         if is_str(c.get("tier", "")) else False)
    kind = c.get("kind")
    need(kind in ("safety", "status", "move") if is_str(kind) else False)
    if kind == "safety":
        need(c.get("event") in EVENTS if is_str(c.get("event")) else False)
    elif kind == "move":
        need(is_str(c.get("scope")) and c["scope"] != "")
        t = c.get("targets")
        need(isinstance(t, list) and len(t) > 0)
        for x in t:
            need(isinstance(x, dict) and is_str(x.get("joint")) and is_num(x.get("position")))
        need(is_num(c.get("speed")) and c["speed"] >= 0)
        need("confidence" not in c or (is_num(c["confidence"]) and 0 <= c["confidence"] <= 1))


def decide(state, command):
    """Validate and decide. Returns {"decision", "reason", "state"}."""
    check_state(state)
    check_command(command)
    now = state["now"]
    kind = command["kind"]
    event = command.get("event")
    estopped = state.get("estopped", False)
    stopped = state.get("stopped", False)
    seen = [e for e in state.get("seen", []) if not e["expires"] <= now]

    def out(decision, reason, est=estopped, stp=stopped):
        nxt = dict(state)
        nxt.update(estopped=est, stopped=stp, seen=seen)
        return {"decision": decision, "reason": reason, "state": nxt}

    def refuse(reason):
        return out("refuse", reason)

    if kind == "safety" and event == "ESTOP":
        return out("execute", "estop", est=True)

    w = state.get("window", 30.0)
    if kind == "safety":
        w = min(w, 10.0)
    if now - command["timestamp"] > w:
        return refuse("stale")
    if command["timestamp"] > now + 5:
        return refuse("future")
    if any(e["id"] == command["id"] for e in seen):
        return refuse("replay")
    seen.append({"id": command["id"], "expires": now + w})

    if estopped and (kind == "move" or event == "RESUME"):
        return refuse("estopped")

    if kind == "status":
        scope = "status"
    elif kind == "move":
        scope = lower_ascii(command["scope"])
    else:
        scope = "safety" if event == "ESTOP_CLEAR" else "control"
    needed = SCOPE_ROLE.get(scope, "OPERATOR")
    if ROLES[command["role"]] < ROLES[needed]:
        return refuse("role")

    if kind != "status":
        loa = command.get("loa")
        if loa is None:
            loa = 2 if command.get("tier") == "authoritative" else 1
        min_loa = state.get("minLoaControl", 1)
        if scope == "safety":
            min_loa = max(min_loa, state.get("minLoaSafety", 1))
        if loa < min_loa:
            return refuse("loa")

    if kind == "status":
        return out("execute", "status")
    if event == "ESTOP_CLEAR":
        return out("execute", "estop_clear", est=False)
    if event == "STOP":
        return out("execute", "stop", stp=True)
    if event == "RESUME":
        return out("execute", "resume", stp=False)

    if stopped:
        return refuse("stopped")

    limits = state.get("limits", {})
    named = set()
    for t in command["targets"]:
        j = t["joint"]
        if j not in limits:
            return refuse("unknown_joint")
        if j in named:
            return refuse("duplicate_joint")
        named.add(j)
        if t["position"] < limits[j]["min"] or t["position"] > limits[j]["max"]:
            return refuse("limits")

    if command["speed"] > state.get("maxSpeed", 0.0):
        return refuse("speed")

    gate = state.get("gates", {}).get(scope)
    if gate is not None and "confidence" in command and command["confidence"] < gate["min"]:
        return out("hold" if gate["onFail"] == "escalate" else "refuse", "confidence")
    return out("execute", "ok")
