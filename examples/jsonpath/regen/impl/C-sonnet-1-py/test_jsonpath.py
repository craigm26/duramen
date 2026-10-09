import json
import os
import random
import subprocess
import sys
import unittest

import jsonpath

HERE = os.path.dirname(os.path.abspath(__file__))
ERR = "ERR"


def run(q, doc):
    try:
        return jsonpath.query(q, doc)
    except jsonpath.InvalidQuery:
        return ERR


def drive(lines):
    p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")],
                       input=("\n".join(lines) + "\n").encode("utf-8"),
                       capture_output=True, timeout=60)
    assert p.returncode == 0
    return [json.loads(l) for l in p.stdout.decode("utf-8").split("\n") if l]


def req(op="query", inp=None, id="r", **kw):
    d = {"id": id, "op": op, "input": inp}
    d.update(kw)
    return json.dumps(d)


class Table(unittest.TestCase):
    def check(self, rows):
        for q, doc, want in rows:
            got = run(q, doc)
            if want == ERR:
                self.assertEqual(got, ERR, q)
            else:
                self.assertNotEqual(got, ERR, q)
                self.assertEqual(got[0], want, q)


A = {"a": 1}
ABC = ["a", "b", "c", "d", "e", "f", "g"]
OBJ = {"obj": {"x": "y"}, "arr": [2, 3]}
BOTH = [[2, 3], {"x": "y"}]


class TestSyntax(Table):
    def test_sy001_root_blank(self):
        self.check([
            ("$", A, [A]), ("$ .a", A, [1]), ("$\t.a", A, [1]), ("$\n['a']", A, [1]),
            ("$\r\n.a \r\n.b", {"a": {"b": 2}}, [2]),
            ("", 1, ERR), (" $", 1, ERR), ("$ ", 1, ERR), ("$\n", 1, ERR), ("$.a ", A, ERR),
            ("$\x0c.a", A, ERR), ("$ .a", A, ERR), ("$ .a", A, ERR),
            ("@", 1, ERR), ("@.a", A, ERR), ("$$", 1, ERR), ("a", 1, ERR), ("$a", A, ERR),
        ])

    def test_sy002_dot(self):
        ok = ["a", "_", "_a1", "A", "é", "\u0080x", "😀", "a1b2", "true", "null", "Z", "z", "a0z9"]
        for n in ok:
            self.assertEqual(run("$." + n, {n: 1})[0], [1], n)
        self.check([
            ("$.a.b", {"a": {"b": 1}}, [1]), ("$..a", {"x": {"a": 1}}, [1]),
            ("$.*", A, [1]), ("$..*", {"a": [1]}, [[1], 1]), ("$..['a']", A, [1]),
        ])
        for bad in ["$.", "$..", "$...", "$...a", "$.1", "$.1a", "$.$", "$.-a", "$.a-b", "$. a",
                    "$.. a", "$.\ta", "$.'a'", "$.[0]", "$.\x7f", "$.a b", "$.@a", "$.ˋa", "$.{a"]:
            self.assertEqual(run(bad, {}), ERR, bad)

    def test_sy003_strings(self):
        good = [
            ("$['a']", "a"), ('$["a"]', "a"), ("$['\\'']", "'"), ('$["\'"]', "'"), ("$['\"']", '"'),
            ('$["\\""]', '"'), ("$['\\\\']", "\\"), ("$['\\/']", "/"), ("$['/']", "/"),
            ("$['\\n']", "\n"), ("$['\\u000A']", "\n"), ("$['\\u000a']", "\n"), ("$['\\u00E9']", "é"),
            ("$['\\uD83D\\uDE00']", "😀"), ("$['\\ud83d\\ude00']", "😀"), ("$['😀']", "😀"),
            ("$['\\u000b']", "\x0b"), ("$['\x7f']", "\x7f"), ("$[' ']", " "),
            ("$['']", ""), ("$['\\b\\f\\r\\t']", "\b\f\r\t"), ("$['\\uD7FF']", "퟿"),
            ("$['\\uE000']", ""), ("$['\\u002F']", "/"),
        ]
        for q, name in good:
            r = run(q, {name: 1})
            self.assertNotEqual(r, ERR, q)
            self.assertEqual(r[0], [1], q)
        bad = ["$['\\\"']", '$["\\\'"]', "$['\\q']", "$['\\x41']", "$['\\U0041']", "$['\\u004']",
               "$['\\uD83D']", "$['\\uDE00']", "$['\\uD83Dx']", "$['\\uD83D\\u0041']", "$['\\uDBFF']",
               "$['\\uDC00']", "$['\\uD800\\uDBFF']", "$['\n']", "$['\t']", "$['\x00']", "$['\x1f']",
               "$['a", "$['a\"]", "$['a'", "$[a]", "$['a'b']"]
        for q in bad:
            self.assertEqual(run(q, {}), ERR, q)

    def test_sy004_index(self):
        self.check([
            ("$[1]", ["a", "b"], ["b"]), ("$[-1]", ["a", "b"], ["b"]), ("$[ 1 ]", ["a", "b"], ["b"]),
            ("$[9007199254740991]", ["a"], []), ("$[-9007199254740991]", ["a"], []),
        ])
        for bad in ["$[01]", "$[-0]", "$[+1]", "$[1.0]", "$[1e1]", "$[0x1]", "$[9007199254740992]",
                    "$[-9007199254740992]", "$[99999999999999999999]", "$[1 1]", "$[-]", "$[- 1]", "$[]"]:
            self.assertEqual(run(bad, ["a"]), ERR, bad)

    def test_sy005_slice(self):
        abc = ["a", "b", "c"]
        self.check([
            ("$[:]", abc, abc), ("$[::]", abc, abc), ("$[1:]", abc, ["b", "c"]), ("$[:2]", abc, ["a", "b"]),
            ("$[::2]", abc, ["a", "c"]), ("$[ 1 : 2 : 1 ]", abc, ["b"]), ("$[1: :1]", abc, ["b", "c"]),
            ("$[::-1]", abc, ["c", "b", "a"]), ("$[:9007199254740991]", abc, abc),
            ("$[-9007199254740991:]", abc, abc),
        ])
        for bad in ["$[1:2:3:4]", "$[-0:]", "$[:-0]", "$[::-0]", "$[01:]", "$[:9007199254740992]",
                    "$[::9007199254740992]", "$[1.0:]", "$[1 2:]"]:
            self.assertEqual(run(bad, abc), ERR, bad)

    def test_sy006_bracket(self):
        d = {"a": 1, "b": 2}
        self.check([
            ("$['a','b']", d, [1, 2]), ("$[ 'a' , 'b' ]", d, [1, 2]), ("$[\n'b',\t'a'\r]", d, [2, 1]),
            ("$[*,'a']", d, [1, 2, 1]), ("$[?@ == 2, 'a']", d, [2, 1]),
        ])
        for bad in ["$[ ]", "$[,'a']", "$['a',]", "$['a',,'b']", "$['a''b']", "$['a' 'b']", "$[['a']]",
                    "$['a']]", "$[**]", "$[*a]"]:
            self.assertEqual(run(bad, d), ERR, bad)

    def test_sy007_filters(self):
        doc = [1, 2, {"a": 1}]
        self.check([
            ("$[?@]", doc, doc), ("$[? @]", doc, doc), ("$[?@ ]", doc, doc), ("$[?(@)]", doc, doc),
            ("$[?( @ )]", doc, doc), ("$[?!@.a]", doc, [1, 2]), ("$[?! @.a]", doc, [1, 2]),
            ("$[?!(@.a)]", doc, [1, 2]), ("$[?! ( @.a )]", doc, [1, 2]), ("$[?!(!@.a)]", doc, [{"a": 1}]),
            ("$[?@ == 1]", doc, [1]), ("$[?@==1]", doc, [1]), ("$[?1 == @]", doc, [1]),
            ("$[?@ > 1 && @ < 3]", doc, [2]), ("$[?@ == 1 || @.a]", doc, [1, {"a": 1}]),
            ("$[?1 == 1]", doc, doc),
        ])
        for bad in ["$[?]", "$[? ]", "$[?()]", "$[?true]", "$[?false]", "$[?null]", "$[?1]", "$[?'a']",
                    "$[?!@.a == 1]", "$[?!!@.a]", "$[?!1]", "$[?1 < 2 < 3]", "$[?@ & @]", "$[?@ | @]",
                    "$[?@ and @]", "$[?@ or @]", "$[?@ = 1]", "$[?@ === 1]", "$[?@ <> 1]", "$[?@ =< 1]",
                    "$[?@ => 1]", "$[?@ !== 1]", "$[?(@]", "$[?@)]", "$[?@ == ]", "$[?== 1]"]:
            self.assertEqual(run(bad, [1]), ERR, bad)

    def test_sy008_literals(self):
        doc = [0, 1, 100, -1.5, 0.001, True, None, "x"]
        self.check([
            ("$[?@ == -0]", doc, [0]), ("$[?@ == 0.0]", doc, [0]), ("$[?@ == -0.0]", doc, [0]),
            ("$[?@ == 1e2]", doc, [100]), ("$[?@ == 1E2]", doc, [100]), ("$[?@ == 1e+2]", doc, [100]),
            ("$[?@ == 100.0e0]", doc, [100]), ("$[?@ == -1.5]", doc, [-1.5]), ("$[?@ == -15e-1]", doc, [-1.5]),
            ("$[?@ == 1e-3]", doc, [0.001]), ("$[?@ == true]", doc, [True]), ("$[?@ == null]", doc, [None]),
            ("$[?@ == 'x']", doc, ["x"]), ('$[?@ == "x"]', doc, ["x"]),
            ("$[?@ == 9007199254740993]", ["a"], []), ("$[?@ == 1e400]", ["a"], []),
        ])
        for lit in ["01", "1.", ".5", "+1", "1e", "1e+", "0x10", "1_000", "Infinity", "NaN", "True", "NULL",
                    "nul", "-", "--1", "'x"]:
            self.assertEqual(run("$[?@ == %s]" % lit, [1]), ERR, lit)

    def test_sy009_singular(self):
        d = [{"a": 1, "b": [5, 6]}]
        for q in ["$[?@.a == 1]", "$[?@['a'] == 1]", '$[?@["a"] == 1]', "$[?@.b[1] == 6]", "$[?@.b[-1] == 6]",
                  "$[?@ .b [0] == 5]", "$[?$[0].a == 1]", "$[?@ == $[0]]"]:
            self.assertEqual(run(q, d)[0], d, q)
        for bad in ["$[?@[ 'a' ] == 1]", "$[?@['a' ] == 1]", "$[?@[ 0] == 1]", "$[?@.* == 1]", "$[?@[*] == 1]",
                    "$[?@[0,1] == 1]", "$[?@['a','b'] == 1]", "$[?@[0:1] == 1]", "$[?@..a == 1]",
                    "$[?@[?@] == 1]", "$[?1 == @..a]"]:
            self.assertEqual(run(bad, d), ERR, bad)

    def test_sy010_function_syntax(self):
        d = ["ab", [1, 2]]
        self.check([
            ("$[?length(@) == 2]", d, d), ("$[?length( @ ) == 2]", d, d), ("$[?length(\n@\n) == 2]", d, d),
            ("$[?match(@ , 'a.')]", d, ["ab"]), ("$[?search( @,'b' )]", d, ["ab"]),
        ])
        for bad in ["$[?length (@) == 2]", "$[?Length(@) == 2]", "$[?LENGTH(@) == 2]", "$[?len(@) == 2]",
                    "$[?foo(@)]", "$[?constructor(@)]", "$[?length() == 2]", "$[?length(@, @) == 2]",
                    "$[?count() == 1]", "$[?match(@)]", "$[?match(@, 'a', 'b')]", "$[?value() == 1]",
                    "$[?length(@ == 2]", "$[?length@ == 2]", "$[?_length(@) == 2]", "$[?length(@,) == 2]"]:
            self.assertEqual(run(bad, d), ERR, bad)

    def test_sy011_types(self):
        d = [{"a": "x", "b": [1, 2]}]
        good = ["$[?length(@.a) == 1]", "$[?length('abc') == 3]", "$[?length(true) == length(1)]",
                "$[?length(count(@.*)) == length(1)]", "$[?length(value(@.b)) == 2]", "$[?count(@.*) == 2]",
                "$[?count(@) == 1]", "$[?count(@..*) == 4]", "$[?count($..*) == 5]", "$[?match(@.a, 'x')]",
                "$[?match('x', @.a)]", "$[?search(@.a, @.a)]", "$[?value(@..a) == 'x']"]
        for q in good:
            self.assertEqual(run(q, d)[0], d, q)
        self.assertEqual(run("$[?match(length(@.b), '2')]", d)[0], [])
        self.assertEqual(run("$[?value(@.*) == 'x']", d)[0], [])
        for bad in ["$[?length(@)]", "$[?count(@.*)]", "$[?value(@.a)]", "$[?!length(@)]",
                    "$[?match(@.a, 'x') == true]", "$[?search(@.a, 'x') != false]", "$[?length(@.*) == 2]",
                    "$[?length(@..a) == 1]", "$[?length(@[0,1]) == 1]", "$[?length(match(@.a, 'x')) == 1]",
                    "$[?length(@.a == 'x') == 1]", "$[?length(!@.a) == 1]", "$[?count(1) == 1]",
                    "$[?count('a') == 1]", "$[?count(length(@)) == 1]", "$[?count(value(@.b)) == 1]",
                    "$[?count(@.a == 'x') == 1]", "$[?count((@.a)) == 1]", "$[?value(1) == 1]",
                    "$[?value(count(@.*)) == 2]", "$[?match(@.*, 'x')]", "$[?match(@.a, @.*)]",
                    "$[?match(@.a == 'x', 'x')]", "$[?length(@.a) == count(1)]"]:
            self.assertEqual(run(bad, d), ERR, bad)


class TestRequests(unittest.TestCase):
    def test_rq001_errors(self):
        out = drive(["{not json", "[1]", '{"op":"query","input":{"query":"$","document":1}}',
                     '{"id":7,"op":"query","input":{"query":"$","document":1}}',
                     '{"id":"a","input":{"query":"$","document":1}}',
                     '{"id":"r1","op":"select","input":{"query":"$","document":1}}',
                     '{"id":"r1","op":"query"}', '{"id":"r1","op":"query","input":[]}',
                     req(inp={"document": 1}), req(inp={"query": 5, "document": 1}),
                     req(inp={"query": None, "document": 1}), req(inp={"query": "$"}),
                     req(inp={"query": "$[", "document": 1})])
        self.assertEqual(out[0], {"id": None, "error": "bad_request"})
        self.assertEqual(out[1], {"id": None, "error": "bad_request"})
        self.assertEqual(out[2], {"id": None, "error": "bad_request"})
        self.assertEqual(out[3], {"id": None, "error": "bad_request"})
        self.assertEqual(out[4], {"id": "a", "error": "unknown_op"})
        self.assertEqual(out[5], {"id": "r1", "error": "unknown_op"})
        for k in range(6, 12):
            self.assertEqual(out[k]["error"], "bad_request")
        self.assertEqual(out[12], {"id": "r", "error": "invalid_query"})

    def test_rq002_result_and_blank_lines(self):
        out = drive(["", "  \t ", req(inp={"query": "$[0,0]", "document": ["a"]}),
                     req(inp={"query": "$.x", "document": {"k": "v"}}, id="b")])
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], {"id": "r", "result": {"values": ["a", "a"], "paths": ["$[0]", "$[0]"]}})
        self.assertEqual(out[1], {"id": "b", "result": {"values": [], "paths": []}})

    def test_rq003_any_document_extra_members(self):
        out = drive([json.dumps({"id": "r1", "op": "query", "trace": True,
                                 "input": {"query": "$.a", "document": {"a": 1}, "flags": "x"}})])
        self.assertEqual(out[0]["result"], {"values": [1], "paths": ["$['a']"]})
        for doc in [None, False, "abc", 1.5, []]:
            self.assertEqual(jsonpath.query("$", doc), ([doc], ["$"]))
        self.assertEqual(jsonpath.query("$.*", 1), ([], []))
        self.assertEqual(jsonpath.query("$[0]", "abc"), ([], []))

    def test_rq004_validity_independent_of_document(self):
        self.assertEqual(run("$[?length(@.*) < 3]", []), ERR)
        self.assertEqual(run("$[?length(@.*) < 3]", {"b": 1}), ERR)
        self.assertEqual(run("$.a.b.c[5]['x']", {"a": 1})[0], [])
        self.assertEqual(run("$[?@.a < 'b']", [1, [2], {"a": None}])[0], [])
        self.assertEqual(run("$..[?@[-1] == 1]", "text")[0], [])

    def test_driver_output_is_ascii_single_line(self):
        out = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")],
                             input=json.dumps({"id": "x", "op": "query",
                                               "input": {"query": "$[*]", "document": ["😀 "]}}).encode() + b"\n",
                             capture_output=True).stdout
        self.assertTrue(out.endswith(b"\n"))
        self.assertNotIn(b"\r", out)
        self.assertEqual(out.count(b"\n"), 1)
        self.assertEqual(json.loads(out)["result"]["values"], ["😀 "])


class TestSelectors(Table):
    def test_se002_names(self):
        self.assertEqual(jsonpath.query("$.a", A), ([1], ["$['a']"]))
        self.check([("$.A", A, []), ("$['a']", ["a"], []), ("$['0']", ["x"], []), ("$.a", "a", []),
                    ("$['é']", {"é": 1}, []), ("$.constructor", {}, []), ("$.toString", A, [])])
        self.assertEqual(jsonpath.query("$['0']", {"0": "x"}), (["x"], ["$['0']"]))
        self.assertEqual(jsonpath.query("$['é']", {"é": 1, "é": 2})[1], ["$['é']"])
        self.assertEqual(jsonpath.query("$.__proto__", {"__proto__": 1})[0], [1])

    def test_se003_wildcard_and_se008_order(self):
        self.assertEqual(jsonpath.query("$.*", {"b": 1, "a": 2}), ([2, 1], ["$['a']", "$['b']"]))
        self.assertEqual(jsonpath.query("$[*]", [3, 1, 2])[0], [3, 1, 2])
        self.assertEqual(jsonpath.query("$.*.*", {"x": [1, 2], "y": {"z": 3}})[0], [1, 2, 3])
        self.assertEqual(jsonpath.query("$.*", {"b": 1, "a": 2, "B": 3})[0], [3, 2, 1])
        self.assertEqual(jsonpath.query("$.*", {"10": 1, "9": 2, "1": 3})[0], [3, 1, 2])
        self.assertEqual(jsonpath.query("$.*", {"ab": 1, "a": 2, "": 3})[0], [3, 2, 1])
        self.assertEqual(jsonpath.query("$.*", {"😀": 1, "￿": 2, "é": 3, "z": 4})[0], [4, 3, 2, 1])
        self.assertEqual(jsonpath.query("$[?@ > 0]", {"b": 1, "a": 2})[0], [2, 1])
        self.assertEqual(jsonpath.query("$..*", {"b": {"y": 1, "x": 2}, "a": [3]})[0],
                         [[3], {"x": 2, "y": 1}, 3, 2, 1])

    def test_se004_index(self):
        self.check([("$[0]", ["a", "b"], ["a"]), ("$[-1]", ["a", "b"], ["b"]), ("$[2]", ["a", "b"], []),
                    ("$[-3]", ["a", "b"], []), ("$[0]", {"0": "a"}, []), ("$[0]", "ab", []),
                    ("$[0][1]", [[1, 2]], [2])])

    def test_se005_slice(self):
        rows = [("$[1:3]", "bc"), ("$[5:]", "fg"), ("$[:2]", "ab"), ("$[-2:]", "fg"), ("$[:-5]", "ab"),
                ("$[1:5:2]", "bd"), ("$[5:1:-2]", "fd"), ("$[::-1]", "gfedcba"), ("$[::3]", "adg"),
                ("$[::-3]", "gda"), ("$[1:1]", ""), ("$[3:1]", ""), ("$[3:1:-1]", "dc"), ("$[0:7:0]", ""),
                ("$[::0]", ""), ("$[10:]", ""), ("$[-10:2]", "ab"), ("$[:100]", "abcdefg"),
                ("$[-1:-10:-1]", "gfedcba"), ("$[6:-8:-2]", "geca"), ("$[:0]", ""), ("$[:-7]", ""),
                ("$[-10::-1]", ""), ("$[10::-1]", "gfedcba"), ("$[7:0:-1]", "gfedcb"),
                ("$[-9007199254740991:9007199254740991:9007199254740991]", "a")]
        for q, want in rows:
            self.assertEqual(run(q, ABC)[0], list(want), q)
        self.assertEqual(run("$[5:1:-2]", ABC)[1], ["$[5]", "$[3]"])
        self.assertEqual(run("$[0:2]", {"0": 1, "1": 2})[0], [])
        self.assertEqual(run("$[:]", "abc")[0], [])

    def test_se006_child(self):
        self.assertEqual(run("$[0, 3]", ABC)[0], ["a", "d"])
        self.assertEqual(run("$[3, 0]", ABC)[0], ["d", "a"])
        self.assertEqual(run("$[0:2, 5]", ABC)[1], ["$[0]", "$[1]", "$[5]"])
        self.assertEqual(run("$[*, 0]", ["a", "b"])[0], ["a", "b", "a"])
        self.assertEqual(run("$['b', 'a']", {"a": 1, "b": 2})[0], [2, 1])
        self.assertEqual(run("$['a', 0]", {"a": 1})[0], [1])
        self.assertEqual(run("$['a', 0]", [5])[0], [5])
        self.assertEqual(run("$[*][0]", [[1, 2], [3], [], 4])[0], [1, 3])
        self.assertEqual(run("$[1, 0][0]", [["a"], ["b"]])[0], ["b", "a"])

    def test_se007_descendant(self):
        d = {"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}
        self.assertEqual(run("$..j", d), ([4, 1], ["$['a'][2][0]['j']", "$['o']['j']"]))
        self.assertEqual(run("$..[0]", d)[0], [5, {"j": 4}])
        self.assertEqual(run("$..*", d)[1], ["$['a']", "$['o']", "$['a'][0]", "$['a'][1]", "$['a'][2]",
                                              "$['a'][2][0]", "$['a'][2][1]", "$['a'][2][0]['j']",
                                              "$['a'][2][1]['k']", "$['o']['j']", "$['o']['k']"])
        self.assertEqual(run("$.o..[*, *]", d)[0], [1, 2, 1, 2])
        self.assertEqual(run("$.a..[0, 1]", d)[0], [5, 3, {"j": 4}, {"k": 6}])
        self.assertEqual(run("$..a", {"a": {"a": 1}})[0], [{"a": 1}, 1])
        self.assertEqual(run("$..*", 1)[0], [])
        self.assertEqual(run("$..[*]", [[[1]]])[0], [[[1]], [1], 1])
        self.assertEqual(run("$..['a','b']", {"b": {"a": 1}, "a": 2})[0], [2, {"a": 1}, 1])
        self.assertEqual(run("$..[?@ > 1]", [1, [2, 3]])[1], ["$[1][0]", "$[1][1]"])

    def test_se009_null(self):
        self.assertEqual(run("$.a", {"a": None}), ([None], ["$['a']"]))
        self.assertEqual(run("$[?@.a == null]", [{"a": None}, {}])[1], ["$[0]"])
        self.assertEqual(run("$[?@.a]", [{"a": None}, {}])[1], ["$[0]"])
        self.assertEqual(run("$[*]", [None, None])[0], [None, None])

    def test_se001_root(self):
        self.assertEqual(run("$", [1, {"a": 2}]), ([[1, {"a": 2}]], ["$"]))

    def test_rfc_examples(self):
        j = {"'": {"@": 2}, "o": {"j j": {"k.k": 3}}}
        self.assertEqual(run("$.o['j j']['k.k']", j), ([3], ["$['o']['j j']['k.k']"]))
        self.assertEqual(run("$[\"'\"][\"@\"]", j), ([2], ["$['\\'']['@']"]))
        self.assertEqual(run("$.o[*]", {"a": [5, 3], "o": {"j": 1, "k": 2}})[0], [1, 2])


class TestFilters(Table):
    def test_fi001(self):
        self.check([("$[?@ > 1]", [1, 2, 3], [2, 3]), ("$[?@ > 1]", {"a": 1, "b": 2, "c": 3}, [2, 3]),
                    ("$[?@ > 1]", 5, []),
                    ("$[?@.x == $.x]", {"x": 1, "y": {"x": 1}, "z": {"x": 2}}, [{"x": 1}]),
                    ("$[?@[?@ == 1]]", [[1, 2], [3]], [[1, 2]]),
                    ("$..[?@.k]", {"k": 1, "a": [{"k": 2}]}, [{"k": 2}])])

    def test_fi002_existence(self):
        self.assertEqual(run("$[?@.a]", [{"a": None}, {"a": False}, {"b": 1}, 1])[1], ["$[0]", "$[1]"])
        self.assertEqual(run("$[?!@.a]", [{"a": None}, {"a": False}, {"b": 1}, 1])[1], ["$[2]", "$[3]"])
        self.assertEqual(run("$[?@.*]", [[], [0], {}, {"a": 0}, "ab"])[1], ["$[1]", "$[3]"])
        self.assertEqual(run("$[?@..x]", [{"y": {"x": None}}, {"y": 1}])[1], ["$[0]"])
        self.assertEqual(run("$[?$.flag]", {"flag": False, "a": 1})[0], [1, False])
        self.assertEqual(run("$[?@.a == false]", [{"a": None}, {"a": False}])[1], ["$[1]"])

    def test_fi003_nothing(self):
        for q, want in [("$[?$.absent1 == $.absent2]", BOTH), ("$[?$.absent1 <= $.absent2]", BOTH),
                        ("$[?$.absent == 'g']", []), ("$[?$.absent1 != $.absent2]", []),
                        ("$[?$.absent != 'g']", BOTH), ("$[?$.absent < 'g']", []),
                        ("$[?$.absent >= 'g']", []), ("$[?$.absent == null]", []),
                        ("$[?$.absent == length(1)]", BOTH), ("$[?length(1) == length(true)]", BOTH),
                        ("$[?length(1) < length(2)]", [])]:
            self.assertEqual(run(q, OBJ)[0], want, q)

    def test_fi004_equality(self):
        for q, want in [("$[?13 == '13']", []), ("$[?$.obj == $.arr]", []), ("$[?$.obj != $.arr]", BOTH),
                        ("$[?$.obj == $.obj]", BOTH), ("$[?$.obj != $.obj]", []), ("$[?$.arr == $.arr]", BOTH),
                        ("$[?$.obj == 17]", []), ("$[?$.obj != 17]", BOTH)]:
            self.assertEqual(run(q, OBJ)[0], want, q)
        self.assertEqual(run("$[?@ == 1]", [1, 1.0, 1e0, "1", True, [1], {"a": 1}])[1], ["$[0]", "$[1]", "$[2]"])
        self.assertEqual(run("$[?@ == 0]", [0, -0, False, None, "0", 0.0])[1], ["$[0]", "$[1]", "$[5]"])
        self.assertEqual(run("$[?@ == false]", [False, 0, None, ""])[1], ["$[0]"])
        self.assertEqual(run("$[?@ == null]", [None, False, 0, ""])[1], ["$[0]"])
        self.assertEqual(run("$[?@ == 'é']", ["é", "é"])[1], ["$[0]"])
        self.assertEqual(run("$[?@ == $.x]", {"x": [1, {"a": 2}], "y": [1, {"a": 2}], "z": [{"a": 2}, 1]})[1],
                         ["$['x']", "$['y']"])
        self.assertEqual(run("$[?@ == $.x]", {"x": {"a": 1, "b": [True]}, "y": {"b": [True], "a": 1},
                                              "z": {"a": 1}})[1], ["$['x']", "$['y']"])
        self.assertEqual(run("$[?@ == $.x]", {"x": [], "y": {}, "z": []})[1], ["$['x']", "$['z']"])
        self.assertEqual(run("$[?@ == $.x]", {"x": {}, "y": 0, "z": "", "w": []})[1], ["$['x']"])

    def test_fi005_less(self):
        true = ["1 < 2", "-1 < 0", "1.5 < 2", "'a' < 'b'", "'' < 'a'", "'a' < 'ab'", "'ab' < 'b'",
                "'B' < 'a'", "'z' < 'é'", "'\\uffff' < '😀'"]
        false = ["2 < 1", "1e1 < 9", "'😀' < '\\uffff'", "1 < '2'", "'1' < 2", "false < true", "null < 1",
                 "$.arr < $.arr", "$.obj < $.arr", "1 < $.arr"]
        for e in true:
            self.assertEqual(run("$[?%s]" % e, OBJ)[0], BOTH, e)
        for e in false:
            self.assertEqual(run("$[?%s]" % e, OBJ)[0], [], e)
        self.assertEqual(run("$[?@ < 'b']", ["a", "B", "b", "ba", "", "é", 1])[0], ["a", "B", ""])

    def test_fi006_derived(self):
        true = ["1 <= 2", "'a' <= 'b'", "$.obj <= $.obj", "$.arr <= $.arr", "true <= true", "true >= true",
                "null <= null", "1 != '1'", "2 >= 1", "1 >= 1.0", "'b' > 'a'"]
        false = ["1 > 2", "'a' > 'b'", "$.obj <= $.arr", "1 <= $.arr", "1 >= $.arr", "1 > $.arr", "true > true"]
        for e in true:
            self.assertEqual(run("$[?%s]" % e, OBJ)[0], BOTH, e)
        for e in false:
            self.assertEqual(run("$[?%s]" % e, OBJ)[0], [], e)

    def test_fi007_logic(self):
        d = [1, 2, 3, 4]
        for q, want in [("$[?@ < 2 || @ > 3]", [1, 4]), ("$[?@ > 1 && @ < 4]", [2, 3]),
                        ("$[?@ == 1 || @ == 2 && @ == 3]", [1]), ("$[?(@ == 1 || @ == 2) && @ == 2]", [2]),
                        ("$[?!(@ == 1 || @ == 2)]", [3, 4]), ("$[?!(@ == 1) && !(@ == 4)]", [2, 3]),
                        ("$[?@ > 0 && @ < 10 && @ != 3]", [1, 2, 4]), ("$[?@ == 4 || @ == 3 || @ == 9]", [3, 4]),
                        ("$[?@==1||@==2]", [1, 2]), ("$[?@>1&&@<4]", [2, 3])]:
            self.assertEqual(run(q, d)[0], want, q)


class TestFunctions(Table):
    DOC = ["a", "😀", "é", "é", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, True, None]

    def test_fn001_length(self):
        self.assertEqual(run("$[?length(@) == 1]", self.DOC)[0], ["a", "😀", "é"])
        self.assertEqual(run("$[?length(@) == 2]", self.DOC)[0], ["é"[0:0] + "é", [1, [2, 3]], {"a": 1, "b": 2}])
        self.assertEqual(run("$[?length(@) == 0]", self.DOC)[0], [""])
        self.assertEqual(run("$[?length(@) == length(@.x)]", self.DOC)[0], [1, True, None])
        self.assertEqual(run("$[?length(@.x) == 0]", self.DOC)[0], [])
        self.assertEqual(run("$[?length('😀😀') == 2]", [7])[0], [7])

    def test_fn002_count(self):
        d = [[1, 2], [3], [], {"a": 1, "b": 2}, 5]
        self.assertEqual(run("$[?count(@.*) == 2]", d)[0], [[1, 2], {"a": 1, "b": 2}])
        self.assertEqual(run("$[?count(@.*) == 0]", d)[0], [[], 5])
        self.assertEqual(run("$[?count(@) == 1]", d)[0], d)
        self.assertEqual(run("$[?count(@[0, 0]) == 2]", d)[0], [[1, 2], [3]])
        self.assertEqual(run("$[?count(@..*) == 2]", d)[0], [[1, 2], {"a": 1, "b": 2}])
        self.assertEqual(run("$[?count($[*]) == 5]", d)[0], d)

    def test_fn003_value(self):
        d = [{"c": "red"}, {"a": {"c": "red"}}, {"c": "red", "d": {"c": "blue"}}, {}]
        self.assertEqual(run("$[?value(@..c) == 'red']", d)[0], d[:2])
        self.assertEqual(run("$[?value(@.*) == 'red']", d)[0], d[:1])
        self.assertEqual(run("$[?value(@.x) == value(@.y)]", d)[0], d)
        self.assertEqual(run("$[?value(@..c) != 'red']", d)[0], d[2:])

    def test_fn004_fn005_match_search(self):
        d = ["abc", "abcd", "xabc", "ab\nc", 1, None]
        self.assertEqual(run("$[?match(@, 'a.c')]", d)[0], ["abc"])
        self.assertEqual(run("$[?match(@, 'a.*')]", d)[0], ["abc", "abcd"])
        self.assertEqual(run("$[?match(@, '[')]", d)[0], [])
        self.assertEqual(run("$[?!match(@, '[')]", d)[0], d)
        self.assertEqual(run("$[?match(@, 1)]", d)[0], [])
        self.assertEqual(run("$[?match(1, '1')]", d)[0], [])
        self.assertEqual(run("$[?match(@.x, '.*')]", d)[0], [])
        self.assertEqual(run("$[?match(@, 'abc|xabc')]", d)[0], ["abc", "xabc"])
        s = ["abc", "xyz", "", "a\nb", "x^ay", 1]
        self.assertEqual(run("$[?search(@, 'b')]", s)[0], ["abc", "a\nb"])
        self.assertEqual(run("$[?search(@, '^a')]", s)[0], ["x^ay"])
        self.assertEqual(run("$[?search(@, '')]", s)[0], s[:5])
        self.assertEqual(run("$[?search(@, 'a.b')]", s)[0], [])
        self.assertEqual(run("$[?search(@, 'b|z')]", s)[0], ["abc", "xyz", "a\nb"])
        self.assertEqual(run("$[?search(@, '[')]", s)[0], [])


class TestRegexp(unittest.TestCase):
    def m(self, pat, s):
        import iregexp
        return iregexp.match(s, pat)

    def test_rx001_grammar(self):
        yes = [("a", "a"), ("", ""), ("a|", ""), ("()", ""), ("(a|b)c", "bc"), (",-/>@Z^z~", ",-/>@Z^z~"),
               ("a\\]", "a]")]
        for p, s in yes:
            self.assertTrue(self.m(p, s), p)
        for p in ["\\d", "\\w", "\\s", "a*?", "(?:a)", "a]", "a{", "a}", "[]", "[^]", "*a", "a**", "(a",
                  "a)", "\\", "\\1", "\\$", "\\/", "\\u0041", "\\x41", "\\b"]:
            self.assertFalse(self.m(p, "a") or self.m(p, "a]") or self.m(p, ""), p)

    def test_rx002_matching(self):
        self.assertTrue(self.m(".", "😀"))
        self.assertTrue(self.m(".", " "))
        self.assertTrue(self.m(".", "\u0085"))
        self.assertFalse(self.m(".", "\n"))
        self.assertFalse(self.m(".", "\r"))
        self.assertFalse(self.m("..", "😀"))
        self.assertTrue(self.m("^a", "^a"))
        self.assertFalse(self.m("^a", "a"))
        self.assertTrue(self.m("a$", "a$"))
        self.assertFalse(self.m("a", "A"))
        self.assertTrue(self.m("a|bc", "bc"))
        self.assertFalse(self.m("a|bc", "abc"))

    def test_rx003_classes(self):
        self.assertTrue(self.m("[a-c]+", "abc"))
        self.assertFalse(self.m("[a-c]+", "abd"))
        self.assertTrue(self.m("[^a]", "\n"))
        self.assertTrue(self.m("[-a]", "-"))
        self.assertTrue(self.m("[a-]", "-"))
        self.assertFalse(self.m("[^-]", "-"))
        self.assertTrue(self.m("[a^]", "^"))
        self.assertTrue(self.m("[.]", "."))
        self.assertFalse(self.m("[.]", "a"))
        self.assertTrue(self.m("[$]", "$"))
        self.assertTrue(self.m("[\\]]", "]"))
        self.assertTrue(self.m("[\\\\]", "\\"))
        self.assertTrue(self.m("[\\-a]", "-"))
        self.assertFalse(self.m("[a-c-e]", "a"))
        self.assertFalse(self.m("[a-c-e]", "-"))
        self.assertTrue(self.m("[\\n]", "\n"))
        self.assertTrue(self.m("[😀-😂]", "😁"))
        self.assertFalse(self.m("[a", "a"))
        self.assertTrue(self.m("[\\P{L}]", "1"))
        self.assertTrue(self.m("[,.Z^]+", ",.Z^"))

    def test_rx004_categories(self):
        self.assertTrue(self.m("\\p{Lu}", "É"))
        self.assertFalse(self.m("\\p{Lu}", "a"))
        self.assertTrue(self.m("\\p{Lt}", "ǅ"))
        self.assertTrue(self.m("\\p{L}+", "日本"))
        self.assertTrue(self.m("\\p{Nd}+", "١٢٣"))
        self.assertTrue(self.m("\\p{N}", "Ⅻ"))
        self.assertTrue(self.m("\\P{L}", "😀"))
        self.assertTrue(self.m("\\p{So}", "😀"))
        self.assertTrue(self.m("\\p{Zs}", " "))
        self.assertFalse(self.m("\\p{Zs}", "\t"))
        self.assertTrue(self.m("\\p{Cc}", "\u0085"))
        self.assertTrue(self.m("[\\p{Lu}0-9]+", "A1"))
        self.assertTrue(self.m("[^\\p{L}]", "1"))
        for p in ["\\p{IsBasicLatin}", "\\p{Greek}", "\\p{lu}", "\\p{Cs}", "\\p{Lu", "\\pL"]:
            self.assertFalse(self.m(p, "A") or self.m(p, "α"), p)

    def test_rx005_escapes(self):
        self.assertTrue(self.m("a\\.b", "a.b"))
        self.assertFalse(self.m("a\\.b", "axb"))
        for p, s in [("\\-", "-"), ("\\^", "^"), ("\\{", "{"), ("\\t", "\t"), ("\\n", "\n"), ("\\\\", "\\")]:
            self.assertTrue(self.m(p, s), p)

    def test_rx006_quantifiers(self):
        cases = [("a{2}", ["aa"]), ("a{2,}", ["aa", "aaa"]), ("a{1,2}", ["a", "aa"]), ("a{0}", [""]),
                 ("a{02}", ["aa"]), ("(ab)*", ["", "ab", "abab"]), ("a?b", ["b", "ab"])]
        for p, yes in cases:
            for s in ["", "a", "aa", "aaa", "b", "ab", "aab", "abab", "aba"]:
                self.assertEqual(self.m(p, s), s in yes, (p, s))
        for p in ["a{,2}", "a{2}{3}", "a+?", "{2}", "a{x}", "a{2"]:
            self.assertFalse(any(self.m(p, s) for s in ["", "a", "aa", "aaaaaa", "{2}", "a{2"]), p)


class TestNormalizedPaths(unittest.TestCase):
    def test_np001(self):
        self.assertEqual(run("$.a", A)[1], ["$['a']"])
        self.assertEqual(run("$[-3]", [0, 1, 2, 3, 4])[1], ["$[2]"])
        self.assertEqual(run("$.a.b[1:2]", {"a": {"b": [0, 1, 2]}})[1], ["$['a']['b'][1]"])
        self.assertEqual(run('$["\\u000B"]', {"\x0b": 1})[1], ["$['\\u000b']"])
        self.assertEqual(run('$["\\u0061"]', A)[1], ["$['a']"])
        self.assertEqual(run("$[10]", list(range(11)))[1], ["$[10]"])

    def test_np002(self):
        cases = {"'": "\\'", "\\": "\\\\", '"': '"', "/": "/", "\b": "\\b", "\t": "\\t", "\n": "\\n",
                 "\f": "\\f", "\r": "\\r", "\x00": "\\u0000", "\x0b": "\\u000b", "\x1f": "\\u001f",
                 "\x7f": "\x7f", "\x85": "\x85", " ": " ", "😀": "😀", "a'b\\c": "a\\'b\\\\c",
                 "é": "é"}
        for name, esc in cases.items():
            self.assertEqual(run("$.*", {name: 1})[1], ["$['%s']" % esc], repr(name))


class TestProperties(unittest.TestCase):
    def gen(self, rnd, depth=0):
        r = rnd.random()
        if depth >= 2 or r < 0.5:
            return rnd.choice([0, 1, 2, -1, 1.5, "a", "b", "ab", "", "é", "😀", True, False, None])
        if r < 0.75:
            return [self.gen(rnd, depth + 1) for _ in range(rnd.randint(0, 3))]
        keys = ["a", "b", "'", "a b", "\n", "😀", "10", "9", "\\", "x"]
        return {k: self.gen(rnd, depth + 1) for k in rnd.sample(keys, rnd.randint(0, 4))}

    def test_props(self):
        rnd = random.Random(1)
        pairs = [("$[?@.a]", "$[?!@.a]"), ("$[?@ > 1]", "$[?!(@ > 1)]"),
                 ("$[?@ == 'a' || @.b]", "$[?!(@ == 'a' || @.b)]"),
                 ("$[?length(@) == 1]", "$[?!(length(@) == 1)]"),
                 ("$[?match(@, 'a.*')]", "$[?!match(@, 'a.*')]"), ("$[?@[0]]", "$[?!@[0]]")]
        for _ in range(300):
            d = self.gen(rnd)
            a, b = run("$..[*]", d), run("$..[*, *]", d)
            self.assertEqual(len(b[0]), 2 * len(a[0]))
            for q in ["$..*", "$.*", "$..[0]", "$..[-1]", "$..['a']"]:
                vals, paths = run(q, d)
                if paths:
                    for i in (0, len(paths) - 1):
                        self.assertEqual(run(paths[i], d), ([vals[i]], [paths[i]]))
            p, n = rnd.choice(pairs)
            self.assertEqual(len(run(p, d)[0]) + len(run(n, d)[0]), len(run("$[*]", d)[0]))


class TestFolder(unittest.TestCase):
    def test_regen_json(self):
        with open(os.path.join(HERE, "REGEN.json")) as f:
            cfg = json.load(f)
        self.assertEqual(set(cfg), {"lang", "build", "test", "driver"})
        self.assertEqual(cfg["lang"], "py")
        self.assertIn("default", cfg["driver"])

    def test_size_and_deps(self):
        total = 0
        for name in os.listdir(HERE):
            self.assertNotIn(name, ("node_modules", "package-lock.json", "requirements.txt", "Pipfile", "poetry.lock"))
            if name.endswith(".py") and not name.startswith("test_"):
                with open(os.path.join(HERE, name), encoding="utf-8") as f:
                    total += sum(1 for l in f if l.strip())
        self.assertLessEqual(total, 3000)


if __name__ == "__main__":
    unittest.main()
