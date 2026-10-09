import json
import os
import subprocess
import sys
import unittest

import jp

HERE = os.path.dirname(os.path.abspath(__file__))
INV = "invalid_query"


def run(q, d):
    return jp.query(q, d)


class Base(unittest.TestCase):
    def vals(self, rows):
        for q, d, want in rows:
            with self.subTest(q=q, d=d):
                if want == INV:
                    with self.assertRaises(jp.QueryError):
                        run(q, d)
                else:
                    self.assertEqual(run(q, d)[0], want)

    def paths(self, rows):
        for q, d, want in rows:
            with self.subTest(q=q, d=d):
                self.assertEqual(run(q, d)[1], want)


class TestDriver(unittest.TestCase):
    def call(self, lines):
        p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")],
                           input=("\n".join(lines) + "\n").encode(),
                           capture_output=True, cwd=HERE, timeout=60)
        self.assertEqual(p.returncode, 0)
        return [json.loads(x) for x in p.stdout.decode().split("\n") if x]

    def test_rq001_errors(self):  # REQ-RQ-001
        ok = '{"id":"r1","op":"query","input":{"query":"$","document":1}}'
        out = self.call([
            "{not json", "[1]",
            '{"op":"query","input":{"query":"$","document":1}}',
            '{"id":7,"op":"query","input":{"query":"$","document":1}}',
            '{"id":"a","input":{"query":"$","document":1}}',
            '{"id":"b","op":"select","input":{"query":"$","document":1}}',
            '{"id":"c","op":"query"}',
            '{"id":"d","op":"query","input":[]}',
            '{"id":"e","op":"query","input":{"document":1}}',
            '{"id":"f","op":"query","input":{"query":5,"document":1}}',
            '{"id":"g","op":"query","input":{"query":"$"}}',
            '{"id":"h","op":"query","input":{"query":"$[","document":1}}',
            "   ", ok])
        self.assertEqual(out, [
            {"id": None, "error": "bad_request"}, {"id": None, "error": "bad_request"},
            {"id": None, "error": "bad_request"}, {"id": None, "error": "bad_request"},
            {"id": "a", "error": "unknown_op"}, {"id": "b", "error": "unknown_op"},
            {"id": "c", "error": "bad_request"}, {"id": "d", "error": "bad_request"},
            {"id": "e", "error": "bad_request"}, {"id": "f", "error": "bad_request"},
            {"id": "g", "error": "bad_request"}, {"id": "h", "error": "invalid_query"},
            {"id": "r1", "result": {"values": [1], "paths": ["$"]}}])

    def test_rq002_rq003_result(self):  # REQ-RQ-002, REQ-RQ-003
        out = self.call([
            '{"id":"1","op":"query","trace":true,"input":{"query":"$[0,0]","document":["a"],"x":1}}',
            '{"id":"2","op":"query","input":{"query":"$.x","document":{"k":"v"}}}',
            '{"id":"3","op":"query","input":{"query":"$","document":null}}'])
        self.assertEqual(out[0]["result"], {"values": ["a", "a"], "paths": ["$[0]", "$[0]"]})
        self.assertEqual(out[1]["result"], {"values": [], "paths": []})
        self.assertEqual(out[2]["result"], {"values": [None], "paths": ["$"]})
        self.assertEqual(set(out[0]), {"id", "result"})


class TestRequests(Base):
    def test_rq003_documents(self):
        self.vals([("$", None, [None]), ("$", False, [False]), ("$", "abc", ["abc"]),
                   ("$", [], [[]]), ("$.*", 1, []), ("$[0]", "abc", [])])

    def test_rq004_valid_never_errors(self):
        self.vals([("$.a.b.c[5]['x']", {"a": 1}, []), ("$[?@.a < 'b']", [1, [2], {"a": None}], []),
                   ("$..[?@[-1] == 1]", "text", []), ("$[", None, INV),
                   ("$[?length(@.*) < 3]", [], INV)])


class TestSyntax(Base):
    def test_sy001_root_blank(self):
        a = {"a": 1}
        self.vals([("$", a, [a]), ("$ .a", a, [1]), ("$\t.a", a, [1]), ("$\n['a']", a, [1]),
                   ("$\r\n.a \r\n.b", {"a": {"b": 2}}, [2]),
                   ("", 1, INV), (" $", 1, INV), ("$ ", 1, INV), ("$\n", 1, INV),
                   ("$.a ", a, INV), ("$\u000c.a", a, INV), ("$ .a", a, INV),
                   ("$ .a", a, INV), ("@", 1, INV), ("@.a", a, INV), ("$$", 1, INV),
                   ("a", 1, INV), ("$a", a, INV)])

    def test_sy002_dot(self):
        ok = ["a", "_", "_a1", "A", "é", "\u0080x", "😀", "a1b2", "true", "null", "Z", "z"]
        for n in ok:
            with self.subTest(n=n):
                self.assertEqual(run("$." + n, {n: 1})[0], [1])
        self.vals([("$..a", {"x": {"a": 1}}, [1]), ("$..*", {"a": [1]}, [[1], 1]),
                   ("$..['a']", {"a": 1}, [1]), ("$.a.b", {"a": {"b": 1}}, [1])])
        for bad in ["$.", "$..", "$...", "$...a", "$.1", "$.1a", "$.$", "$.-a", "$.a-b",
                    "$. a", "$.. a", "$.\ta", "$.'a'", "$.[0]", "$.\u007f", "$.a b",
                    "$.@a", "$.ˋa", "$.{a"]:
            with self.subTest(q=bad):
                with self.assertRaises(jp.QueryError):
                    run(bad, {"a": 1})

    def test_sy003_strings(self):
        good = [("$['a']", "a"), ('$["a"]', "a"), ("$['\\'']", "'"), ('$["\'"]', "'"),
                ("$['\"']", '"'), ('$["\\""]', '"'), ("$['\\\\']", "\\"), ("$['\\/']", "/"),
                ("$['/']", "/"), ("$['\\n']", "\n"), ("$['\\u000A']", "\n"),
                ("$['\\u000a']", "\n"), ("$['\\u00E9']", "é"), ("$['é']", "é"),
                ("$['\\uD83D\\uDE00']", "😀"), ("$['\\ud83d\\ude00']", "😀"),
                ("$['😀']", "😀"), ("$['\\u000b']", "\u000b"), ("$['\u007f']", "\u007f"),
                ("$['']", ""), ("$['\\b\\f\\r\\t']", "\b\f\r\t"),
                ("$['\\uD800\\uDC00']", "\U00010000"), ("$['\\uDBFF\\uDFFF']", "\U0010ffff"),
                ("$['\\uD7FF']", "퟿"), ("$['\\uE000']", ""), ("$['\\u002F']", "/")]
        for q, name in good:
            with self.subTest(q=q):
                self.assertEqual(run(q, {name: 5})[0], [5])
        bad = ["$['\\\"']", '$["\\\'"]', "$['\\q']", "$['\\x41']", "$['\\U0041']", "$['\\u004']",
               "$['\\uD83D']", "$['\\uDE00']", "$['\\uD83Dx']", "$['\\uD83D\\u0041']",
               "$['\\uDBFF']", "$['\\uDC00']", "$['\\uD800\\uDBFF']", "$['\n']", "$['\t']",
               "$['\u0000']", "$['\u001f']", "$['a", "$['a\"]", "$['a'", "$[a]", "$['a'b']"]
        for q in bad:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, {"a": 1})

    def test_sy004_index(self):
        self.vals([("$[1]", ["a", "b"], ["b"]), ("$[-1]", ["a", "b"], ["b"]),
                   ("$[ 1 ]", ["a", "b"], ["b"]), ("$[9007199254740991]", ["a"], []),
                   ("$[-9007199254740991]", ["a"], [])])
        for q in ["$[01]", "$[-0]", "$[+1]", "$[1.0]", "$[1e1]", "$[0x1]", "$[9007199254740992]",
                  "$[-9007199254740992]", "$[99999999999999999999]", "$[1 1]", "$[-]",
                  "$[- 1]", "$[]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, ["a"])

    def test_sy005_slice(self):
        abc = ["a", "b", "c"]
        self.vals([("$[:]", abc, abc), ("$[::]", abc, abc), ("$[1:]", abc, ["b", "c"]),
                   ("$[:2]", abc, ["a", "b"]), ("$[::2]", abc, ["a", "c"]),
                   ("$[ 1 : 2 : 1 ]", abc, ["b"]), ("$[1: :1]", abc, ["b", "c"]),
                   ("$[::-1]", abc, ["c", "b", "a"]), ("$[:9007199254740991]", abc, abc),
                   ("$[-9007199254740991:]", abc, abc)])
        for q in ["$[1:2:3:4]", "$[-0:]", "$[:-0]", "$[::-0]", "$[01:]", "$[:9007199254740992]",
                  "$[::9007199254740992]", "$[1.0:]", "$[1 2:]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, abc)

    def test_sy006_bracket(self):
        ab = {"a": 1, "b": 2}
        self.vals([("$['a','b']", ab, [1, 2]), ("$[ 'a' , 'b' ]", ab, [1, 2]),
                   ("$[\n'b',\t'a'\r]", ab, [2, 1]), ("$[*,'a']", ab, [1, 2, 1]),
                   ("$[?@ == 2, 'a']", ab, [2, 1])])
        for q in ["$[ ]", "$[,'a']", "$['a',]", "$['a',,'b']", "$['a''b']", "$['a' 'b']",
                  "$[['a']]", "$['a']]", "$[**]", "$[*a]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, ab)

    def test_sy007_filters(self):
        d = [1, 2, {"a": 1}]
        self.vals([("$[?@]", d, d), ("$[? @]", d, d), ("$[?@ ]", d, d), ("$[?(@)]", d, d),
                   ("$[?( @ )]", d, d), ("$[?!@.a]", d, [1, 2]), ("$[?! @.a]", d, [1, 2]),
                   ("$[?!(@.a)]", d, [1, 2]), ("$[?! ( @.a )]", d, [1, 2]),
                   ("$[?!(!@.a)]", d, [{"a": 1}]), ("$[?@ == 1]", d, [1]), ("$[?@==1]", d, [1]),
                   ("$[?1 == @]", d, [1]), ("$[?@ > 1 && @ < 3]", d, [2]),
                   ("$[?@ == 1 || @.a]", d, [1, {"a": 1}]), ("$[?1 == 1]", d, d)])
        for q in ["$[?]", "$[? ]", "$[?()]", "$[?true]", "$[?false]", "$[?null]", "$[?1]",
                  "$[?'a']", "$[?!@.a == 1]", "$[?!!@.a]", "$[?!1]", "$[?1 < 2 < 3]",
                  "$[?@ & @]", "$[?@ | @]", "$[?@ and @]", "$[?@ or @]", "$[?@ = 1]",
                  "$[?@ === 1]", "$[?@ <> 1]", "$[?@ =< 1]", "$[?@ => 1]", "$[?@ !== 1]",
                  "$[?(@]", "$[?@)]", "$[?@ == ]", "$[?== 1]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, [1])

    def test_sy008_literals(self):
        d = [0, 1, 100, -1.5, 0.001, True, None, "x"]
        self.vals([("$[?@ == -0]", d, [0]), ("$[?@ == 0.0]", d, [0]), ("$[?@ == -0.0]", d, [0]),
                   ("$[?@ == 1e2]", d, [100]), ("$[?@ == 1E2]", d, [100]),
                   ("$[?@ == 1e+2]", d, [100]), ("$[?@ == 100.0e0]", d, [100]),
                   ("$[?@ == -1.5]", d, [-1.5]), ("$[?@ == -15e-1]", d, [-1.5]),
                   ("$[?@ == 1e-3]", d, [0.001]), ("$[?@ == true]", d, [True]),
                   ("$[?@ == null]", d, [None]), ("$[?@ == 'x']", d, ["x"]),
                   ('$[?@ == "x"]', d, ["x"]), ("$[?@ == 9007199254740993]", ["a"], []),
                   ("$[?@ == 1e400]", ["a"], [])])
        for lit in ["01", "1.", ".5", "+1", "1e", "1e+", "0x10", "1_000", "Infinity", "NaN",
                    "True", "NULL", "nul", "-", "--1", "'x"]:
            with self.subTest(lit=lit):
                with self.assertRaises(jp.QueryError):
                    run("$[?@ == %s]" % lit, [1])

    def test_sy009_singular(self):
        d = [{"a": 1, "b": [5, 6]}]
        for q in ["$[?@.a == 1]", "$[?@['a'] == 1]", '$[?@["a"] == 1]', "$[?@.b[1] == 6]",
                  "$[?@.b[-1] == 6]", "$[?@ .b [0] == 5]", "$[?$[0].a == 1]", "$[?@ == $[0]]"]:
            with self.subTest(q=q):
                self.assertEqual(run(q, d)[0], d)
        for q in ["$[?@[ 'a'] == 1]", "$[?@['a' ] == 1]", "$[?@[ 0] == 1]", "$[?@.* == 1]",
                  "$[?@[*] == 1]", "$[?@[0,1] == 1]", "$[?@['a','b'] == 1]", "$[?@[0:1] == 1]",
                  "$[?@..a == 1]", "$[?@[?@] == 1]", "$[?1 == @..a]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, d)

    def test_sy010_functions(self):
        d = ["ab", [1, 2]]
        self.vals([("$[?length(@) == 2]", d, d), ("$[?length( @ ) == 2]", d, d),
                   ("$[?length(\n@\n) == 2]", d, d), ("$[?match(@ , 'a.')]", d, ["ab"]),
                   ("$[?search( @,'b' )]", d, ["ab"])])
        for q in ["$[?length (@) == 2]", "$[?Length(@) == 2]", "$[?LENGTH(@) == 2]",
                  "$[?len(@) == 2]", "$[?foo(@)]", "$[?constructor(@)]", "$[?length() == 2]",
                  "$[?length(@, @) == 2]", "$[?count() == 1]", "$[?match(@)]",
                  "$[?match(@, 'a', 'b')]", "$[?value() == 1]", "$[?length(@ == 2]",
                  "$[?length@ == 2]", "$[?_length(@) == 2]", "$[?length(@,) == 2]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, d)

    def test_sy011_types(self):
        d = [{"a": "x", "b": [1, 2]}]
        for q in ["$[?length(@.a) == 1]", "$[?length('abc') == 3]",
                  "$[?length(true) == length(1)]", "$[?length(count(@.*)) == length(1)]",
                  "$[?length(value(@.b)) == 2]", "$[?count(@.*) == 2]", "$[?count(@) == 1]",
                  "$[?count(@..*) == 4]", "$[?count($..*) == 5]", "$[?match(@.a, 'x')]",
                  "$[?match('x', @.a)]", "$[?search(@.a, @.a)]", "$[?value(@..a) == 'x']"]:
            with self.subTest(q=q):
                self.assertEqual(run(q, d)[0], d)
        self.vals([("$[?match(length(@.b), '2')]", d, []), ("$[?value(@.*) == 'x']", d, [])])
        for q in ["$[?length(@)]", "$[?count(@.*)]", "$[?value(@.a)]", "$[?!length(@)]",
                  "$[?match(@.a, 'x') == true]", "$[?search(@.a, 'x') != false]",
                  "$[?length(@.*) == 2]", "$[?length(@..a) == 1]", "$[?length(@[0,1]) == 1]",
                  "$[?length(match(@.a, 'x')) == 1]", "$[?length(@.a == 'x') == 1]",
                  "$[?length(!@.a) == 1]", "$[?count(1) == 1]", "$[?count('a') == 1]",
                  "$[?count(length(@)) == 1]", "$[?count(value(@.b)) == 1]",
                  "$[?count(@.a == 'x') == 1]", "$[?count((@.a)) == 1]", "$[?value(1) == 1]",
                  "$[?value(count(@.*)) == 2]", "$[?match(@.*, 'x')]", "$[?match(@.a, @.*)]",
                  "$[?match(@.a == 'x', 'x')]", "$[?length(@.a) == count(1)]"]:
            with self.subTest(q=q):
                with self.assertRaises(jp.QueryError):
                    run(q, d)


class TestSegments(Base):
    ABC = ["a", "b", "c", "d", "e", "f", "g"]
    D = {"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}

    def test_se001_root(self):
        self.assertEqual(run("$", [1, {"a": 2}]), ([[1, {"a": 2}]], ["$"]))

    def test_ev_rfc(self):
        d = {"'": {"@": 2}, "o": {"j j": {"k.k": 3}}}
        self.assertEqual(run("$.o['j j']['k.k']", d), ([3], ["$['o']['j j']['k.k']"]))
        self.assertEqual(run('$["\'"]["@"]', d), ([2], ["$['\\'']['@']"]))
        self.assertEqual(run("$.o[*]", {"a": [5, 3], "o": {"j": 1, "k": 2}}),
                         ([1, 2], ["$['o']['j']", "$['o']['k']"]))

    def test_se002_name(self):
        self.vals([("$.a", {"a": 1}, [1]), ("$.A", {"a": 1}, []), ("$['a']", ["a"], []),
                   ("$['0']", ["x"], []), ("$['0']", {"0": "x"}, ["x"]), ("$.a", "a", []),
                   ("$['é']", {"é": 1}, []), ("$['é']", {"é": 1, "é": 2}, [1]),
                   ("$['']", {"": 1}, [1]), ("$.constructor", {}, []),
                   ("$.toString", {"a": 1}, []), ("$.__proto__", {"__proto__": 1}, [1])])

    def test_se003_wildcard(self):
        self.vals([("$[*]", [3, 1, 2], [3, 1, 2]), ("$.*", {"b": 1, "a": 2}, [2, 1]),
                   ("$.*", 5, []), ("$.*", "ab", []), ("$[*]", [], []), ("$[*]", {}, []),
                   ("$.*.*", {"x": [1, 2], "y": {"z": 3}}, [1, 2, 3])])

    def test_se004_index(self):
        ab = ["a", "b"]
        self.vals([("$[0]", ab, ["a"]), ("$[-1]", ab, ["b"]), ("$[2]", ab, []),
                   ("$[-3]", ab, []), ("$[0]", {"0": "a"}, []), ("$[0]", "ab", []),
                   ("$[0][1]", [[1, 2]], [2])])
        self.paths([("$[-1]", ab, ["$[1]"])])

    def test_se005_slice(self):
        g = self.ABC
        rows = [("$[1:3]", "bc"), ("$[5:]", "fg"), ("$[:2]", "ab"), ("$[-2:]", "fg"),
                ("$[:-5]", "ab"), ("$[1:5:2]", "bd"), ("$[5:1:-2]", "fd"),
                ("$[::-1]", "gfedcba"), ("$[::3]", "adg"), ("$[::-3]", "gda"), ("$[1:1]", ""),
                ("$[3:1]", ""), ("$[3:1:-1]", "dc"), ("$[0:7:0]", ""), ("$[::0]", ""),
                ("$[10:]", ""), ("$[-10:2]", "ab"), ("$[:100]", "abcdefg"),
                ("$[-1:-10:-1]", "gfedcba"), ("$[6:-8:-2]", "geca"), ("$[:0]", ""),
                ("$[:-7]", ""), ("$[-10::-1]", ""), ("$[10::-1]", "gfedcba"),
                ("$[7:0:-1]", "gfedcb"),
                ("$[-9007199254740991:9007199254740991:9007199254740991]", "a")]
        self.vals([(q, g, list(w)) for q, w in rows])
        self.vals([("$[0:2]", {"0": 1, "1": 2}, []), ("$[:]", "abc", [])])
        self.paths([("$[5:1:-2]", g, ["$[5]", "$[3]"])])

    def test_se006_child(self):
        g = self.ABC
        self.vals([("$[0, 3]", g, ["a", "d"]), ("$[3, 0]", g, ["d", "a"]),
                   ("$[0:2, 5]", g, ["a", "b", "f"]), ("$[0, 0]", g, ["a", "a"]),
                   ("$[*, 0]", ["a", "b"], ["a", "b", "a"]), ("$['b', 'a']", {"a": 1, "b": 2}, [2, 1]),
                   ("$['a', 0]", {"a": 1}, [1]), ("$['a', 0]", [5], [5]),
                   ("$[*][0]", [[1, 2], [3], [], 4], [1, 3]),
                   ("$[1, 0][0]", [["a"], ["b"]], ["b", "a"])])

    def test_se007_descendant(self):
        d = self.D
        self.assertEqual(run("$..j", d), ([4, 1], ["$['a'][2][0]['j']", "$['o']['j']"]))
        self.assertEqual(run("$..[0]", d)[0], [5, {"j": 4}])
        self.assertEqual(run("$..*", d)[0], [d["a"], d["o"], 5, 3, d["a"][2], {"j": 4}, {"k": 6},
                                             4, 6, 1, 2])
        self.vals([("$..o", d, [d["o"]]), ("$.o..[*, *]", d, [1, 2, 1, 2]),
                   ("$..a", {"a": {"a": 1}}, [{"a": 1}, 1]), ("$..*", 1, []), ("$..*", [], []),
                   ("$..[*]", [[[1]]], [[[1]], [1], 1]),
                   ("$..['a','b']", {"b": {"a": 1}, "a": 2}, [2, {"a": 1}, 1]),
                   ("$..[?@ > 1]", [1, [2, 3]], [2, 3])])

    def test_se007_prop_double_selector(self):  # PROP-SE-P1
        for d in [{"a": [1, {"b": 2}], "c": 3}, [1, [2, [3]]], 5, {}]:
            self.assertEqual(len(run("$..[*, *]", d)[0]), 2 * len(run("$..[*]", d)[0]))

    def test_np_prop(self):  # PROP-NP-P1
        d = {"a": [1, {"b": "x", "a'": [None]}], "\n": {"\\": 2}, "😀": 3}
        for q in ["$..*", "$.*", "$..[*]", "$..[0]", "$..[-1]", "$..['a']"]:
            vals, paths = run(q, d)
            for v, p in zip(vals, paths):
                self.assertEqual(run(p, d), ([v], [p]))

    def test_se008_order(self):
        self.assertEqual(run("$.*", {"b": 1, "a": 2, "B": 3})[0], [3, 2, 1])
        self.assertEqual(run("$.*", {"10": 1, "9": 2, "1": 3})[0], [3, 1, 2])
        self.assertEqual(run("$.*", {"ab": 1, "a": 2, "": 3})[0], [3, 2, 1])
        self.assertEqual(run("$.*", {"😀": 1, "￿": 2, "é": 3, "z": 4})[0], [4, 3, 2, 1])
        self.assertEqual(run("$[?@ > 0]", {"b": 1, "a": 2})[0], [2, 1])
        self.assertEqual(run("$..*", {"b": {"y": 1, "x": 2}, "a": [3]})[0],
                         [[3], {"x": 2, "y": 1}, 3, 2, 1])

    def test_se009_null(self):
        self.vals([("$.a", {"a": None}, [None]), ("$[?@.a == null]", [{"a": None}, {}], [{"a": None}]),
                   ("$[?@.a]", [{"a": None}, {}], [{"a": None}]), ("$[*]", [None, None], [None, None])])


class TestFilters(Base):
    R = {"obj": {"x": "y"}, "arr": [2, 3]}
    BOTH = [[2, 3], {"x": "y"}]

    def check(self, rows):
        for q, want in rows:
            with self.subTest(q=q):
                self.assertEqual(run(q, self.R)[0], self.BOTH if want else [])

    def test_fi001(self):
        self.vals([("$[?@ > 1]", [1, 2, 3], [2, 3]), ("$[?@ > 1]", {"a": 1, "b": 2, "c": 3}, [2, 3]),
                   ("$[?@ > 1]", 5, []),
                   ("$[?@.x == $.x]", {"x": 1, "y": {"x": 1}, "z": {"x": 2}}, [{"x": 1}]),
                   ("$[?@[?@ == 1]]", [[1, 2], [3]], [[1, 2]]),
                   ("$..[?@.k]", {"k": 1, "a": [{"k": 2}]}, [{"k": 2}])])

    def test_fi_prop(self):  # PROP-FI-P1
        pairs = [("$[?@.a]", "$[?!@.a]"), ("$[?@ > 1]", "$[?!(@ > 1)]"),
                 ("$[?@ == 'a' || @.b]", "$[?!(@ == 'a' || @.b)]"),
                 ("$[?length(@) == 1]", "$[?!(length(@) == 1)]"),
                 ("$[?match(@, 'a.*')]", "$[?!match(@, 'a.*')]"), ("$[?@[0]]", "$[?!@[0]]")]
        for d in [[1, "a", "ab", [1], {"a": 1}, None], {"a": 1, "b": {"b": 2}}, 3]:
            for p, n in pairs:
                self.assertEqual(len(run(p, d)[0]) + len(run(n, d)[0]), len(run("$[*]", d)[0]))

    def test_fi002_existence(self):
        self.vals([("$[?@.a]", [{"a": None}, {"a": False}, {"b": 1}, 1], [{"a": None}, {"a": False}]),
                   ("$[?!@.a]", [{"a": None}, {"a": False}, {"b": 1}, 1], [{"b": 1}, 1]),
                   ("$[?@.*]", [[], [0], {}, {"a": 0}, "ab"], [[0], {"a": 0}]),
                   ("$[?@..x]", [{"y": {"x": None}}, {"y": 1}], [{"y": {"x": None}}]),
                   ("$[?$.flag]", {"flag": False, "a": 1}, [1, False]),
                   ("$[?@]", [None, False, 0], [None, False, 0]),
                   ("$[?@.a == false]", [{"a": None}, {"a": False}], [{"a": False}])])

    def test_fi003_nothing(self):
        self.check([("$[?$.absent1 == $.absent2]", 1), ("$[?$.absent1 <= $.absent2]", 1),
                    ("$[?$.absent == 'g']", 0), ("$[?$.absent1 != $.absent2]", 0),
                    ("$[?$.absent != 'g']", 1), ("$[?$.absent < 'g']", 0),
                    ("$[?$.absent >= 'g']", 0), ("$[?$.absent == null]", 0),
                    ("$[?$.absent == length(1)]", 1), ("$[?length(1) == length(true)]", 1),
                    ("$[?length(1) < length(2)]", 0)])

    def test_fi004_equality(self):
        self.check([("$[?13 == '13']", 0), ("$[?$.obj == $.arr]", 0), ("$[?$.obj != $.arr]", 1),
                    ("$[?$.obj == $.obj]", 1), ("$[?$.obj != $.obj]", 0),
                    ("$[?$.arr == $.arr]", 1), ("$[?$.arr != $.arr]", 0), ("$[?$.obj == 17]", 0),
                    ("$[?$.obj != 17]", 1)])
        self.vals([("$[?@ == 1]", [1, 1.0, 1e0, "1", True, [1], {"a": 1}], [1, 1.0, 1.0]),
                   ("$[?@ == 0]", [0, -0, False, None, "0", 0.0], [0, 0, 0.0]),
                   ("$[?@ == false]", [False, 0, None, ""], [False]),
                   ("$[?@ == null]", [None, False, 0, ""], [None]),
                   ("$[?@ == 'é']", ["é", "é"], ["é"]),
                   ("$[?@ == $.x]", {"x": [1, {"a": 2}], "y": [1, {"a": 2}], "z": [{"a": 2}, 1]},
                    [[1, {"a": 2}]] * 2),
                   ("$[?@ == $.x]", {"x": {"a": 1, "b": [True]}, "y": {"b": [True], "a": 1},
                                     "z": {"a": 1}}, [{"a": 1, "b": [True]}] * 2),
                   ("$[?@ == $.x]", {"x": {}, "y": 0, "z": "", "w": []}, [{}]),
                   ("$[?@ == $.x]", {"x": [], "y": 0, "z": "", "w": {}}, [[]])])

    def test_fi005_lt(self):
        self.check([("$[?1 < 2]", 1), ("$[?2 < 1]", 0), ("$[?-1 < 0]", 1), ("$[?1.5 < 2]", 1),
                    ("$[?1e1 < 9]", 0), ("$[?'a' < 'b']", 1), ("$[?'' < 'a']", 1),
                    ("$[?'a' < 'ab']", 1), ("$[?'ab' < 'b']", 1), ("$[?'B' < 'a']", 1),
                    ("$[?'z' < 'é']", 1), ("$[?'￿' < '😀']", 1), ("$[?'😀' < '￿']", 0),
                    ("$[?1 < '2']", 0), ("$[?'1' < 2]", 0), ("$[?false < true]", 0),
                    ("$[?null < 1]", 0), ("$[?$.arr < $.arr]", 0), ("$[?$.obj < $.arr]", 0),
                    ("$[?1 < $.arr]", 0)])
        self.assertEqual(run("$[?@ < 'b']", ["a", "B", "b", "ba", "", "é", 1])[1],
                         ["$[0]", "$[1]", "$[4]"])

    def test_fi006_others(self):
        self.check([("$[?1 <= 2]", 1), ("$[?1 > 2]", 0), ("$[?'a' <= 'b']", 1),
                    ("$[?'a' > 'b']", 0), ("$[?$.obj <= $.arr]", 0), ("$[?$.obj <= $.obj]", 1),
                    ("$[?$.arr <= $.arr]", 1), ("$[?1 <= $.arr]", 0), ("$[?1 >= $.arr]", 0),
                    ("$[?1 > $.arr]", 0), ("$[?true <= true]", 1), ("$[?true > true]", 0),
                    ("$[?true >= true]", 1), ("$[?null <= null]", 1), ("$[?1 != '1']", 1),
                    ("$[?2 >= 1]", 1), ("$[?1 >= 1.0]", 1), ("$[?'b' > 'a']", 1)])

    def test_fi007_logic(self):
        d = [1, 2, 3, 4]
        self.vals([("$[?@ < 2 || @ > 3]", d, [1, 4]), ("$[?@ > 1 && @ < 4]", d, [2, 3]),
                   ("$[?@ == 1 || @ == 2 && @ == 3]", d, [1]),
                   ("$[?(@ == 1 || @ == 2) && @ == 2]", d, [2]),
                   ("$[?!(@ == 1 || @ == 2)]", d, [3, 4]),
                   ("$[?!(@ == 1) && !(@ == 4)]", d, [2, 3]),
                   ("$[?@ > 0 && @ < 10 && @ != 3]", d, [1, 2, 4]),
                   ("$[?@ == 4 || @ == 3 || @ == 9]", d, [3, 4]),
                   ("$[?@==1||@==2]", d, [1, 2]), ("$[?@>1&&@<4]", d, [2, 3])])


class TestFunctions(Base):
    def test_fn001_length(self):
        d = ["a", "😀", "é", "é", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, True, None]
        self.vals([("$[?length(@) == 1]", d, ["a", "😀", "é"]),
                   ("$[?length(@) == 2]", d, ["é".replace("é", "é"), [1, [2, 3]], {"a": 1, "b": 2}]),
                   ("$[?length(@) == 0]", d, [""]),
                   ("$[?length(@) == length(@.x)]", d, [1, True, None]),
                   ("$[?length(@.x) == 0]", d, []), ("$[?length('😀😀') == 2]", [7], [7])])

    def test_fn002_count(self):
        d = [[1, 2], [3], [], {"a": 1, "b": 2}, 5]
        self.vals([("$[?count(@.*) == 2]", d, [[1, 2], {"a": 1, "b": 2}]),
                   ("$[?count(@.*) == 0]", d, [[], 5]), ("$[?count(@) == 1]", d, d),
                   ("$[?count(@[0, 0]) == 2]", d, [[1, 2], [3]]),
                   ("$[?count(@..*) == 2]", d, [[1, 2], {"a": 1, "b": 2}]),
                   ("$[?count($[*]) == 5]", d, d)])

    def test_fn003_value(self):
        d = [{"c": "red"}, {"a": {"c": "red"}}, {"c": "red", "d": {"c": "blue"}}, {}]
        self.vals([("$[?value(@..c) == 'red']", d, d[:2]), ("$[?value(@.*) == 'red']", d, d[:1]),
                   ("$[?value(@.x) == value(@.y)]", d, d),
                   ("$[?value(@..c) != 'red']", d, d[2:])])

    def test_fn004_match(self):
        d = ["abc", "abcd", "xabc", "ab\nc", 1, None]
        self.vals([("$[?match(@, 'a.c')]", d, ["abc"]), ("$[?match(@, 'a.*')]", d, ["abc", "abcd"]),
                   ("$[?match(@, '[')]", d, []), ("$[?!match(@, '[')]", d, d),
                   ("$[?match(@, 1)]", d, []), ("$[?match(1, '1')]", d, []),
                   ("$[?match(@.x, '.*')]", d, []),
                   ("$[?match(@, 'abc|xabc')]", d, ["abc", "xabc"]),
                   ("$[?match(@.date, '1974-05-..')]",
                    [{"date": "1974-05-01"}, {"date": "1974-05-1"}], [{"date": "1974-05-01"}])])

    def test_fn005_search(self):
        d = ["abc", "xyz", "", "a\nb", "x^ay", 1]
        self.vals([("$[?search(@, 'b')]", d, ["abc", "a\nb"]), ("$[?search(@, '^a')]", d, ["x^ay"]),
                   ("$[?search(@, '')]", d, d[:5]), ("$[?search(@, 'a.b')]", d, []),
                   ("$[?search(@, 'b|z')]", d, ["abc", "xyz", "a\nb"]),
                   ("$[?search(@, '[')]", d, [])])


def rxq(pattern, subject, fn="match"):
    return len(jp.query("$[?%s(@, %s)]" % (fn, json.dumps(pattern)), [subject])[0]) == 1


class TestRegex(unittest.TestCase):
    def cases(self, rows, fn="match"):
        for pat, subj, want in rows:
            with self.subTest(pat=pat, subj=subj):
                self.assertEqual(rxq(pat, subj, fn), want)

    def test_rx001_grammar(self):
        self.cases([("a", "a", True), ("", "", True), ("a|", "", True), ("()", "", True),
                    ("(a|b)c", "bc", True), (",-/>@Z^z~", ",-/>@Z^z~", True), ("'", "'", True),
                    ("\\d", "1", False), ("\\w", "a", False), ("\\s", " ", False),
                    ("a*?", "a", False), ("(?:a)", "a", False), ("a]", "a]", False),
                    ("a\\]", "a]", True), ("a{", "a{", False), ("a}", "a}", False),
                    ("[]", "]", False), ("[^]", "^", False), ("*a", "a", False),
                    ("a**", "aa", False), ("(a", "(a", False), ("a)", "a)", False),
                    ("\\", "\\", False), ("\\1", "1", False)])

    def test_rx002_matching(self):
        self.cases([(".", "\n", False), (".", "\r", False), (".", " ", True),
                    (".", "\u0085", True), (".", "😀", True), ("..", "😀", False),
                    ("^a", "^a", True), ("^a", "a", False), ("a$", "a$", True), ("a", "A", False),
                    ("a|bc", "abc", False), ("a|bc", "bc", True)])
        self.cases([("b", "abc", True), ("b", "B", False), ("a|bc", "xbcx", True),
                    ("^a", "x^ay", True), ("", "", True), ("a.b", "a\nb", False)], "search")

    def test_rx003_classes(self):
        self.cases([("[a-c]+", "abc", True), ("[a-c]+", "abd", False), ("[^a]", "\n", True),
                    ("[^a]", "a", False), ("[-a]", "-", True), ("[a-]", "-", True),
                    ("[^-]", "-", False), ("[a^]", "^", True), ("[.]", ".", True),
                    ("[.]", "a", False), ("[$]", "$", True), ("[\\]]", "]", True),
                    ("[\\\\]", "\\", True), ("[\\-a]", "-", True), ("[a-c-e]", "-", False),
                    ("[\\n]", "\n", True), ("[\\n]", "n", False), ("[😀-😂]", "😁", True),
                    ("[a", "a", False), ("[\\P{L}]", "1", True), ("[\\P{L}]", "a", False),
                    ("[,.Z^]+", ",.Z^", True)])

    def test_rx004_categories(self):
        self.cases([("\\p{Lu}", "É", True), ("\\p{Lu}", "a", False), ("\\p{Lt}", "ǅ", True),
                    ("\\p{L}+", "日本", True), ("\\p{L}+", "ab1", False),
                    ("\\p{Nd}+", "١٢٣", True), ("\\p{N}", "Ⅻ", True), ("\\p{N}", "a", False),
                    ("\\P{L}", "😀", True), ("\\P{L}", "a", False), ("\\p{So}", "😀", True),
                    ("\\p{Zs}", " ", True), ("\\p{Zs}", "\t", False),
                    ("\\p{Cc}", "\u0085", True), ("[\\p{Lu}0-9]+", "A1", True),
                    ("[\\p{Lu}0-9]+", "a1", False), ("[^\\p{L}]", "1", True),
                    ("\\p{IsBasicLatin}", "a", False), ("\\p{Greek}", "α", False),
                    ("\\p{lu}", "A", False), ("\\p{Cs}", "a", False), ("\\p{Lu", "A", False),
                    ("\\pL", "A", False), ("\\p{C}", "\x00", True), ("\\p{Cn}", "\U000e0080", True)])

    def test_rx005_escapes(self):
        self.cases([("a\\.b", "a.b", True), ("a\\.b", "axb", False), ("\\-", "-", True),
                    ("\\^", "^", True), ("\\{", "{", True), ("\\t", "\t", True),
                    ("\\t", "t", False), ("\\n", "\n", True), ("\\\\", "\\", True),
                    ("\\$", "$", False), ("\\/", "/", False), ("\\u0041", "A", False),
                    ("\\b", "b", False), ("\\x41", "A", False)])

    def test_rx006_quantifiers(self):
        self.cases([("a{2}", "aa", True), ("a{2}", "aaa", False), ("a{2,}", "aaa", True),
                    ("a{2,}", "a", False), ("a{1,2}", "aa", True), ("a{1,2}", "aaa", False),
                    ("a{0}", "", True), ("a{0}", "a", False), ("a{02}", "aa", True),
                    ("(ab)*", "abab", True), ("(ab)*", "aba", False), ("(ab)*", "", True),
                    ("[ab]+", "abba", True), ("a?b", "b", True), ("a?b", "aab", False),
                    ("a{,2}", "a", False), ("a{2}{3}", "aaaaaa", False), ("a+?", "a", False),
                    ("{2}", "", False), ("a{x}", "a", False), ("a{2", "aa", False),
                    ("(a*)*b", "a" * 40, False)])


class TestPaths(Base):
    def test_np001(self):
        self.paths([("$.a", {"a": 1}, ["$['a']"]), ("$[1]", [0, 1], ["$[1]"]),
                    ("$[-3]", [0, 1, 2, 3, 4], ["$[2]"]),
                    ("$.a.b[1:2]", {"a": {"b": [0, 1, 2]}}, ["$['a']['b'][1]"]),
                    ('$["\\u000B"]', {"\u000b": 1}, ["$['\\u000b']"]),
                    ('$["\\u0061"]', {"a": 1}, ["$['a']"]), ("$[10]", list(range(11)), ["$[10]"]),
                    ("$..x", {"x": {"x": 1}}, ["$['x']", "$['x']['x']"])])

    def test_np002_names(self):
        for name, want in [("'", "\\'"), ("\\", "\\\\"), ('"', '"'), ("/", "/"), ("\b", "\\b"),
                           ("\t", "\\t"), ("\n", "\\n"), ("\f", "\\f"), ("\r", "\\r"),
                           ("\u0000", "\\u0000"), ("\u000b", "\\u000b"), ("\u001f", "\\u001f"),
                           ("\u007f", "\u007f"), ("\u0085", "\u0085"), (" ", " "),
                           ("😀", "😀"), ("a'b\\c", "a\\'b\\\\c"), ("é", "é")]:
            with self.subTest(name=name):
                self.assertEqual(run("$.*", {name: 1})[1], ["$['%s']" % want])


class TestFolder(unittest.TestCase):
    def test_bu001_regen_json(self):
        with open(os.path.join(HERE, "REGEN.json"), encoding="utf8") as f:
            cfg = json.load(f)
        self.assertEqual(set(cfg), {"lang", "build", "test", "driver"})
        self.assertEqual(cfg["lang"], "py")
        for k in ("build", "test", "driver"):
            self.assertIsInstance(cfg[k], (str, dict))
        self.assertNotIn("  ", cfg["driver"]["default"])

    def test_bu002_has_tests(self):
        self.assertTrue(os.path.exists(__file__))

    def test_bu003_no_deps(self):
        for name in ("node_modules", "package-lock.json", "requirements.txt", "Pipfile",
                     "poetry.lock", "package.json"):
            self.assertFalse(os.path.exists(os.path.join(HERE, name)))

    def test_bu004_size(self):
        total = 0
        for name in os.listdir(HERE):
            if name.endswith(".py") and not name.startswith("test_"):
                with open(os.path.join(HERE, name), encoding="utf8") as f:
                    total += sum(1 for line in f if line.strip())
        self.assertLessEqual(total, 3000)


if __name__ == "__main__":
    unittest.main()
