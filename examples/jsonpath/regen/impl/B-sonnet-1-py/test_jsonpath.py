import json
import os
import subprocess
import sys
import unittest
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import driver  # noqa: E402
from jsonpath import QueryError, query  # noqa: E402


def J(s):
    return json.loads(s, parse_float=Decimal)


class Base(unittest.TestCase):
    def ok(self, q, doc, values, paths):
        v, p = query(q, J(doc) if isinstance(doc, str) else doc)
        self.assertEqual(json.loads(driver.render(v)), json.loads(values), q)
        self.assertEqual(p, json.loads(paths), q)

    def bad(self, *qs):
        for q in qs:
            with self.assertRaises(QueryError, msg=repr(q)):
                query(q, None)

    def none(self, q, doc):
        self.ok(q, doc, "[]", "[]")

    def ids(self, q, doc, idxs):
        v, p = query(q, J(doc))
        self.assertEqual(p, ["$[%d]" % i for i in idxs], q)


class TestProtocol(unittest.TestCase):
    def h(self, line):
        return driver.handle(line.encode() if isinstance(line, str) else line)

    def test_r1_basic(self):
        self.assertEqual(self.h('{"id":"r1","op":"query","input":{"query":"$.a","document":{"a":1}}}'),
                         '{"id":"r1","result":{"values":[1],"paths":["$[\'a\']"]}}')
        self.assertEqual(self.h('{"id":"r2","op":"query","input":{"query":"$","document":null}}'),
                         '{"id":"r2","result":{"values":[null],"paths":["$"]}}')

    def test_r1_errors(self):
        cases = [
            ('{"id":"r3","op":"query","input":{"query":"$"}}', '{"id":"r3","error":"bad_request"}'),
            ('{"id":"r4","op":"evaluate","input":{"query":"$","document":1}}', '{"id":"r4","error":"unknown_op"}'),
            ('{"id":"r5"}', '{"id":"r5","error":"unknown_op"}'),
            ('{"id":"r6","op":"nope","input":{"query":"$[","document":1}}', '{"id":"r6","error":"unknown_op"}'),
            ('{"id":"r6","op":5}', '{"id":"r6","error":"unknown_op"}'),
            ('hello', '{"id":null,"error":"bad_request"}'),
            ('[1,2]', '{"id":null,"error":"bad_request"}'),
            ('{"id":7,"op":"query","input":{"query":"$","document":1}}', '{"id":null,"error":"bad_request"}'),
            ('{"id":"r8","op":"query","input":{"query":42,"document":1}}', '{"id":"r8","error":"bad_request"}'),
            ('{"id":"r9","op":"query","input":"$"}', '{"id":"r9","error":"bad_request"}'),
            ('{"id":"r10","op":"query","input":{"query":"$[","document":{}}}', '{"id":"r10","error":"invalid_query"}'),
            ('{"id":"r11","op":"query","input":{"query":"$.a","document":1,"extra":true},"x":0}',
             '{"id":"r11","result":{"values":[],"paths":[]}}'),
            ('\x0c', '{"id":null,"error":"bad_request"}'),
            ('{"id":"q","op":"query","input":{"query":"$\\ud800","document":1}}', '{"id":"q","error":"invalid_query"}'),
        ]
        for line, want in cases:
            self.assertEqual(self.h(line), want, line)
        self.assertEqual(self.h(b'\xff\xfe'), '{"id":null,"error":"bad_request"}')

    def test_r1_blank_and_cr(self):
        for line in ("", "  \t ", "\r", " \r"):
            self.assertIsNone(self.h(line))
        self.assertEqual(self.h('{"id":"r12","op":"query","input":{"query":"$","document":0}}\r'),
                         '{"id":"r12","result":{"values":[0],"paths":["$"]}}')

    def test_r1_falsy_documents(self):
        for d in ("null", "false", "0", '""', "[]", "{}"):
            r = json.loads(self.h('{"id":"x","op":"query","input":{"query":"$","document":%s}}' % d))
            self.assertEqual(r["result"]["paths"], ["$"])

    def test_r1_subprocess(self):
        inp = ('\n  \t\n{"id":"a","op":"query","input":{"query":"$","document":1}}\r\n'
               '{"id":"b","op":"query","input":{"query":"$x","document":1}}\n')
        p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], input=inp.encode(),
                           capture_output=True, cwd=HERE)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout, b'{"id":"a","result":{"values":[1],"paths":["$"]}}\n'
                                   b'{"id":"b","error":"invalid_query"}\n')

    def test_r31_numbers_preserved(self):
        line = '{"id":"n","op":"query","input":{"query":"$[*]","document":[12345678901234567890,1.5e3,0.1,1e400]}}'
        r = json.loads(self.h(line), parse_float=Decimal)
        self.assertEqual(r["result"]["values"], [12345678901234567890, Decimal("1500"), Decimal("0.1"), Decimal("1e400")])

    def test_output_ascii_lone_surrogate_doc(self):
        out = self.h('{"id":"s","op":"query","input":{"query":"$","document":"\\ud800"}}')
        out.encode("utf-8")


class TestGeneral(Base):
    def test_r2_blank_space(self):
        self.bad("", " $", "$ ", "$\x0c.a", "$['a' ]", "$. a", "$.. a")
        self.ok("$ .a", '{"a":1}', "[1]", '["$[\'a\']"]')
        self.ok("$ ['a'] ['b']", '{"a":{"b":2}}', "[2]", '["$[\'a\'][\'b\']"]')
        self.ok("$\n.a", '{"a":1}', "[1]", '["$[\'a\']"]')
        self.ok("$\t['a']", '{"a":1}', "[1]", '["$[\'a\']"]')
        self.ok("$ ..a", '{"a":1}', "[1]", '["$[\'a\']"]')
        self.ok("$[ 'a' , 'b' ]", '{"a":1,"b":2}', "[1,2]", '["$[\'a\']","$[\'b\']"]')
        self.bad("$['\ud800']")
        self.ok("$['\U0001F600']", {"\U0001F600": 1}, "[1]", '["$[\'\U0001F600\']"]')

    def test_r3_root(self):
        self.ok("$", '{"k":"v"}', '[{"k":"v"}]', '["$"]')
        self.ok("$", "42", "[42]", '["$"]')
        self.bad("@", "@.a", "a", "$$", "$a")
        self.ok("$.a[*].b", '{"a":[{"b":0},{"b":1},{"c":2}]}', "[0,1]", '["$[\'a\'][0][\'b\']","$[\'a\'][1][\'b\']"]')
        self.ok("$[0,0][0]", "[[7]]", "[7,7]", '["$[0][0]","$[0][0]"]')
        self.none("$.x[0]", '{"y":[1]}')

    def test_r4_child(self):
        self.ok("$['b','a','b']", '{"a":1,"b":2}', "[2,1,2]", '["$[\'b\']","$[\'a\']","$[\'b\']"]')
        self.ok("$[0:2, 5]", '["a","b","c","d","e","f","g"]', '["a","b","f"]', '["$[0]","$[1]","$[5]"]')
        self.ok("$[0, 'a', 1:3, *]", '["x","y","z"]', '["x","y","z","x","y","z"]',
                '["$[0]","$[1]","$[2]","$[0]","$[1]","$[2]"]')
        self.ok("$[?@ > 1, 0]", "[1,2,3]", "[2,3,1]", '["$[1]","$[2]","$[0]"]')
        self.ok("$.*", '{"a":1,"b":[2]}', "[1,[2]]", '["$[\'a\']","$[\'b\']"]')
        self.bad("$[]", "$['a',]", "$[,'a']", "$['a',,'b']", "$['a'", "$['a']]", "$.", "$.['a']", "$.**", "$[**]")

    def test_r5_shorthand(self):
        self.ok("$._foo1", '{"_foo1":"x"}', '["x"]', '["$[\'_foo1\']"]')
        self.ok("$.ü", '{"ü":1}', "[1]", '["$[\'ü\']"]')
        self.ok("$.日本", '{"日本":2}', "[2]", '["$[\'日本\']"]')
        self.ok("$.a😀", {"a😀": 3}, "[3]", '["$[\'a😀\']"]')
        self.ok("$.null", '{"null":1}', "[1]", '["$[\'null\']"]')
        self.ok("$.foo.bar", '{"foo.bar":1,"foo":{"bar":2}}', "[2]", '["$[\'foo\'][\'bar\']"]')
        self.bad("$.1", "$.a-b", "$.a b", "$.$a", "$.'a'", "$.\\u0061", "$.a\x7f")

    def test_r6_descendant(self):
        d = '{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}'
        self.ok("$..j", d, "[1,4]", '["$[\'o\'][\'j\']","$[\'a\'][2][0][\'j\']"]')
        self.ok("$..[0]", d, '[5,{"j":4}]', '["$[\'a\'][0]","$[\'a\'][2][0]"]')
        v, p = query("$..*", J(d))
        self.assertEqual(len(v), 11)
        self.assertEqual(p[:4], ["$['o']", "$['a']", "$['o']['j']", "$['o']['k']"])
        self.assertEqual(query("$..[*]", J(d)), (v, p))
        self.ok("$.o..[*, *]", d, "[1,2,1,2]", '["$[\'o\'][\'j\']","$[\'o\'][\'k\']","$[\'o\'][\'j\']","$[\'o\'][\'k\']"]')
        self.ok("$..['j','k']", d, "[1,2,4,6]",
                '["$[\'o\'][\'j\']","$[\'o\'][\'k\']","$[\'a\'][2][0][\'j\']","$[\'a\'][2][1][\'k\']"]')
        self.ok("$..a", '{"a":{"a":1}}', '[{"a":1},1]', '["$[\'a\']","$[\'a\'][\'a\']"]')
        self.ok("$..[?@ > 1]", '{"x":[1,2,{"y":3}],"z":5}', "[5,2,3]", '["$[\'z\']","$[\'x\'][1]","$[\'x\'][2][\'y\']"]')
        self.none("$..*", "5")
        self.none("$..*", "[]")
        self.ok("$..[1]", "[[0,1],2]", "[2,1]", '["$[1]","$[0][1]"]')
        self.bad("$..", "$...a", "$..1")

    def test_r7_strings(self):
        self.ok('$["a"]', '{"a":1}', "[1]", '["$[\'a\']"]')
        self.ok("$['\\u0061']", '{"a":1}', "[1]", '["$[\'a\']"]')
        self.ok('$["\\u00E9"]', '{"é":1}', "[1]", '["$[\'é\']"]')
        self.ok('$["\\uD83D\\uDE00"]', {"😀": 1}, "[1]", '["$[\'😀\']"]')
        self.ok("$['\\t']", {"\t": 1}, "[1]", '["$[\'\\\\t\']"]')
        self.ok("$['a\\/b']", {"a/b": 1}, "[1]", '["$[\'a/b\']"]')
        self.ok("$['a\\\\b']", {"a\\b": 1}, "[1]", '["$[\'a\\\\\\\\b\']"]')
        self.ok('$["a\'b"]', {"a'b": 1}, "[1]", '["$[\'a\\\\\'b\']"]')
        self.ok("$['a\\'b']", {"a'b": 1}, "[1]", '["$[\'a\\\\\'b\']"]')
        self.ok("$['a\"b']", {'a"b': 1}, "[1]", '["$[\'a\\"b\']"]')
        self.ok('$["a\\"b"]', {'a"b': 1}, "[1]", '["$[\'a\\"b\']"]')
        self.ok("$['']", {"": 1}, "[1]", '["$[\'\']"]')
        self.bad('$["\\\'"]', "$['\\\"']", "$['\\a']", "$['\\U0061']", "$['\\u006']", "$['\\uD800']",
                 "$['\\uDC00']", "$['\\uD800\\u0041']", "$['\\uD800x']", "$['a\tb']", "$['a\nb']",
                 "$['abc", "$['a''b']", "$[a]", "$['\\x41']", "$['\\0']", "$['\\u00g1']")

    def test_r8_name(self):
        d = '{"o":{"j j":{"k.k":3}},"\'":{"@":2}}'
        self.ok("$.o['j j']['k.k']", d, "[3]", '["$[\'o\'][\'j j\'][\'k.k\']"]')
        self.ok('$["\'"]["@"]', d, "[2]", '["$[\'\\\\\'\'][\'@\']"]')
        self.none("$['O']", d)
        self.none("$['0']", '["x"]')
        self.none("$['a']", '"a"')
        self.none("$['é']", {"é": 1})

    def test_r9_wildcard(self):
        d = '{"o":{"j":1,"k":2},"a":[5,3]}'
        self.ok("$.o[*, *]", d, "[1,2,1,2]", '["$[\'o\'][\'j\']","$[\'o\'][\'k\']","$[\'o\'][\'j\']","$[\'o\'][\'k\']"]')
        self.ok("$.a.*", d, "[5,3]", '["$[\'a\'][0]","$[\'a\'][1]"]')
        for doc in ('"abc"', "{}", "[]"):
            self.none("$[*]", doc)

    def test_r10_index(self):
        d = '["a","b"]'
        self.ok("$[1]", d, '["b"]', '["$[1]"]')
        self.ok("$[-2]", d, '["a"]', '["$[0]"]')
        self.ok("$[ 1 ]", d, '["b"]', '["$[1]"]')
        self.none("$[2]", d)
        self.none("$[-3]", d)
        self.none("$[0]", '{"0":1}')
        self.none("$[0]", '"abc"')
        self.none("$[9007199254740991]", d)
        self.none("$[-9007199254740991]", d)
        self.bad("$[01]", "$[-0]", "$[+1]", "$[1.0]", "$[1e2]", "$[- 1]", "$[0x1]", "$.0")

    def test_r11_slice(self):
        d = '["a","b","c","d","e","f","g"]'
        cases = {
            "$[1:3]": [1, 2], "$[5:]": [5, 6], "$[1:5:2]": [1, 3], "$[5:1:-2]": [5, 3],
            "$[::-1]": [6, 5, 4, 3, 2, 1, 0], "$[:]": list(range(7)), "$[::]": list(range(7)),
            "$[1:2:]": [1], "$[::2]": [0, 2, 4, 6], "$[-2:]": [5, 6], "$[:-2]": [0, 1, 2, 3, 4],
            "$[-1:-3:-1]": [6, 5], "$[3::-1]": [3, 2, 1, 0], "$[:2:-1]": [6, 5, 4, 3],
            "$[2:-10:-1]": [2, 1, 0], "$[-10:2]": [0, 1], "$[0:0]": [], "$[3:1]": [], "$[::0]": [],
            "$[10:20]": [], "$[1 : 2 : 1]": [1], "$[::9007199254740991]": [0],
            "$[::-9007199254740991]": [6],
            "$[-9007199254740991:9007199254740991]": list(range(7)),
        }
        for q, idx in cases.items():
            self.ids(q, d, idx)
        self.none("$[1:3]", '{"a":1}')
        self.none("$[1:3]", '"abcdef"')
        self.bad("$[1:2:3:4]", "$[:-0]", "$[01:2]", "$[1:2:0.5]")

    def test_r12_range(self):
        self.bad("$[9007199254740992]", "$[-9007199254740992]", "$[0:9007199254740992]",
                 "$[-9007199254740992:]", "$[::-9007199254740992]", "$[99999999999999999999999]",
                 "$[?@[9007199254740992]]")
        self.none("$[?@ == 9007199254740992]", "[1]")


class TestFilters(Base):
    D = '[{"a":1,"b":2},{"a":2},{"b":3}]'

    def test_r13_syntax_valid(self):
        d = self.D
        for q in ("$[?@.a]", "$[? @.a ]", "$[?(@.a)]", "$[?((@.a))]", "$[?@.a\n&&\n@.a]"):
            self.ids(q, d, [0, 1])
        self.ids("$[?@.a==1]", d, [0])
        self.ids("$[?@.a   ==   1]", d, [0])
        self.ids("$[?1 == @.a]", d, [0])
        self.ids("$[?!@.a]", d, [2])
        self.ids("$[?! @.a]", d, [2])
        self.ids("$[?!(@.a == 1)]", d, [1, 2])
        self.ids("$[?!(!@.a)]", d, [0, 1])
        self.ids("$[?@.a&&@.b]", d, [0])
        self.ids("$[?@.a == 2 || @.b == 3]", d, [1, 2])
        self.ids("$[?@.a\n==\n1]", d, [0])
        self.ok("$[?@.a].b", d, "[2]", '["$[0][\'b\']"]')

    def test_r13_syntax_invalid(self):
        self.bad("$[?]", "$[@.a]", "$[?@.a ==]", "$[?== 1]", "$[?@.a = 1]", "$[?@.a === 1]", "$[?@.a <> 1]",
                 "$[?@.a =< 1]", "$[?@.a = = 1]", "$[?@.a == 1 == 1]", "$[?!!@.a]", "$[?!@.a == 1]",
                 "$[?(@.a) == 1]", "$[?@.a & @.b]", "$[?@.a | @.b]", "$[?@.a and @.b]", "$[?(@.a]",
                 "$[?@.a)]", "$[?()]", "$[?true]", "$[?false]", "$[?null]", "$[?1]", "$[?'a']",
                 "$[?@ == [1]]", "$[?@ == {}]", "$[?@.a + 1 == 2]", "$[?@.a == True]", "$[?!1]",
                 "$[?1 && @.a]", "$[?@.a && 1]", "$[?(1)]", "$[?@.a ||]")

    def test_r14_semantics(self):
        d = ('{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],'
             '"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}')
        self.ok("$.a[?@.b == 'kilo']", d, '[{"b":"kilo"}]', '["$[\'a\'][9]"]')
        self.ok("$.a[?@>3.5]", d, "[5,4,6]", '["$[\'a\'][1]","$[\'a\'][4]","$[\'a\'][5]"]')
        v, p = query("$[?@.*]", J(d))
        self.assertEqual(p, ["$['a']", "$['o']"])
        v, p = query("$[?@[?@.b]]", J(d))
        self.assertEqual(p, ["$['a']"])
        self.ok("$.o[?@<3, ?@<3]", d, "[1,2,1,2]", '["$[\'o\'][\'p\']","$[\'o\'][\'q\']","$[\'o\'][\'p\']","$[\'o\'][\'q\']"]')
        self.ok("$.a[?@<2 || @.b == \"k\"]", d, '[1,{"b":"k"}]', '["$[\'a\'][2]","$[\'a\'][7]"]')
        self.ok("$.o[?@>1 && @<4]", d, "[2,3]", '["$[\'o\'][\'q\']","$[\'o\'][\'r\']"]')
        self.ok("$.o[?@.u || @.x]", d, '[{"u":6}]', '["$[\'o\'][\'t\']"]')
        v, p = query("$.a[?@.b == $.x]", J(d))
        self.assertEqual(len(v), 6)
        self.none("$[?@ == 1]", "1")
        self.ok("$[?@ > 1]", '{"x":1,"y":2,"z":3}', "[2,3]", '["$[\'y\']","$[\'z\']"]')
        self.ok("$.a[?@ == $.n]", '{"a":[1,2,3],"n":2}', "[2]", '["$[\'a\'][1]"]')
        self.ok("$[?$.flag]", '{"flag":false,"v":1}', "[false,1]", '["$[\'flag\']","$[\'v\']"]')
        self.ok("$[?@[?@ > 2]]", "[[1,2],[3]]", "[[3]]", '["$[1]"]')
        self.none("$[?@.a < @.b]", '[{"a":"x","b":1},{"a":[1],"b":[2]}]')

    def test_r15_existence(self):
        self.ids("$[?@]", '[0,false,null,"",[],{}]', [0, 1, 2, 3, 4, 5])
        self.ids("$[?@.a]", '[{"a":false},{"a":null},{}]', [0, 1])
        self.ids("$[?!@.a]", '[{"a":false},{"a":null},{}]', [2])
        self.ids("$[?@..x]", '[{"y":{"x":1}},{"y":2}]', [0])
        self.ids("$[?@[1:]]", '[[1],[1,2],"ab"]', [1])

    def test_r16_literals(self):
        self.ids("$[?@ == 1e2]", '[100,100.0,"100",1]', [0, 1])
        self.ids("$[?@ == 1E+2]", "[100]", [0])
        self.ids("$[?@ == 1.5e-1]", "[0.15,1.5]", [0])
        self.ids("$[?@ < -0.5]", "[-1,-0.5,0]", [0])
        self.ids("$[?@ == -0]", "[0,-0,0.0,1]", [0, 1, 2])
        self.ids("$[?@ == -0.0]", "[0]", [0])
        self.ids("$[?@ == \"a\"]", '["a","b"]', [0])
        self.ids("$[?@ == 'it\\'s']", '["it\'s"]', [0])
        self.ids("$[?@ == true]", '[true,"true",1]', [0])
        self.ids("$[?@ == false]", "[false,0,null]", [0])
        self.ids("$[?@ == null]", '[null,0,false,""]', [0])
        self.ids("$[?@ < 1e400]", "[1]", [0])
        self.bad("$[?@ == 01]", "$[?@ == +1]", "$[?@ == .5]", "$[?@ == 1.]", "$[?@ == 1e]", "$[?@ == 1.5e+]",
                 "$[?@ == - 1]", "$[?@ == NaN]", "$[?@ == Null]", '$[?@ == "abc]')

    def test_r17_singular(self):
        self.ok("$[?@[0] == 2]", "[[2],[3],2]", "[[2]]", '["$[0]"]')
        self.ok("$[?@[-1] == 3]", "[[2,3],[3,2]]", "[[2,3]]", '["$[0]"]')
        self.ok("$[?@['a'] == 1]", '[{"a":1},{"a":2}]', '[{"a":1}]', '["$[0]"]')
        self.ok("$[?@.a.b == 1]", '[{"a":{"b":1}},{"a":1}]', '[{"a":{"b":1}}]', '["$[0]"]')
        self.ok("$[?@.a [0] == 1]", '[{"a":[1]}]', '[{"a":[1]}]', '["$[0]"]')
        self.none("$[?@ == $]", "[1]")
        self.ok("$[?$.k == @]", '{"k":1,"m":1,"n":2}', "[1,1]", '["$[\'k\']","$[\'m\']"]')
        self.bad("$[?@.* == 1]", "$[?@..a == 1]", "$[?@[*] == 1]", "$[?@[0:1] == 1]", "$[?@['a','b'] == 1]",
                 "$[?@[0,1] == 1]", "$[?@[?@ > 1] == 1]", "$[?$..a == 1]", "$[?@[ 'a' ] == 1]", "$[?@[ 0 ] == 1]")
        self.ok("$[?@[ 'a' ]]", '[{"a":1},{}]', '[{"a":1}]', '["$[0]"]')

    def test_r18_table(self):
        doc = J('{"obj":{"x":"y"},"arr":[2,3]}')
        allc = ["$.absent1 == $.absent2", "$.absent1 <= $.absent2", "$.absent != 'g'", "1 <= 2", "'a' <= 'b'",
                "$.obj != $.arr", "$.obj == $.obj", "$.arr == $.arr", "$.obj != 17", "$.obj <= $.obj",
                "$.arr <= $.arr", "true <= true", "null >= null", "'ab' < 'abc'", "'' < 'a'", "'B' < 'a'",
                "$.arr[0] == 2", "$.arr[0] == 2.0"]
        nonec = ["$.absent == 'g'", "$.absent1 != $.absent2", "1 > 2", "13 == '13'", "'a' > 'b'", "$.obj == $.arr",
                 "$.obj != $.obj", "$.arr != $.arr", "$.obj == 17", "$.obj <= $.arr", "$.obj < $.arr",
                 "1 <= $.arr", "1 >= $.arr", "1 > $.arr", "1 < $.arr", "true > true", "null < null",
                 "false < true", "'b' < 'abc'"]
        for c in allc:
            self.assertEqual(len(query("$[?%s]" % c, doc)[0]), 2, c)
        for c in nonec:
            self.assertEqual(query("$[?%s]" % c, doc)[0], [], c)

    def test_r18_more(self):
        self.ids("$[?@ < 'b']", '["a","b","c","",1,"B"]', [0, 3, 5])
        self.ids("$[?@ > '\\uE000']", '["\U0001F600","a","\\uE000"]', [0])
        self.ids("$[?@ >= 2]", '[1,2,3,"3",[3]]', [1, 2])
        self.ids("$[?@ <= true]", "[false,true]", [1])
        self.ids("$[?@.x == @.y]",
                 '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},'
                 '{"x":[1,2],"y":[2,1]},{"x":{"a":1},"y":{"a":1,"b":2}},{"x":1,"y":1.0},{"x":"1","y":1}]',
                 [0, 1, 4])
        self.ids("$[?@.x == @.y]", "[{}]", [0])
        self.ids("$[?@.x != @.y]", "[{}]", [])
        self.ids("$[?@.x < @.y]", "[{}]", [])
        self.ids("$[?@.x != 1]", '[{},{"x":1},{"x":2}]', [0, 2])
        self.ids("$[?@.x == null]", '[{},{"x":null}]', [1])
        self.ids("$[?@.x >= @.x]", '[{"x":{}},{"x":[]},{},{"x":null}]', [0, 1, 2, 3])
        # numbers compare as binary64
        self.ids("$[?@ == 9007199254740993]", "[9007199254740992]", [0])

    def test_r19_logic(self):
        d = '[{"a":1},{"b":1},{"b":1,"c":1}]'
        self.ids("$[?@.a || @.b && @.c]", d, [0, 2])
        self.ids("$[?(@.a || @.b) && @.c]", d, [2])
        self.ids("$[?@.c && @.b || @.a]", d, [0, 2])
        self.ids("$[?!(@.a || @.c)]", d, [1])
        self.ids("$[?!@.a && !@.c]", d, [1])


class TestFunctions(Base):
    def test_r20_syntax(self):
        self.ids("$[?length(@) == 1]", '["a","ab"]', [0])
        self.ids("$[?length( @ ) == 1]", '["a","ab"]', [0])
        self.bad("$[?length (@) == 1]", "$[?Length(@) == 1]", "$[?foo(@)]", "$[?bar(@.a) == 1]", "$[?_x(@)]",
                 "$[?length() == 1]", "$[?length(@, @) == 1]", "$[?count() == 0]", "$[?match(@)]",
                 "$[?search(@, 'a', 'b')]", "$[?value(@, @) == 1]", "$[?length(@ == 1]", "$.length(@)")

    def test_r21_types(self):
        self.ids("$[?length(@) < 3]", '["ab","abc",[1,2],{"a":1},5,null]', [0, 2, 3])
        self.bad("$[?length(@.*) < 3]", "$[?count(1) == 1]", "$[?count('a') == 1]", "$[?count(length(@)) == 1]",
                 "$[?count(@.a == 1) == 1]", "$[?match(@.timezone, 'Europe/.*') == true]", "$[?value(@..color)]",
                 "$[?length(@)]", "$[?count(@)]", "$[?!length(@)]", "$[?length(match(@, 'a')) == 1]",
                 "$[?length(@.a == 1) == 1]", "$[?length((@.a)) == 1]", "$[?match(@.*, 'a')]",
                 "$[?match(@, @.*)]", "$[?count(value(@)) == 1]", "$[?match(@, 'a') == match(@, 'a')]")
        self.ids("$[?count(@.*) == 1]", '[[1],[1,2],{"a":1},3]', [0, 2])
        self.ids("$[?!match(@, 'a')]", '["a","b",1]', [1, 2])
        self.ids("$[?match(@, 'a') && length(@) == 1]", '["a","aa",1]', [0])
        self.ids("$[?length(value(@.*)) == 2]", '[["ab"],["ab","c"],[[1,2]]]', [0, 2])
        self.ids("$[?match(length(@), '1')]", '["a"]', [])
        self.ids("$[?length('ab') == 2]", "[7,8]", [0, 1])
        self.ids("$[?count(@) == count($)]", "[1]", [0])
        self.ids("$[?match('abc', 'a.c')]", "[1,2]", [0, 1])
        self.ids("$[?value(@..color) == \"red\"]", '[{"color":"red"}]', [0])

    def test_r22_length(self):
        self.ids("$[?length(@) == 3]", '["abc",[1,2,3],{"a":1,"b":2,"c":3},3,"ab",null]', [0, 1, 2])
        self.ids("$[?length(@) == 1]", '["\U0001F600","e\\u0301"]', [0])
        self.ids("$[?length(@) == 0]", '["",[],{},0,null]', [0, 1, 2])
        self.ids("$[?length(@) == length(@)]", '[1,"ab",[1]]', [0, 1, 2])
        self.ids("$[?length(@.a) >= 2]", '[{"a":"xy"},{"a":"x"},{"b":"xyz"},{"a":[1,2,3]}]', [0, 3])
        self.ids("$[?length(@) != 2]", '[true,"ab"]', [0])
        self.ids("$[?length(1) == 1]", "[1]", [])

    def test_r23_count(self):
        self.ids("$[?count(@.*) == 2]", '[[1,2],{"a":1,"b":2},[1],"ab"]', [0, 1])
        self.ids("$[?count(@[0,0]) == 2]", "[[5],[]]", [0])
        self.ids("$[?count(@) == 1]", "[1,null]", [0, 1])
        self.ids("$[?count(@..*) > 2]", '[{"a":[1,2]},{"a":1}]', [0])
        self.ids("$[?count(@[?@ > 1]) == 2]", "[[1,2,3],[2],[0,5,6,7]]", [0])
        self.ids("$[?count(@.a) == 0]", '[{"a":null},{}]', [1])

    def test_r24_match(self):
        self.ids("$[?match(@, 'a.c')]", '["abc","abcd","a\\nc","xabc",1]', [0])
        self.ids("$[?match(@, '1')]", '[1,"1"]', [1])
        self.ids("$[?match(@.s, @.p)]",
                 '[{"s":"aaa","p":"a+"},{"s":"b","p":"a+"},{"s":"a","p":1},{"s":"a","p":"("},{"s":"a"}]', [0])
        self.ids("$[?match(@, '(')]", '["("]', [])
        self.ids("$[?match(@, '')]", '["","a"]', [0])
        self.ids("$[?match(@, 'a|bc')]", '["a","bc","abc","ac"]', [0, 1])
        self.ids("$[?match(@.date, '1974-05-..')]",
                 '[{"date":"1974-05-13"},{"date":"1974-06-01"},{"date":"1974-05-1"}]', [0])

    def test_r25_search(self):
        self.ids("$[?search(@, 'a.c')]", '["abc","abcd","a\\nc","xabc",1]', [0, 1, 3])
        self.ids("$[?search(@.author, '[BR]ob')]",
                 '[{"author":"Bob"},{"author":"Rob Roy"},{"author":"bob"},{"author":"Mr. Robinson"}]', [0, 1, 3])
        self.ids("$[?search(@, '')]", '["","a",1]', [0, 1])
        self.ids("$[?search(@, 'x*')]", '["","abc"]', [0, 1])
        self.ids("$[?search(@, '.')]", '["","\\n","a"]', [2])
        self.ids("$[?search(@, '[')]", '["["]', [])

    def test_r26_value(self):
        self.ids("$[?value(@..color) == \"red\"]",
                 '[{"color":"red"},{"x":{"color":"red"}},{"color":"red","y":{"color":"red"}},{"color":"blue"}]', [0, 1])
        self.ids("$[?value(@.*) == 1]", '[[1],[1,1],{"k":1},[]]', [0, 2])
        self.ids("$[?value(@.a) == value(@.b)]", '[{"a":1,"b":1},{"a":1},{}]', [0, 2])


class TestRegexp(Base):
    def m(self, pattern, strings, want):
        """pattern is the raw I-Regexp; strings a list; want the matching indexes."""
        lit = json.dumps(pattern)
        got = [i for i, s in enumerate(strings) if query("$[?match(@, %s)]" % lit, [s])[0]]
        self.assertEqual(got, want, pattern)

    def test_r27_invalid(self):
        for pat in ["\\d", "\\w", "\\s", "\\u0041", "\\$", "[]", "[^]", "[a-c-e]", "[z-a]", "a]", "a}", "a{",
                    "a**", "a*?", "(?:a)", "*a", "(a", "a)", "a{,2}", "a{2,1}", "a{}", "a{2}{3}",
                    "\\p{IsBasicLatin}", "\\p{Lx}", "\\p{l}", "\\p{L&}", "\\p{Latin}", "[--a]", "\\/", "\\1", "[a-\\p{L}]"]:
            self.m(pat, ["a", "1", "$", "[]", "", "aa", "A", "m", "(", "a{"], [])

    def test_r27_valid(self):
        self.m("a\\.b", ["a.b", "axb"], [0])
        self.m("a$", ["a", "a$"], [1])
        self.m("[a-]", ["-", "a", "b"], [0, 1])
        self.m("[-a]", ["-", "a", "b"], [0, 1])
        self.m("[^^]", ["^", "x"], [1])
        self.m("[\\[\\]]", ["[", "]", "a"], [0, 1])
        self.m("a\\]", ["a]"], [0])
        self.m("a\\-b", ["a-b"], [0])
        self.m("[-]", ["-", "a"], [0])
        self.m("[^-]", ["-", "a"], [1])
        self.m("[a^]", ["^", "a", "b"], [0, 1])
        self.m("()", ["", "a"], [0])
        self.m("a|", ["", "a", "b"], [0, 1])
        self.m("|", ["", "a"], [0])

    def test_r28_semantics(self):
        self.m("a.c", ["abc", "a\nc", "a\rc", "abcd", "a\U0001F600c"], [0, 4])
        self.m(".", ["\U0001F600", "ab", ""], [0])
        self.m("[a-c]+", ["abc", "abd", "", "cab"], [0, 3])
        self.m("[^a-c]", ["a", "d", "\n", "dd"], [1, 2])
        self.m("a\\nb", ["a\nb", "anb"], [0])
        self.m("a\\tb", ["a\tb", "atb"], [0])
        self.m("A", ["a", "A"], [1])
        self.m("\\p{Lu}+", ["ABC", "AbC", "ÀÉ", ""], [0, 2])
        self.m("\\P{L}+", ["a1", "12", " !"], [1, 2])
        self.m("\\p{Nd}", ["3", "٣", "x", "Ⅻ"], [0, 1])
        self.m("\\p{N}", ["3", "٣", "x", "Ⅻ"], [0, 1, 3])
        self.m("[\\p{Lu}0-9]+", ["A1", "a1", "Z9Z"], [0, 2])
        self.m("[^\\p{L}]", ["a", "1"], [1])
        self.m("a{2}", ["a", "aa", "aaa"], [1])
        self.m("a{2,}", ["a", "aa", "aaa"], [1, 2])
        self.m("a{1,2}", ["a", "aa", "aaa"], [0, 1])
        self.m("a{0}", ["", "a"], [0])
        self.m("ab?c", ["ac", "abc", "abbc"], [0, 1])
        self.m("(ab)+", ["abab", "aba", ""], [0])
        self.m("x(a|b)*y", ["xy", "xabbay", "xacy"], [0, 1])
        self.m("\\p{Cn}", ["͸", "a"], [0])
        v, p = query("$[?search(@, '^a')]", ["ab", "^ab", "b^a"])
        self.assertEqual(p, ["$[1]", "$[2]"])

    def test_string_literal_escape_in_regexp(self):
        self.bad("$[?match(@, 'a\\.b')]")
        self.ids("$[?match(@, 'a\\\\.b')]", '["a.b","axb"]', [0])
        self.ids("$[?match(@, 'a\\nb')]", '["a\\nb","anb"]', [0])
        self.ids("$[?search(@, 'R\\\\.')]", '["J. R. R.","R"]', [0])


class TestResults(Base):
    def test_r29_paths(self):
        self.ok("$[-3]", "[0,1,2,3,4]", "[2]", '["$[2]"]')
        self.ok("$.a.b[1:2]", '{"a":{"b":[0,1,2]}}', "[1]", '["$[\'a\'][\'b\'][1]"]')
        self.ok('$["\\u000B"]', {"\x0b": 1}, "[1]", '["$[\'\\\\u000b\']"]')
        self.ok("$[12]", list(range(13)), "[12]", '["$[12]"]')
        doc = {"\b": 1, "\f": 2, "\n": 3, "\r": 4, "\t": 5, "'": 6, "\\": 7, "\x00": 8, "\x1f": 9, '"': 10,
               "/": 11, "\x7f": 12, "é": 13, "\x0b": 14, "\x0e": 15}
        _, p = query("$.*", doc)
        self.assertEqual(p, ["$['\\b']", "$['\\f']", "$['\\n']", "$['\\r']", "$['\\t']", "$['\\'']", "$['\\\\']",
                             "$['\\u0000']", "$['\\u001f']", "$['\"']", "$['/']", "$['\x7f']", "$['é']",
                             "$['\\u000b']", "$['\\u000e']"])
        _, p = query("$..*", {"a b": [{"c": 1}]})
        self.assertEqual(p, ["$['a b']", "$['a b'][0]", "$['a b'][0]['c']"])

    def test_r30_order(self):
        self.ok("$.*", '{"b":1,"a":2,"1":3}', "[1,2,3]", '["$[\'b\']","$[\'a\']","$[\'1\']"]')
        self.ok("$[?@ > 0]", '{"z":1,"10":2,"2":3}', "[1,2,3]", '["$[\'z\']","$[\'10\']","$[\'2\']"]')
        self.ok("$..*", '{"y":{"q":1},"x":2}', '[{"q":1},2,1]', '["$[\'y\']","$[\'x\']","$[\'y\'][\'q\']"]')

    def test_r31_values(self):
        d = '{"a":null,"b":[null],"c":[{}],"null":1}'
        self.ok("$.a", d, "[null]", '["$[\'a\']"]')
        self.none("$.a[0]", d)
        self.none("$.a.d", d)
        self.ok("$.b[?@]", d, "[null]", '["$[\'b\'][0]"]')
        self.ok("$.b[?@==null]", d, "[null]", '["$[\'b\'][0]"]')
        self.none("$.c[?@.d==null]", d)
        self.ok("$.*", '{"a":1,"b":2,"a":3}', "[3,2]", '["$[\'a\']","$[\'b\']"]')
        self.ok("$.a", '{"a":1,"a":3}', "[3]", '["$[\'a\']"]')

    def test_r32_bookstore(self):
        store = J('''{"store":{"book":[
          {"category":"reference","author":"Nigel Rees","title":"Sayings of the Century","price":8.95},
          {"category":"fiction","author":"Evelyn Waugh","title":"Sword of Honour","price":12.99},
          {"category":"fiction","author":"Herman Melville","title":"Moby Dick","isbn":"0-553-21311-3","price":8.99},
          {"category":"fiction","author":"J. R. R. Tolkien","title":"The Lord of the Rings","isbn":"0-395-19395-8","price":22.99}],
          "bicycle":{"color":"red","price":399}}}''')
        v, p = query("$..author", store)
        self.assertEqual(v, ["Nigel Rees", "Evelyn Waugh", "Herman Melville", "J. R. R. Tolkien"])
        self.assertEqual(query("$.store.book[*].author", store), (v, p))
        v, p = query("$.store..price", store)
        self.assertEqual(len(v), 5)
        self.assertEqual(p[-1], "$['store']['bicycle']['price']")
        self.assertEqual(query("$..book[?@.price<10].title", store)[1],
                         ["$['store']['book'][0]['title']", "$['store']['book'][2]['title']"])
        self.assertEqual(len(query("$..*", store)[0]), 27)
        self.assertEqual(query("$.store[?length(@) == 2]", store)[1], ["$['store']['bicycle']"])
        self.assertEqual(query("$.store.book[?count(@.isbn) == 0].author", store)[0], ["Nigel Rees", "Evelyn Waugh"])
        self.assertEqual(query("$[?value(@..color) == \"red\"]", store)[1], ["$['store']"])
        self.assertEqual(query("$.store.book[?search(@.author, 'R\\\\.')].title", store)[0],
                         ["The Lord of the Rings"])
        self.assertEqual(query("$.store.book[?@.category == 'fiction' && @.price > 20].title", store)[1],
                         ["$['store']['book'][3]['title']"])


class TestBuildRequirements(unittest.TestCase):
    def test_bu001_regen_json(self):
        with open(os.path.join(HERE, "REGEN.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        self.assertEqual(set(cfg), {"lang", "build", "test", "driver"})
        self.assertEqual(cfg["lang"], "py")
        for key in ("build", "test", "driver"):
            v = cfg[key]
            if isinstance(v, dict):
                self.assertIn("default", v)
                self.assertTrue(all(isinstance(x, str) for x in v.values()))
            else:
                self.assertIsInstance(v, str)
        for cmd in cfg["driver"].values():
            self.assertNotIn("  ", cmd)
            self.assertEqual(cmd, cmd.strip())

    def test_bu002_has_tests(self):
        self.assertTrue(os.path.exists(os.path.join(HERE, "test_jsonpath.py")))

    def test_bu003_no_dependency_files(self):
        banned = {"node_modules", "package-lock.json", "requirements.txt", "Pipfile", "poetry.lock"}
        for _, dirs, files in os.walk(HERE):
            self.assertFalse(banned & (set(dirs) | set(files)))

    def test_bu004_size(self):
        total = 0
        for root, dirs, files in os.walk(HERE):
            if "test" in dirs:
                dirs.remove("test")
            if "tests" in dirs:
                dirs.remove("tests")
            for fn in files:
                if fn.endswith(".py") and not fn.startswith("test_") and not fn.endswith("_test.py"):
                    with open(os.path.join(root, fn), encoding="utf-8") as f:
                        total += sum(1 for line in f if line.strip())
        self.assertLessEqual(total, 3000)


if __name__ == "__main__":
    unittest.main()
