import json
import random
import subprocess
import sys
import unittest
from pathlib import Path

import driver

HERE = Path(__file__).resolve().parent
LIM = {"base": {"min": -1, "max": 1}, "elbow": {"min": 0, "max": 2}}
STATUS = {"id": "q1", "timestamp": 1000, "role": "GUEST", "kind": "status"}


def move(**kw):
    c = {"id": "m1", "timestamp": 1000, "role": "OPERATOR", "kind": "move", "scope": "control",
         "targets": [{"joint": "base", "position": 0}], "speed": 0}
    c.update(kw)
    return c


def safety(event, role="OPERATOR", **kw):
    c = {"id": "s1", "timestamp": 1000, "role": role, "kind": "safety", "event": event}
    c.update(kw)
    return c


def run(state, command):
    return driver.handle(json.dumps({"id": "r", "op": "decide",
                                     "input": {"state": state, "command": command}}))


def res(state, command):
    r = run(state, command)
    assert "result" in r, r
    return r["result"]


def rr(state, command):
    x = res(state, command)
    return x["decision"], x["reason"]


def S(**kw):
    s = {"now": 1000, "maxSpeed": 1, "limits": LIM}
    s.update(kw)
    return s


class Requests(unittest.TestCase):  # REQ-RQ-001..005
    def test_rq001_errors(self):
        self.assertEqual(driver.handle("{not json"), {"id": None, "error": "bad_request"})
        self.assertEqual(driver.handle("[1,2]"), {"id": None, "error": "bad_request"})
        self.assertEqual(driver.handle('{"id":5,"op":"decide","input":{}}'),
                         {"id": None, "error": "bad_request"})
        self.assertEqual(driver.handle('{"id":"a","input":{}}'), {"id": "a", "error": "unknown_op"})
        self.assertEqual(driver.handle('{"id":"a","op":"gate","input":{}}'),
                         {"id": "a", "error": "unknown_op"})
        self.assertEqual(driver.handle('{"id":"a","op":"decide"}'), {"id": "a", "error": "bad_request"})
        self.assertEqual(driver.handle('{"id":"a","op":"decide","input":[]}'),
                         {"id": "a", "error": "bad_request"})
        r = driver.handle(json.dumps({"id": "a", "op": "decide", "input": {"state": {"now": 1}}}))
        self.assertEqual(r, {"id": "a", "error": "bad_request"})
        self.assertEqual(rr(S(limits={}), STATUS), ("execute", "status"))

    def test_rq002_bad_states(self):
        bad = [{}, {"now": "1000"}, {"now": 1000, "estopped": 1}, {"now": 1000, "stopped": None},
               {"now": 1000, "minLoaControl": 0}, {"now": 1000, "minLoaControl": 2.5},
               {"now": 1000, "minLoaSafety": True}, {"now": 1000, "minLoaSafety": "3"},
               {"now": 1000, "window": 0}, {"now": 1000, "maxSpeed": -0.5},
               {"now": 1000, "limits": []},
               {"now": 1000, "limits": {"base": {"min": 1, "max": -1}}},
               {"now": 1000, "limits": {"base": {"min": -1}}},
               {"now": 1000, "gates": {"control": {"min": 1.5, "onFail": "block"}}},
               {"now": 1000, "gates": {"control": {"min": 0.5, "onFail": "warn"}}},
               {"now": 1000, "seen": [{"id": 1, "expires": 1030}]}, {"now": 1000, "seen": {}},
               {"now": True}, {"now": 1000, "window": True}, {"now": 1000, "maxSpeed": False},
               {"now": 1000, "limits": {"base": {"min": True, "max": 1}}},
               {"now": 1000, "gates": {"control": {"min": False, "onFail": "block"}}},
               {"now": 1000, "seen": [{"id": "a", "expires": True}]}]
        for s in bad:
            self.assertEqual(run(s, STATUS)["error"], "bad_request", s)

    def test_rq002_defaults_and_good(self):
        s = {"now": 1000, "minLoaControl": 2.0, "window": 0.5, "maxSpeed": 0,
             "limits": {"base": {"min": 1, "max": 1}},
             "gates": {"control": {"min": 0, "onFail": "escalate"}}}
        x = res(s, STATUS)
        self.assertEqual(x["decision"], "execute")
        self.assertEqual(x["state"]["seen"], [{"expires": 1000.5, "id": "q1"}])

    def test_rq003_bad_commands(self):
        m = move()
        bads = [dict(STATUS, id=""), dict(STATUS, id=7), {k: v for k, v in STATUS.items() if k != "id"},
                dict(STATUS, timestamp="1000"), dict(STATUS, role="guest"),
                dict(STATUS, role="constructor"), dict(STATUS, loa=0), dict(STATUS, loa=True),
                dict(STATUS, loa="2"), dict(STATUS, tier="Root"), dict(STATUS, kind="teleport"),
                {k: v for k, v in STATUS.items() if k != "kind"},
                safety("X"), safety("estop"), {k: v for k, v in safety("STOP").items() if k != "event"},
                {k: v for k, v in m.items() if k != "scope"}, move(scope=""), move(targets=[]),
                move(targets=[{"joint": "base"}]), move(targets=[{"joint": "base", "position": "0"}]),
                move(targets=[{"joint": 1, "position": 0}]),
                move(targets=[{"joint": "base", "position": True}]),
                {k: v for k, v in m.items() if k != "speed"}, move(speed=-1), move(speed=False),
                move(confidence=1.5), move(confidence=None), move(confidence=True),
                dict(STATUS, timestamp=False)]
        for c in bads:
            self.assertEqual(run({"now": 1000}, c)["error"], "bad_request", c)

    def test_rq003_good(self):
        self.assertEqual(rr({"now": 1000}, dict(STATUS, loa=2.0)), ("execute", "status"))
        self.assertEqual(rr({"now": 1000}, safety("STOP", scope=5)), ("execute", "stop"))
        s = {"now": 1000, "maxSpeed": 1, "limits": {"": {"min": 0, "max": 0}}}
        c = move(targets=[{"joint": "", "position": 0}], speed=1e0, confidence=0)
        self.assertEqual(rr(s, c), ("execute", "ok"))

    def test_rq004_ignored_members(self):
        line = ('{"id":"x1","op":"decide","trace":true,"input":{"note":"x","state":{"now":1000,'
                '"robot":"arm-7"},"command":{"id":"q1","timestamp":1000,"role":"GUEST",'
                '"kind":"status","targets":[],"via":"lan"}}}')
        self.assertEqual(driver.handle(line)["result"], {
            "decision": "execute", "reason": "status",
            "state": {"estopped": False, "now": 1000, "robot": "arm-7",
                      "seen": [{"expires": 1030, "id": "q1"}], "stopped": False}})
        line = ('{"id":"x","op":"decide","input":{"state":{"now":1000,"__proto__":{"now":5},'
                '"constructor":1},"command":{"id":"q1","timestamp":1000,"role":"GUEST",'
                '"kind":"status"}}}')
        st = driver.handle(line)["result"]["state"]
        self.assertEqual(st["__proto__"], {"now": 5})
        self.assertEqual(st["constructor"], 1)
        self.assertEqual(st["now"], 1000)
        s = S(limits={"base": {"min": -1, "max": 1, "unit": "rad"}},
              gates={"control": {"min": 0.5, "onFail": "block", "by": "ops"}},
              seen=[{"id": "a", "expires": 1010, "from": "lan"}])
        c = move(targets=[{"joint": "base", "position": 1, "unit": "rad"}], speed=1, confidence=0.5)
        x = res(s, c)
        self.assertEqual((x["decision"], x["reason"]), ("execute", "ok"))
        self.assertEqual(x["state"]["seen"],
                         [{"expires": 1010, "from": "lan", "id": "a"}, {"expires": 1030, "id": "m1"}])

    def test_rq005_numbers(self):
        self.assertEqual(rr({"now": 9007199254740993, "window": 0.5},
                            dict(STATUS, timestamp=9007199254740992)), ("execute", "status"))
        self.assertEqual(rr({"now": 1006.1, "window": 0.1}, dict(STATUS, timestamp=1006)),
                         ("refuse", "stale"))
        self.assertEqual(rr({"now": 1009.5, "window": 12.7}, dict(STATUS, timestamp=996.8)),
                         ("refuse", "stale"))
        self.assertEqual(rr({"now": 1019.9}, dict(STATUS, timestamp=1024.9)), ("execute", "status"))
        line = ('{"id":"n","op":"decide","input":{"state":{"now":1000,"maxSpeed":1e0,"limits":'
                '{"base":{"min":-1.0,"max":10e-1}}},"command":{"id":"m1","timestamp":1000.0,'
                '"role":"OPERATOR","loa":1.0,"kind":"move","scope":"control","targets":'
                '[{"joint":"base","position":1.00}],"speed":100e-2}}}')
        self.assertEqual(driver.handle(line)["result"]["reason"], "ok")


class Gate(unittest.TestCase):
    def test_gt001_shape(self):
        x = res({"now": 1000}, STATUS)
        self.assertEqual(x, {"decision": "execute", "reason": "status",
                             "state": {"estopped": False, "now": 1000,
                                       "seen": [{"expires": 1030, "id": "q1"}], "stopped": False}})
        s = {"now": 1000, "window": 12, "maxSpeed": 2, "limits": {"base": {"min": -1, "max": 1}},
             "gates": {}, "minLoaControl": 1}
        self.assertEqual(res(s, STATUS)["state"], dict(s, estopped=False, stopped=False,
                                                       seen=[{"expires": 1012, "id": "q1"}]))

    def test_gt002_order(self):
        seen = [{"id": "e1", "expires": 1030}]
        self.assertEqual(rr({"now": 1000, "estopped": True, "seen": seen},
                            safety("ESTOP", "GUEST", id="e1", timestamp=1)), ("execute", "estop"))
        self.assertEqual(rr({"now": 1000, "seen": [{"id": "m1", "expires": 1030}]},
                            dict(STATUS, id="m1", timestamp=900)), ("refuse", "stale"))
        mv = move(role="GUEST", targets=[{"joint": "x", "position": 0}], speed=9)
        self.assertEqual(rr({"now": 1000, "estopped": True, "seen": [{"id": "m1", "expires": 1030}]}, mv),
                         ("refuse", "replay"))
        self.assertEqual(rr({"now": 1000, "estopped": True, "minLoaControl": 3}, mv),
                         ("refuse", "estopped"))
        self.assertEqual(rr({"now": 1000, "stopped": True, "minLoaControl": 3}, mv), ("refuse", "role"))
        mo = dict(mv, role="OPERATOR")
        self.assertEqual(rr({"now": 1000, "stopped": True, "minLoaControl": 3}, mo), ("refuse", "loa"))
        self.assertEqual(rr({"now": 1000, "stopped": True}, mo), ("refuse", "stopped"))
        lim = {"base": {"min": -1, "max": 1}}
        far = move(targets=[{"joint": "base", "position": 5}], speed=9, confidence=0)
        self.assertEqual(rr({"now": 1000, "limits": lim}, far), ("refuse", "limits"))
        ok = move(speed=9, confidence=0)
        g = {"control": {"min": 0.5, "onFail": "block"}}
        self.assertEqual(rr({"now": 1000, "limits": lim, "gates": g}, ok), ("refuse", "speed"))
        s = {"now": 1000, "maxSpeed": 9, "limits": lim, "gates": g}
        self.assertEqual(rr(s, ok), ("refuse", "confidence"))
        self.assertEqual(rr(s, dict(ok, confidence=0.5)), ("execute", "ok"))

    def test_gt003_estop(self):
        s = {"now": 1000, "stopped": True,
             "seen": [{"id": "old", "expires": 1000}, {"id": "e1", "expires": 1001}]}
        x = res(s, safety("ESTOP", "GUEST", id="e2"))
        self.assertEqual(x["state"], {"estopped": True, "now": 1000, "stopped": True,
                                      "seen": [{"expires": 1001, "id": "e1"}]})
        for st, c in [({"now": 1000}, safety("ESTOP", "GUEST", timestamp=1)),
                      ({"now": 1000}, safety("ESTOP", "GUEST", timestamp=99999)),
                      ({"now": 1000, "estopped": True, "seen": [{"id": "s1", "expires": 1010}]},
                       safety("ESTOP", "GUEST")),
                      ({"now": 1000, "minLoaControl": 3, "minLoaSafety": 3},
                       safety("ESTOP", "GUEST", loa=1, tier="community"))]:
            x = res(st, c)
            self.assertEqual((x["decision"], x["reason"], x["state"]["estopped"]),
                             ("execute", "estop", True))

    def test_gt004_fresh_and_once(self):
        d = lambda st, c: res(st, c)
        self.assertEqual(rr({"now": 1000}, dict(STATUS, timestamp=970)), ("execute", "status"))
        self.assertEqual(rr({"now": 1000}, dict(STATUS, timestamp=969.5)), ("refuse", "stale"))
        self.assertEqual(rr({"now": 1000}, dict(STATUS, timestamp=1005)), ("execute", "status"))
        x = d({"now": 1000}, dict(STATUS, timestamp=1005.5))
        self.assertEqual((x["reason"], x["state"]["seen"]), ("future", []))
        self.assertEqual(d({"now": 1000}, safety("STOP", timestamp=990))["state"]["seen"],
                         [{"expires": 1010, "id": "s1"}])
        self.assertEqual(rr({"now": 1000}, safety("STOP", timestamp=989.5)), ("refuse", "stale"))
        self.assertEqual(rr({"now": 1000, "window": 5}, safety("RESUME", timestamp=994.5)),
                         ("refuse", "stale"))
        x = d({"now": 1000, "window": 5}, safety("RESUME", timestamp=995))
        self.assertEqual(x["state"]["seen"], [{"expires": 1005, "id": "s1"}])
        self.assertEqual(d({"now": 1000, "window": 12}, dict(STATUS, timestamp=988))["state"]["seen"],
                         [{"expires": 1012, "id": "q1"}])
        x = d({"now": 1000, "seen": [{"id": "q1", "expires": 1000.5}]}, STATUS)
        self.assertEqual((x["reason"], x["state"]["seen"]), ("replay", [{"expires": 1000.5, "id": "q1"}]))
        x = d({"now": 1000, "seen": [{"id": "q1", "expires": 1000}]}, STATUS)
        self.assertEqual((x["reason"], x["state"]["seen"]), ("status", [{"expires": 1030, "id": "q1"}]))
        x = d({"now": 1000, "seen": [{"id": "a", "expires": 990}, {"id": "b", "expires": 1020},
                                     {"id": "c", "expires": 1000}]}, dict(STATUS, timestamp=900))
        self.assertEqual((x["reason"], x["state"]["seen"]), ("stale", [{"expires": 1020, "id": "b"}]))
        x = d(S(seen=[{"id": "b", "expires": 1020}, {"id": "a", "expires": 1010}]),
              move(id="c", role="GUEST"))
        self.assertEqual(x["reason"], "role")
        self.assertEqual(x["state"]["seen"], [{"expires": 1020, "id": "b"}, {"expires": 1010, "id": "a"},
                                              {"expires": 1030, "id": "c"}])
        x = d({"now": 1000, "seen": [{"id": "q1", "expires": 1030}, {"id": "q1", "expires": 1040}]},
              dict(STATUS, id="q2"))
        self.assertEqual(len(x["state"]["seen"]), 3)
        x = d({"now": 1000.25, "window": 0.5}, STATUS)
        self.assertEqual(x["state"]["seen"], [{"expires": 1000.75, "id": "q1"}])

    def test_gt005_estop_latch(self):
        e = S(estopped=True)
        self.assertEqual(rr(e, move()), ("refuse", "estopped"))
        x = res(S(estopped=True, stopped=True), safety("RESUME"))
        self.assertEqual((x["reason"], x["state"]["estopped"], x["state"]["stopped"]),
                         ("estopped", True, True))
        x = res(e, safety("STOP"))
        self.assertEqual((x["reason"], x["state"]["estopped"], x["state"]["stopped"]), ("stop", True, True))
        self.assertEqual(rr(e, STATUS), ("execute", "status"))
        x = res(S(estopped=True, stopped=True), safety("ESTOP_CLEAR", "CREATOR"))
        self.assertEqual((x["reason"], x["state"]["estopped"], x["state"]["stopped"]),
                         ("estop_clear", False, True))
        x = res({"now": 1000}, safety("ESTOP_CLEAR", "CREATOR"))
        self.assertEqual((x["reason"], x["state"]["estopped"]), ("estop_clear", False))
        self.assertEqual(rr(e, safety("ESTOP_CLEAR", "ADMIN")), ("refuse", "role"))
        x = res(e, safety("ESTOP_CLEAR", "CREATOR", timestamp=989.5))
        self.assertEqual((x["reason"], x["state"]["estopped"]), ("stale", True))

    def test_gt006_roles(self):
        cases = [("GUEST", "control", "refuse", "role"), ("OPERATOR", "control", "execute", "ok"),
                 ("GUEST", "CONTROL", "refuse", "role"), ("GUEST", "Chat", "execute", "ok"),
                 ("OPERATOR", "contribute", "refuse", "role"),
                 ("CONTRIBUTOR", "contribute", "execute", "ok"),
                 ("CONTRIBUTOR", "config", "refuse", "role"), ("ADMIN", "training_data", "execute", "ok"),
                 ("M2M_PEER", "admin", "refuse", "role"), ("CREATOR", "Fleet.Trusted", "refuse", "role"),
                 ("M2M_TRUSTED", "fleet.trusted", "execute", "ok"), ("GUEST", "dance", "refuse", "role"),
                 ("OPERATOR", "dance", "execute", "ok"), ("OPERATOR", "constructor", "execute", "ok"),
                 ("OPERATOR", "__proto__", "execute", "ok"), ("GUEST", "toString", "refuse", "role")]
        for role, scope, d, r in cases:
            self.assertEqual(rr(S(), move(role=role, scope=scope)), (d, r), (role, scope))
        self.assertEqual(rr({"now": 1000}, safety("STOP", "GUEST")), ("refuse", "role"))
        self.assertEqual(rr({"now": 1000}, safety("RESUME")), ("execute", "resume"))
        self.assertEqual(rr({"now": 1000, "estopped": True}, safety("ESTOP_CLEAR", "M2M_PEER")),
                         ("refuse", "role"))
        self.assertEqual(rr({"now": 1000, "estopped": True}, safety("ESTOP_CLEAR", "M2M_TRUSTED")),
                         ("execute", "estop_clear"))

    def test_gt007_loa(self):
        s = S(minLoaControl=2)
        self.assertEqual(rr(s, move()), ("refuse", "loa"))
        self.assertEqual(rr(s, move(loa=2)), ("execute", "ok"))
        self.assertEqual(rr(s, move(tier="authoritative")), ("execute", "ok"))
        self.assertEqual(rr(S(minLoaControl=3), move(tier="authoritative")), ("refuse", "loa"))
        self.assertEqual(rr(s, move(tier="community")), ("refuse", "loa"))
        self.assertEqual(rr(s, move(tier="root")), ("refuse", "loa"))
        self.assertEqual(rr(s, move(loa=1, tier="authoritative")), ("refuse", "loa"))
        self.assertEqual(rr(s, move(role="GUEST", scope="chat")), ("refuse", "loa"))
        self.assertEqual(rr({"now": 1000, "minLoaControl": 3}, STATUS), ("execute", "status"))
        self.assertEqual(rr({"now": 1000, "minLoaControl": 2}, safety("STOP")), ("refuse", "loa"))
        self.assertEqual(rr({"now": 1000, "minLoaControl": 2}, safety("STOP", loa=3)), ("execute", "stop"))
        e = {"now": 1000, "estopped": True, "minLoaSafety": 3}
        self.assertEqual(rr(e, safety("ESTOP_CLEAR", "CREATOR", loa=2)), ("refuse", "loa"))
        self.assertEqual(rr(e, safety("ESTOP_CLEAR", "CREATOR", loa=3)), ("execute", "estop_clear"))
        e = {"now": 1000, "estopped": True, "minLoaControl": 2, "minLoaSafety": 1}
        self.assertEqual(rr(e, safety("ESTOP_CLEAR", "CREATOR", loa=1)), ("refuse", "loa"))
        s = S(minLoaSafety=3)
        self.assertEqual(rr(s, move(role="CREATOR", loa=2, scope="SAFETY")), ("refuse", "loa"))
        self.assertEqual(rr(s, move(role="CREATOR", loa=2, scope="estop")), ("execute", "ok"))
        self.assertEqual(rr({"now": 1000, "minLoaControl": 3}, safety("STOP", "GUEST", loa=1)),
                         ("refuse", "role"))

    def test_gt008_stop_resume(self):
        for st, ev, reason, stp in [({}, "STOP", "stop", True), ({"stopped": True}, "STOP", "stop", True),
                                    ({"stopped": True}, "RESUME", "resume", False),
                                    ({}, "RESUME", "resume", False)]:
            x = res(S(**st), safety(ev))
            self.assertEqual((x["decision"], x["reason"], x["state"]["stopped"]),
                             ("execute", reason, stp))
        x = res(S(stopped=True), move())
        self.assertEqual((x["reason"], x["state"]["stopped"]), ("stopped", True))
        self.assertEqual(rr(S(stopped=True), STATUS), ("execute", "status"))
        self.assertFalse(res(S(estopped=True), safety("STOP"))["state"]["stopped"] is False)
        self.assertTrue(res(S(estopped=False, stopped=True), safety("RESUME"))["state"]["estopped"] is False)

    def test_gt009_limits(self):
        def t(*pairs):
            return [{"joint": j, "position": p} for j, p in pairs]
        cases = [([("base", 1)], "ok"), ([("base", -1)], "ok"), ([("base", 1.0000001)], "limits"),
                 ([("elbow", -0.5)], "limits"), ([("gripper", 0)], "unknown_joint"),
                 ([("Base", 0)], "unknown_joint"), ([("base", 0), ("base", 0)], "duplicate_joint"),
                 ([("base", 5), ("base", 0)], "limits"),
                 ([("elbow", 1), ("base", 0), ("elbow", 9)], "duplicate_joint"),
                 ([("base", 0), ("gripper", 0), ("base", 9)], "unknown_joint"),
                 ([("elbow", 2), ("base", -1)], "ok"), ([("toString", 0)], "unknown_joint"),
                 ([("__proto__", 0)], "unknown_joint"), ([("hasOwnProperty", 0)], "unknown_joint")]
        for pairs, reason in cases:
            self.assertEqual(rr(S(), move(targets=t(*pairs)))[1], reason, pairs)
        self.assertEqual(rr({"now": 1000, "maxSpeed": 1}, move())[1], "unknown_joint")
        p = json.loads('{"__proto__": {"min": 0, "max": 1}, "toString": {"min": 0, "max": 1}}')
        self.assertEqual(rr(S(limits=p), move(targets=t(("__proto__", 1), ("toString", 0)))),
                         ("execute", "ok"))
        self.assertEqual(rr(S(limits=p), move(targets=t(("__proto__", 2)))), ("refuse", "limits"))

    def test_gt010_speed(self):
        self.assertEqual(rr(S(), move(speed=1)), ("execute", "ok"))
        self.assertEqual(rr(S(), move(speed=1.5)), ("refuse", "speed"))
        n = {"now": 1000, "limits": LIM}
        self.assertEqual(rr(n, move(speed=0)), ("execute", "ok"))
        self.assertEqual(rr(n, move(speed=0.001)), ("refuse", "speed"))
        self.assertEqual(rr(S(maxSpeed=0), move(speed=0)), ("execute", "ok"))

    def test_gt011_confidence(self):
        g = lambda **kw: S(gates={"control": dict({"min": 0.75, "onFail": "block"}, **kw)})
        self.assertEqual(rr(g(), move(confidence=0.5)), ("refuse", "confidence"))
        self.assertEqual(rr(g(), move(confidence=0.75)), ("execute", "ok"))
        self.assertEqual(rr(g(), move(confidence=0.7499999)), ("refuse", "confidence"))
        self.assertEqual(rr(g(), move()), ("execute", "ok"))
        self.assertEqual(rr(g(onFail="escalate"), move(confidence=0.5)), ("hold", "confidence"))
        self.assertEqual(rr(g(), move(scope="Control", confidence=0.5)), ("refuse", "confidence"))
        s = S(gates={"Control": {"min": 0.75, "onFail": "block"}})
        self.assertEqual(rr(s, move(scope="Control", confidence=0.5)), ("execute", "ok"))
        self.assertEqual(rr(g(), move(scope="teleop", confidence=0.5)), ("execute", "ok"))
        k = S(gates={"kick": {"min": 0.75, "onFail": "block"}})
        self.assertEqual(rr(k, move(scope="Kick", confidence=0.5)), ("refuse", "confidence"))
        self.assertEqual(rr(k, move(scope="Kick", confidence=0.5)), ("execute", "ok"))
        self.assertEqual(rr(S(gates={}), move(scope="toString", confidence=0)), ("execute", "ok"))
        self.assertEqual(rr(g(min=0), move(confidence=0)), ("execute", "ok"))
        self.assertEqual(rr(g(min=1, onFail="escalate"), move(confidence=0.9)), ("hold", "confidence"))
        self.assertEqual(rr(g(min=1, onFail="escalate"), move(confidence=1)), ("execute", "ok"))
        x = res(g(onFail="escalate"), move(confidence=0.5))
        self.assertEqual(x["state"]["seen"], [{"expires": 1030, "id": "m1"}])


class Properties(unittest.TestCase):
    def gen(self, rng):
        s = {"now": 1000}
        for k in ("estopped", "stopped"):
            if rng.random() < 0.5:
                s[k] = rng.random() < 0.4
        for k in ("minLoaControl", "minLoaSafety"):
            if rng.random() < 0.5:
                s[k] = rng.choice([1, 1, 2, 3])
        if rng.random() < 0.5:
            s["window"] = rng.choice([30, 12, 10, 5])
        s["maxSpeed"] = rng.choice([0, 1, 2])
        s["limits"] = {j: {"min": rng.choice([-2, -1, 0]), "max": rng.choice([0, 1, 2])}
                       for j in ("base", "elbow", "wrist")}
        if rng.random() < 0.5:
            s["gates"] = {"control": {"min": rng.choice([0.5, 0.9]), "onFail": rng.choice(["block", "escalate"])}}
        if rng.random() < 0.5:
            s["seen"] = [{"id": rng.choice("abc"), "expires": rng.choice([995, 1000, 1000.5, 1030])}]
        base = {"id": rng.choice("abcdefg"), "timestamp": rng.choice([1000, 995, 990, 1004.5, 1005, 970, 989.5, 1005.5, 900]),
                "role": rng.choice(["OPERATOR", "CREATOR", "M2M_TRUSTED", "GUEST", "ADMIN"])}
        if rng.random() < 0.5:
            base["loa"] = rng.choice([1, 2, 3])
        kind = rng.choice(["safety", "status", "move", "move"])
        base["kind"] = kind
        if kind == "safety":
            base["event"] = rng.choice(["ESTOP", "STOP", "RESUME", "ESTOP_CLEAR"])
        elif kind == "move":
            base.update(scope=rng.choice(["control", "teleop", "safety", "chat", "toString"]),
                        targets=[{"joint": rng.choice(["base", "elbow", "gripper"]),
                                  "position": rng.choice([-2.5, -1, 0, 0.5, 2.5])}],
                        speed=rng.choice([0, 0.5, 1, 2]))
            if rng.random() < 0.5:
                base["confidence"] = rng.choice([0, 0.5, 0.9, 1])
        return s, base

    def test_p1_estop_always(self):
        rng = random.Random(1)
        for _ in range(200):
            s, c = self.gen(rng)
            c = {"id": c["id"], "timestamp": c["timestamp"], "role": c["role"], "kind": "safety", "event": "ESTOP"}
            x = res(s, c)
            self.assertEqual((x["decision"], x["reason"], x["state"]["estopped"]), ("execute", "estop", True))

    def test_p2_estopped_nothing_moves(self):
        rng = random.Random(2)
        for _ in range(300):
            s, c = self.gen(rng)
            s["estopped"] = True
            x = res(s, c)
            ok = (x["decision"] != "execute" or c["kind"] == "status"
                  or (c["kind"] == "safety" and c["event"] != "RESUME"))
            self.assertTrue(ok, (s, c))

    def test_p3_latches(self):
        rng = random.Random(3)
        for _ in range(300):
            s, c = self.gen(rng)
            x = res(s, c)
            same = (x["state"]["estopped"] == s.get("estopped", False)
                    and x["state"]["stopped"] == s.get("stopped", False))
            self.assertTrue((x["decision"] == "execute" and c["kind"] == "safety") or same, (s, c))

    def test_p4_once(self):
        rng = random.Random(4)
        for _ in range(300):
            s, c = self.gen(rng)
            x = res(s, c)
            y = res(x["state"], c)
            self.assertIn(x["reason"], ("estop", "stale", "future"), (s, c)) if y["reason"] != "replay" else None


class Driver(unittest.TestCase):  # driver protocol, REQ-BU-*
    def test_subprocess(self):
        good = json.dumps({"id": "1", "op": "decide", "input": {"state": {"now": 1000}, "command": STATUS}})
        stdin = good + "\n \t \n\n{bad\n" + good + "\n"
        p = subprocess.run([sys.executable, str(HERE / "driver.py")], input=stdin.encode(),
                           capture_output=True, cwd=HERE, timeout=60)
        self.assertEqual(p.returncode, 0)
        self.assertNotIn(b"\r", p.stdout)
        lines = p.stdout.decode().split("\n")
        self.assertEqual(lines[-1], "")
        out = [json.loads(x) for x in lines[:-1]]
        self.assertEqual(len(out), 3)
        self.assertEqual(out[1], {"id": None, "error": "bad_request"})
        self.assertEqual(out[0]["result"]["reason"], "status")

    def test_bu001_regen_json(self):
        r = json.loads((HERE / "REGEN.json").read_text())
        self.assertEqual(set(r), {"lang", "build", "test", "driver"})
        for k in ("test", "driver"):
            self.assertIn("default", r[k])

    def test_bu004_size(self):
        n = sum(1 for f in HERE.glob("*.py") if not f.name.startswith("test_")
                for ln in f.read_text().splitlines() if ln.strip())
        self.assertLessEqual(n, 500)


if __name__ == "__main__":
    unittest.main()
