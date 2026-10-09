import json
import os
import re
import subprocess
import sys
import unittest

import driver

HERE = os.path.dirname(os.path.abspath(__file__))
INVALID = "invalid"


def norm(x):
    if isinstance(x, float) and x == int(x):
        x = int(x)
    if isinstance(x, list):
        return [norm(i) for i in x]
    if isinstance(x, dict):
        return {k: norm(v) for k, v in x.items()}
    return x


def canon(x):
    return json.dumps(norm(x), sort_keys=True)


def ask(query, doc_json):
    line = '{"id":"t","op":"query","input":{"query":%s,"document":%s}}' % (json.dumps(query), doc_json)
    return json.loads(driver.handle_line(line))


def scenarios(cases):
    """cases: (query, doc json, values json, paths json) or (query, INVALID)."""
    def decorator(self):
        for case in cases:
            with self.subTest(query=case[0], doc=case[1] if len(case) > 2 else None):
                if case[1] == INVALID and len(case) == 2:
                    self.assertEqual(ask(case[0], "null"), {"id": "t", "error": "invalid_query"})
                    self.assertEqual(ask(case[0], "[1,{\"a\":2}]"), {"id": "t", "error": "invalid_query"})
                else:
                    q, doc, vals, paths = case
                    r = ask(q, doc)
                    self.assertIn("result", r, r)
                    self.assertEqual(canon(r["result"]["values"]), canon(json.loads(vals)))
                    self.assertEqual(r["result"]["paths"], json.loads(paths))
    return decorator


def many(q, doc, expected):
    return [(q, doc, v, p) for q, v, p in ((q_, v_, p_) for q_, v_, p_ in expected)]


def bad(*queries):
    return [(q, INVALID) for q in queries]


class Protocol(unittest.TestCase):  # R1
    def resp(self, line):
        return driver.handle_line(line)

    def test_r1_examples(self):
        cases = [
            ('{"id":"r1","op":"query","input":{"query":"$.a","document":{"a":1}}}',
             '{"id":"r1","result":{"values":[1],"paths":["$[\'a\']"]}}'),
            ('{"id":"r2","op":"query","input":{"query":"$","document":null}}',
             '{"id":"r2","result":{"values":[null],"paths":["$"]}}'),
            ('{"id":"r3","op":"query","input":{"query":"$"}}', '{"id":"r3","error":"bad_request"}'),
            ('{"id":"r4","op":"evaluate","input":{"query":"$","document":1}}', '{"id":"r4","error":"unknown_op"}'),
            ('{"id":"r5"}', '{"id":"r5","error":"unknown_op"}'),
            ('{"id":"r6","op":"nope","input":{"query":"$[","document":1}}', '{"id":"r6","error":"unknown_op"}'),
            ('hello', '{"id":null,"error":"bad_request"}'),
            ('[1,2]', '{"id":null,"error":"bad_request"}'),
            ('{"id":7,"op":"query","input":{"query":"$","document":1}}', '{"id":null,"error":"bad_request"}'),
            ('{"id":"r8","op":"query","input":{"query":42,"document":1}}', '{"id":"r8","error":"bad_request"}'),
            ('{"id":"r9","op":"query","input":"$"}', '{"id":"r9","error":"bad_request"}'),
            ('{"id":"r10","op":"query","input":{"query":"$[","document":{}}}', '{"id":"r10","error":"invalid_query"}'),
            ('{"id":"r11","op":"query","input":{"query":"$.a","document":1,"extra":true},"x":0}',
             '{"id":"r11","result":{"values":[],"paths":[]}}'),
            ('{"id":"r","op":"query","input":{"query":"$","document":[]}}',
             '{"id":"r","result":{"values":[[]],"paths":["$"]}}'),
            ('{"id":"r","op":1,"input":{}}', '{"id":"r","error":"unknown_op"}'),
            ('{"op":"query"}', '{"id":null,"error":"bad_request"}'),
            ('\x0c', '{"id":null,"error":"bad_request"}'),
            ('{"id":"q","op":"query","input":{"query":"$","document":NaN}}', '{"id":null,"error":"bad_request"}'),
        ]
        for line, want in cases:
            with self.subTest(line=line):
                self.assertEqual(self.resp(line), want)

    def test_r1_blank_and_crlf(self):
        self.assertIsNone(self.resp(""))
        self.assertIsNone(self.resp("  \t"))
        self.assertIsNone(self.resp("\r"))
        self.assertEqual(self.resp('{"id":"a","op":"query","input":{"query":"$","document":1}}\r'),
                         '{"id":"a","result":{"values":[1],"paths":["$"]}}')

    def test_r1_falsy_documents(self):
        for d in ("null", "false", "0", '""', "[]", "{}"):
            self.assertEqual(ask("$", d)["result"]["paths"], ["$"])

    def test_r1_valid_query_never_errors(self):
        self.assertEqual(ask("$.a.b.c", "[1,2]")["result"], {"values": [], "paths": []})

    def test_r1_process_io(self):
        data = (b'\n  \t\n{"id":"a","op":"query","input":{"query":"$","document":1}}\r\n'
                b'{"id":"b","op":"query","input":{"query":"$x","document":1}}\n'
                b'\xff\xfe\n'
                b'{"id":"c","op":"query","input":{"query":"$.k","document":{"k":"\\u00e9\\ud83d\\ude00"}}}')
        p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], input=data,
                           capture_output=True, cwd=HERE, timeout=60)
        self.assertEqual(p.returncode, 0)
        lines = p.stdout.split(b"\n")
        self.assertEqual(lines[-1], b"")
        self.assertNotIn(b"\r", p.stdout)
        got = [json.loads(x.decode("utf-8")) for x in lines[:-1]]
        self.assertEqual(got[0], {"id": "a", "result": {"values": [1], "paths": ["$"]}})
        self.assertEqual(got[1], {"id": "b", "error": "invalid_query"})
        self.assertEqual(got[2], {"id": None, "error": "bad_request"})
        self.assertEqual(got[3]["result"]["values"], ["é😀"])
        self.assertEqual(len(got), 4)


class Syntax(unittest.TestCase):
    def test_r2_blank_space(self):  # R2
        scenarios([
            ("$ .a", '{"a":1}', "[1]", '["$[\'a\']"]'),
            ("$ ['a'] ['b']", '{"a":{"b":2}}', "[2]", '["$[\'a\'][\'b\']"]'),
            ("$\n.a", '{"a":1}', "[1]", '["$[\'a\']"]'),
            ("$\t['a']", '{"a":1}', "[1]", '["$[\'a\']"]'),
            ("$ ..a", '{"a":1}', "[1]", '["$[\'a\']"]'),
            ("$[ 'a' , 'b' ]", '{"a":1,"b":2}', "[1,2]", '["$[\'a\']","$[\'b\']"]'),
            ("$['\ud83d\ude00']", '{"\\ud83d\\ude00":1}', "[1]", '["$[\'😀\']"]'),
            *bad("", " $", "$ ", "$\x0c.a", "$['a'\u00a0]", "$. a", "$.. a", "$['\ud800']"),
        ])(self)

    def test_r3_root(self):  # R3
        scenarios([
            ("$", '{"k":"v"}', '[{"k":"v"}]', '["$"]'),
            ("$", "42", "[42]", '["$"]'),
            ("$.a[*].b", '{"a":[{"b":0},{"b":1},{"c":2}]}', "[0,1]", '["$[\'a\'][0][\'b\']","$[\'a\'][1][\'b\']"]'),
            ("$[*][*]", "[[1,2],[3],4]", "[1,2,3]", '["$[0][0]","$[0][1]","$[1][0]"]'),
            ("$[0,0][0]", "[[7]]", "[7,7]", '["$[0][0]","$[0][0]"]'),
            ("$.x[0]", '{"y":[1]}', "[]", "[]"),
            *bad("@", "@.a", "a", "$$", "$a"),
        ])(self)

    def test_r4_child_segments(self):  # R4
        a7 = '["a","b","c","d","e","f","g"]'
        scenarios([
            ("$['a','b']", '{"a":1,"b":2}', "[1,2]", '["$[\'a\']","$[\'b\']"]'),
            ("$['b','a','b']", '{"a":1,"b":2}', "[2,1,2]", '["$[\'b\']","$[\'a\']","$[\'b\']"]'),
            ("$[0, 3]", a7, '["a","d"]', '["$[0]","$[3]"]'),
            ("$[0:2, 5]", a7, '["a","b","f"]', '["$[0]","$[1]","$[5]"]'),
            ("$[0, 'a', 1:3, *]", '["x","y","z"]', '["x","y","z","x","y","z"]',
             '["$[0]","$[1]","$[2]","$[0]","$[1]","$[2]"]'),
            ("$[?@ > 1, 0]", "[1,2,3]", "[2,3,1]", '["$[1]","$[2]","$[0]"]'),
            ("$['a', 0]", '{"a":1}', "[1]", '["$[\'a\']"]'),
            ("$.*", '{"a":1,"b":[2]}', "[1,[2]]", '["$[\'a\']","$[\'b\']"]'),
            *bad("$[]", "$['a',]", "$[,'a']", "$['a',,'b']", "$['a'", "$['a']]", "$.", "$.['a']", "$.**", "$[**]"),
        ])(self)

    def test_r5_shorthand(self):  # R5
        scenarios([
            ("$._foo1", '{"_foo1":"x"}', '["x"]', '["$[\'_foo1\']"]'),
            ("$.ü", '{"ü":1}', "[1]", '["$[\'ü\']"]'),
            ("$.日本", '{"日本":2}', "[2]", '["$[\'日本\']"]'),
            ("$.a😀", '{"a😀":3}', "[3]", '["$[\'a😀\']"]'),
            ("$.null", '{"null":1}', "[1]", '["$[\'null\']"]'),
            ("$.length", '{"length":5}', "[5]", '["$[\'length\']"]'),
            ("$.foo.bar", '{"foo.bar":1,"foo":{"bar":2}}', "[2]", '["$[\'foo\'][\'bar\']"]'),
            *bad("$.1", "$.a-b", "$.a b", "$.$a", "$.'a'", "$.\\u0061", "$.\x7f"),
        ])(self)

    def test_r6_descendant(self):  # R6
        d = '{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}'
        scenarios([
            ("$..j", d, "[1,4]", '["$[\'o\'][\'j\']","$[\'a\'][2][0][\'j\']"]'),
            ("$..[0]", d, '[5,{"j":4}]', '["$[\'a\'][0]","$[\'a\'][2][0]"]'),
            ("$..*", d,
             '[{"j":1,"k":2},[5,3,[{"j":4},{"k":6}]],1,2,5,3,[{"j":4},{"k":6}],{"j":4},{"k":6},4,6]',
             '["$[\'o\']","$[\'a\']","$[\'o\'][\'j\']","$[\'o\'][\'k\']","$[\'a\'][0]","$[\'a\'][1]","$[\'a\'][2]",'
             '"$[\'a\'][2][0]","$[\'a\'][2][1]","$[\'a\'][2][0][\'j\']","$[\'a\'][2][1][\'k\']"]'),
            ("$.o..[*, *]", d, "[1,2,1,2]", '["$[\'o\'][\'j\']","$[\'o\'][\'k\']","$[\'o\'][\'j\']","$[\'o\'][\'k\']"]'),
            ("$.a..[0, 1]", d, '[5,3,{"j":4},{"k":6}]',
             '["$[\'a\'][0]","$[\'a\'][1]","$[\'a\'][2][0]","$[\'a\'][2][1]"]'),
            ("$..a", '{"a":{"a":1}}', '[{"a":1},1]', '["$[\'a\']","$[\'a\'][\'a\']"]'),
            ("$..[?@ > 1]", '{"x":[1,2,{"y":3}],"z":5}', "[5,2,3]", '["$[\'z\']","$[\'x\'][1]","$[\'x\'][2][\'y\']"]'),
            ("$..*", "5", "[]", "[]"),
            ("$..[1]", "[[0,1],2]", "[2,1]", '["$[1]","$[0][1]"]'),
            *bad("$..", "$...a", "$..1"),
        ])(self)

    def test_r7_r8_strings_and_names(self):  # R7, R8
        scenarios([
            ('$["a"]', '{"a":1}', "[1]", '["$[\'a\']"]'),
            ("$['\\u0061']", '{"a":1}', "[1]", '["$[\'a\']"]'),
            ('$["\\u00E9"]', '{"é":1}', "[1]", '["$[\'é\']"]'),
            ('$["\\uD83D\\uDE00"]', '{"😀":1}', "[1]", '["$[\'😀\']"]'),
            ("$['\\t']", '{"\\t":1}', "[1]", '["$[\'\\\\t\']"]'),
            ("$['a\\/b']", '{"a/b":1}', "[1]", '["$[\'a/b\']"]'),
            ("$['a\\\\b']", '{"a\\\\b":1}', "[1]", '["$[\'a\\\\\\\\b\']"]'),
            ('$["a\'b"]', '{"a\'b":1}', "[1]", '["$[\'a\\\\\'b\']"]'),
            ("$['a\\'b']", '{"a\'b":1}', "[1]", '["$[\'a\\\\\'b\']"]'),
            ("$['a\"b']", '{"a\\"b":1}', "[1]", '["$[\'a\\"b\']"]'),
            ('$["a\\"b"]', '{"a\\"b":1}', "[1]", '["$[\'a\\"b\']"]'),
            ("$['']", '{"":1}', "[1]", '["$[\'\']"]'),
            ("$.o['j j']['k.k']", '{"o":{"j j":{"k.k":3}}}', "[3]", '["$[\'o\'][\'j j\'][\'k.k\']"]'),
            ('$["\'"]["@"]', '{"\'":{"@":2}}', "[2]", '["$[\'\\\\\'\'][\'@\']"]'),
            ("$['O']", '{"o":1}', "[]", "[]"),
            ("$['0']", '["x"]', "[]", "[]"),
            ("$['a']", '"a"', "[]", "[]"),
            ("$['\u00e9']", '{"e\\u0301":1}', "[]", "[]"),
            *bad('$["\\\'"]', "$['\\\"']", "$['\\a']", "$['\\U0061']", "$['\\u006']", "$['\\uD800']",
                 "$['\\uDC00']", "$['\\uD800\\u0041']", "$['\\uD800x']", "$['a\tb']", "$['a\nb']",
                 "$['abc", "$['a''b']", "$[a]", "$['\\x41']", "$['\\0']"),
        ])(self)

    def test_r9_wildcard(self):  # R9
        d = '{"o":{"j":1,"k":2},"a":[5,3]}'
        scenarios([
            ("$[*]", d, '[{"j":1,"k":2},[5,3]]', '["$[\'o\']","$[\'a\']"]'),
            ("$.o[*, *]", d, "[1,2,1,2]", '["$[\'o\'][\'j\']","$[\'o\'][\'k\']","$[\'o\'][\'j\']","$[\'o\'][\'k\']"]'),
            ("$.a.*", d, "[5,3]", '["$[\'a\'][0]","$[\'a\'][1]"]'),
            ("$[*]", '"abc"', "[]", "[]"),
            ("$[*]", "{}", "[]", "[]"),
        ])(self)

    def test_r10_index(self):  # R10
        scenarios([
            ("$[1]", '["a","b"]', '["b"]', '["$[1]"]'),
            ("$[-2]", '["a","b"]', '["a"]', '["$[0]"]'),
            ("$[2]", '["a","b"]', "[]", "[]"),
            ("$[-3]", '["a","b"]', "[]", "[]"),
            ("$[ 1 ]", '["a","b"]', '["b"]', '["$[1]"]'),
            ("$[0]", '{"0":1}', "[]", "[]"),
            ("$[0]", '"abc"', "[]", "[]"),
            ("$[9007199254740991]", "[1]", "[]", "[]"),
            ("$[-9007199254740991]", "[1]", "[]", "[]"),
            *bad("$[01]", "$[-0]", "$[+1]", "$[1.0]", "$[1e2]", "$[- 1]", "$[0x1]", "$.0"),
        ])(self)

    def test_r11_slice(self):  # R11
        d = '["a","b","c","d","e","f","g"]'
        scenarios([
            ("$[1:3]", d, '["b","c"]', '["$[1]","$[2]"]'),
            ("$[5:]", d, '["f","g"]', '["$[5]","$[6]"]'),
            ("$[1:5:2]", d, '["b","d"]', '["$[1]","$[3]"]'),
            ("$[5:1:-2]", d, '["f","d"]', '["$[5]","$[3]"]'),
            ("$[::-1]", d, '["g","f","e","d","c","b","a"]', '["$[6]","$[5]","$[4]","$[3]","$[2]","$[1]","$[0]"]'),
            ("$[:]", d, d, '["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]'),
            ("$[::]", d, d, '["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]'),
            ("$[1:2:]", d, '["b"]', '["$[1]"]'),
            ("$[::2]", d, '["a","c","e","g"]', '["$[0]","$[2]","$[4]","$[6]"]'),
            ("$[-2:]", d, '["f","g"]', '["$[5]","$[6]"]'),
            ("$[:-2]", d, '["a","b","c","d","e"]', '["$[0]","$[1]","$[2]","$[3]","$[4]"]'),
            ("$[-1:-3:-1]", d, '["g","f"]', '["$[6]","$[5]"]'),
            ("$[3::-1]", d, '["d","c","b","a"]', '["$[3]","$[2]","$[1]","$[0]"]'),
            ("$[:2:-1]", d, '["g","f","e","d"]', '["$[6]","$[5]","$[4]","$[3]"]'),
            ("$[2:-10:-1]", d, '["c","b","a"]', '["$[2]","$[1]","$[0]"]'),
            ("$[-10:2]", d, '["a","b"]', '["$[0]","$[1]"]'),
            ("$[0:0]", d, "[]", "[]"),
            ("$[3:1]", d, "[]", "[]"),
            ("$[::0]", d, "[]", "[]"),
            ("$[10:20]", d, "[]", "[]"),
            ("$[1 : 2 : 1]", d, '["b"]', '["$[1]"]'),
            ("$[::9007199254740991]", d, '["a"]', '["$[0]"]'),
            ("$[::-9007199254740991]", d, '["g"]', '["$[6]"]'),
            ("$[-9007199254740991:9007199254740991]", d, d, '["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]'),
            ("$[1:3]", '{"a":1}', "[]", "[]"),
            ("$[1:3]", '"abcdef"', "[]", "[]"),
            *bad("$[1:2:3:4]", "$[:-0]", "$[01:2]", "$[1:2:0.5]"),
        ])(self)

    def test_r12_integer_range(self):  # R12
        scenarios([
            ("$[?@ == 9007199254740992]", "[1]", "[]", "[]"),
            *bad("$[9007199254740992]", "$[-9007199254740992]", "$[0:9007199254740992]", "$[-9007199254740992:]",
                 "$[::-9007199254740992]", "$[99999999999999999999999]", "$[?@[9007199254740992]]"),
        ])(self)


class Filters(unittest.TestCase):
    def test_r13_syntax(self):  # R13
        d = '[{"a":1,"b":2},{"a":2},{"b":3}]'
        ab = '[{"a":1,"b":2},{"a":2}]'
        scenarios([
            ("$[?@.a]", d, ab, '["$[0]","$[1]"]'),
            ("$[? @.a ]", d, ab, '["$[0]","$[1]"]'),
            ("$[?(@.a)]", d, ab, '["$[0]","$[1]"]'),
            ("$[?((@.a))]", d, ab, '["$[0]","$[1]"]'),
            ("$[?@.a==1]", d, '[{"a":1,"b":2}]', '["$[0]"]'),
            ("$[?1 == @.a]", d, '[{"a":1,"b":2}]', '["$[0]"]'),
            ("$[?!@.a]", d, '[{"b":3}]', '["$[2]"]'),
            ("$[?! @.a]", d, '[{"b":3}]', '["$[2]"]'),
            ("$[?!(@.a == 1)]", d, '[{"a":2},{"b":3}]', '["$[1]","$[2]"]'),
            ("$[?!(!@.a)]", d, ab, '["$[0]","$[1]"]'),
            ("$[?@.a&&@.b]", d, '[{"a":1,"b":2}]', '["$[0]"]'),
            ("$[?@.a == 2 || @.b == 3]", d, '[{"a":2},{"b":3}]', '["$[1]","$[2]"]'),
            ("$[?@.a\n==\n1]", d, '[{"a":1,"b":2}]', '["$[0]"]'),
            ("$[?@.a].b", d, "[2]", '["$[0][\'b\']"]'),
            *bad("$[?]", "$[@.a]", "$[?@.a ==]", "$[?== 1]", "$[?@.a = 1]", "$[?@.a === 1]", "$[?@.a <> 1]",
                 "$[?@.a =< 1]", "$[?@.a = = 1]", "$[?@.a == 1 == 1]", "$[?!!@.a]", "$[?!@.a == 1]",
                 "$[?(@.a) == 1]", "$[?@.a & @.b]", "$[?@.a | @.b]", "$[?@.a and @.b]", "$[?(@.a]", "$[?@.a)]",
                 "$[?()]", "$[?true]", "$[?false]", "$[?null]", "$[?1]", "$[?'a']", "$[?@ == [1]]",
                 "$[?@ == {}]", "$[?@.a + 1 == 2]", "$[?@.a == True]", "$[?@.a == 1 &&]", "$[?1 && @.a]",
                 "$[?@.a || 'x']"),
        ])(self)

    def test_r14_semantics(self):  # R14
        d = ('{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],'
             '"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}')
        scenarios([
            ("$.a[?@.b == 'kilo']", d, '[{"b":"kilo"}]', '["$[\'a\'][9]"]'),
            ("$.a[?@>3.5]", d, "[5,4,6]", '["$[\'a\'][1]","$[\'a\'][4]","$[\'a\'][5]"]'),
            ("$.a[?@.b]", d, '[{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]',
             '["$[\'a\'][6]","$[\'a\'][7]","$[\'a\'][8]","$[\'a\'][9]"]'),
            ("$[?@[?@.b]]", d, '[[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]]', '["$[\'a\']"]'),
            ("$.o[?@<3, ?@<3]", d, "[1,2,1,2]", '["$[\'o\'][\'p\']","$[\'o\'][\'q\']","$[\'o\'][\'p\']","$[\'o\'][\'q\']"]'),
            ("$.a[?@<2 || @.b == \"k\"]", d, '[1,{"b":"k"}]', '["$[\'a\'][2]","$[\'a\'][7]"]'),
            ("$.o[?@>1 && @<4]", d, "[2,3]", '["$[\'o\'][\'q\']","$[\'o\'][\'r\']"]'),
            ("$.a[?@.b == $.x]", d, "[3,5,1,2,4,6]",
             '["$[\'a\'][0]","$[\'a\'][1]","$[\'a\'][2]","$[\'a\'][3]","$[\'a\'][4]","$[\'a\'][5]"]'),
            ("$[?@ == 1]", "1", "[]", "[]"),
            ("$[?@ > 1]", '{"x":1,"y":2,"z":3}', "[2,3]", '["$[\'y\']","$[\'z\']"]'),
            ("$.a[?@ == $.n]", '{"a":[1,2,3],"n":2}', "[2]", '["$[\'a\'][1]"]'),
            ("$[?$.flag]", '{"flag":false,"v":1}', "[false,1]", '["$[\'flag\']","$[\'v\']"]'),
            ("$[?@[?@ > 2]]", "[[1,2],[3]]", "[[3]]", '["$[1]"]'),
            ("$[?@.a < @.b]", '[{"a":"x","b":1},{"a":[1],"b":[2]}]', "[]", "[]"),
        ])(self)

    def test_r15_existence(self):  # R15
        scenarios([
            ("$[?@]", '[0,false,null,"",[],{}]', '[0,false,null,"",[],{}]', '["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]"]'),
            ("$[?@.a]", '[{"a":false},{"a":null},{}]', '[{"a":false},{"a":null}]', '["$[0]","$[1]"]'),
            ("$[?!@.a]", '[{"a":false},{"a":null},{}]', "[{}]", '["$[2]"]'),
            ("$[?@..x]", '[{"y":{"x":1}},{"y":2}]', '[{"y":{"x":1}}]', '["$[0]"]'),
            ("$[?@[1:]]", '[[1],[1,2],"ab"]', "[[1,2]]", '["$[1]"]'),
        ])(self)

    def test_r16_literals(self):  # R16
        scenarios([
            ("$[?@ == 1e2]", '[100,100.0,"100",1]', "[100,100.0]", '["$[0]","$[1]"]'),
            ("$[?@ == 1E+2]", "[100]", "[100]", '["$[0]"]'),
            ("$[?@ == 1.5e-1]", "[0.15,1.5]", "[0.15]", '["$[0]"]'),
            ("$[?@ < -0.5]", "[-1,-0.5,0]", "[-1]", '["$[0]"]'),
            ("$[?@ == -0]", "[0,-0,0.0,1]", "[0,0,0.0]", '["$[0]","$[1]","$[2]"]'),
            ("$[?@ == 'it\\'s']", '["it\'s"]', '["it\'s"]', '["$[0]"]'),
            ("$[?@ == true]", '[true,"true",1]', "[true]", '["$[0]"]'),
            ("$[?@ == false]", "[false,0,null]", "[false]", '["$[0]"]'),
            ("$[?@ == null]", '[null,0,false,""]', "[null]", '["$[0]"]'),
            ("$[?@ < 1e400]", "[1]", "[1]", '["$[0]"]'),
            *bad("$[?@ == 01]", "$[?@ == +1]", "$[?@ == .5]", "$[?@ == 1.]", "$[?@ == 1e]", "$[?@ == 1.5e+]",
                 "$[?@ == - 1]", "$[?@ == NaN]", "$[?@ == Null]", '$[?@ == "abc]', "$[?@ == -]"),
        ])(self)

    def test_r17_singular(self):  # R17
        scenarios([
            ("$[?@ == 2]", "[1,2]", "[2]", '["$[1]"]'),
            ("$[?@[0] == 2]", "[[2],[3],2]", "[[2]]", '["$[0]"]'),
            ("$[?@[-1] == 3]", "[[2,3],[3,2]]", "[[2,3]]", '["$[0]"]'),
            ("$[?@.a.b == 1]", '[{"a":{"b":1}},{"a":1}]', '[{"a":{"b":1}}]', '["$[0]"]'),
            ("$[?@.a [0] == 1]", '[{"a":[1]}]', '[{"a":[1]}]', '["$[0]"]'),
            ("$[?@ == $]", "[1]", "[]", "[]"),
            ("$[?$.k == @]", '{"k":1,"m":1,"n":2}', "[1,1]", '["$[\'k\']","$[\'m\']"]'),
            ("$[?@[ 'a' ]]", '[{"a":1},{}]', '[{"a":1}]', '["$[0]"]'),
            *bad("$[?@.* == 1]", "$[?@..a == 1]", "$[?@[*] == 1]", "$[?@[0:1] == 1]", "$[?@['a','b'] == 1]",
                 "$[?@[0,1] == 1]", "$[?@[?@ > 1] == 1]", "$[?$..a == 1]", "$[?@[ 'a' ] == 1]", "$[?@[ 0 ] == 1]"),
        ])(self)

    def test_r18_comparison(self):  # R18
        doc = '{"obj":{"x":"y"},"arr":[2,3]}'
        all_v, all_p = '[{"x":"y"},[2,3]]', '["$[\'obj\']","$[\'arr\']"]'
        table = [
            ("$.absent1 == $.absent2", 1), ("$.absent1 <= $.absent2", 1), ("$.absent == 'g'", 0),
            ("$.absent1 != $.absent2", 0), ("$.absent != 'g'", 1), ("1 <= 2", 1), ("1 > 2", 0),
            ("13 == '13'", 0), ("'a' <= 'b'", 1), ("'a' > 'b'", 0), ("$.obj == $.arr", 0), ("$.obj != $.arr", 1),
            ("$.obj == $.obj", 1), ("$.obj != $.obj", 0), ("$.arr == $.arr", 1), ("$.arr != $.arr", 0),
            ("$.obj == 17", 0), ("$.obj != 17", 1), ("$.obj <= $.arr", 0), ("$.obj < $.arr", 0),
            ("$.obj <= $.obj", 1), ("$.arr <= $.arr", 1), ("1 <= $.arr", 0), ("1 >= $.arr", 0), ("1 > $.arr", 0),
            ("1 < $.arr", 0), ("true <= true", 1), ("true > true", 0), ("null >= null", 1), ("null < null", 0),
            ("false < true", 0), ("'ab' < 'abc'", 1), ("'' < 'a'", 1), ("'b' < 'abc'", 0), ("'B' < 'a'", 1),
            ("$.arr[0] == 2", 1), ("$.arr[0] == 2.0", 1),
        ]
        cases = [("$[?%s]" % c, doc, all_v if ok else "[]", all_p if ok else "[]") for c, ok in table]
        cases += [
            ("$[?@ < 'b']", '["a","b","c","",1,"B"]', '["a","","B"]', '["$[0]","$[3]","$[5]"]'),
            ("$[?@ > '\\uE000']", '["😀","a","\\uE000"]', '["😀"]', '["$[0]"]'),
            ("$[?@ >= 2]", '[1,2,3,"3",[3]]', "[2,3]", '["$[1]","$[2]"]'),
            ("$[?@ <= true]", "[false,true]", "[true]", '["$[1]"]'),
            ("$[?@.x == @.y]",
             '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":[1,2],"y":[2,1]},'
             '{"x":{"a":1},"y":{"a":1,"b":2}},{"x":1,"y":1.0},{"x":"1","y":1}]',
             '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":1,"y":1.0}]',
             '["$[0]","$[1]","$[4]"]'),
            ("$[?@.x == @.y]", "[{}]", "[{}]", '["$[0]"]'),
            ("$[?@.x != @.y]", "[{}]", "[]", "[]"),
            ("$[?@.x != 1]", '[{},{"x":1},{"x":2}]', '[{},{"x":2}]', '["$[0]","$[2]"]'),
            ("$[?@.x >= @.x]", '[{"x":{}},{"x":[]},{},{"x":null}]', '[{"x":{}},{"x":[]},{},{"x":null}]',
             '["$[0]","$[1]","$[2]","$[3]"]'),
            ("$[?@ == 9007199254740993]", "[9007199254740992]", "[9007199254740992]", '["$[0]"]'),
        ]
        scenarios(cases)(self)

    def test_r19_logic(self):  # R19
        d = '[{"a":1},{"b":1},{"b":1,"c":1}]'
        scenarios([
            ("$[?@.a || @.b && @.c]", d, '[{"a":1},{"b":1,"c":1}]', '["$[0]","$[2]"]'),
            ("$[?(@.a || @.b) && @.c]", d, '[{"b":1,"c":1}]', '["$[2]"]'),
            ("$[?@.c && @.b || @.a]", d, '[{"a":1},{"b":1,"c":1}]', '["$[0]","$[2]"]'),
            ("$[?!(@.a || @.c)]", d, '[{"b":1}]', '["$[1]"]'),
            ("$[?!@.a && !@.c]", d, '[{"b":1}]', '["$[1]"]'),
        ])(self)


class Functions(unittest.TestCase):
    def test_r20_r21_syntax_and_types(self):  # R20, R21
        scenarios([
            ("$[?length(@) == 1]", '["a","ab"]', '["a"]', '["$[0]"]'),
            ("$[?length( @ ) == 1]", '["a","ab"]', '["a"]', '["$[0]"]'),
            ("$[?length(@) < 3]", '["ab","abc",[1,2],{"a":1},5,null]', '["ab",[1,2],{"a":1}]', '["$[0]","$[2]","$[3]"]'),
            ("$[?count(@.*) == 1]", '[[1],[1,2],{"a":1},3]', '[[1],{"a":1}]', '["$[0]","$[2]"]'),
            ("$[?!match(@, 'a')]", '["a","b",1]', '["b",1]', '["$[1]","$[2]"]'),
            ("$[?match(@, 'a') && length(@) == 1]", '["a","aa",1]', '["a"]', '["$[0]"]'),
            ("$[?length(value(@.*)) == 2]", '[["ab"],["ab","c"],[[1,2]]]', '[["ab"],[[1,2]]]', '["$[0]","$[2]"]'),
            ("$[?match(length(@), '1')]", '["a"]', "[]", "[]"),
            ("$[?length('ab') == 2]", "[7,8]", "[7,8]", '["$[0]","$[1]"]'),
            ("$[?count(@) == count($)]", "[1]", "[1]", '["$[0]"]'),
            ("$[?match('abc', 'a.c')]", "[1,2]", "[1,2]", '["$[0]","$[1]"]'),
            ("$[?value(@..color) == \"red\"]", '[{"color":"red"}]', '[{"color":"red"}]', '["$[0]"]'),
            *bad("$[?length (@) == 1]", "$[?Length(@) == 1]", "$[?foo(@)]", "$[?bar(@.a) == 1]", "$[?_x(@)]",
                 "$[?length() == 1]", "$[?length(@, @) == 1]", "$[?count() == 0]", "$[?match(@)]",
                 "$[?search(@, 'a', 'b')]", "$[?value(@, @) == 1]", "$[?length(@ == 1]", "$.length(@)",
                 "$[?length(@.*) < 3]", "$[?count(1) == 1]", "$[?count('a') == 1]", "$[?count(length(@)) == 1]",
                 "$[?count(@.a == 1) == 1]", "$[?match(@.timezone, 'Europe/.*') == true]", "$[?value(@..color)]",
                 "$[?length(@)]", "$[?count(@)]", "$[?!length(@)]", "$[?length(match(@, 'a')) == 1]",
                 "$[?length(@.a == 1) == 1]", "$[?length((@.a)) == 1]", "$[?match(@.*, 'a')]",
                 "$[?match(@, @.*)]", "$[?count(value(@)) == 1]"),
        ])(self)

    def test_r22_length(self):  # R22
        scenarios([
            ("$[?length(@) == 3]", '["abc",[1,2,3],{"a":1,"b":2,"c":3},3,"ab",null]',
             '["abc",[1,2,3],{"a":1,"b":2,"c":3}]', '["$[0]","$[1]","$[2]"]'),
            ("$[?length(@) == 1]", '["😀","e\\u0301"]', '["😀"]', '["$[0]"]'),
            ("$[?length(@) == 0]", '["",[],{},0,null]', '["",[],{}]', '["$[0]","$[1]","$[2]"]'),
            ("$[?length(@) == length(@)]", '[1,"ab",[1]]', '[1,"ab",[1]]', '["$[0]","$[1]","$[2]"]'),
            ("$[?length(@) != 2]", '[true,"ab"]', "[true]", '["$[0]"]'),
            ("$[?length(1) == 1]", "[1]", "[]", "[]"),
        ])(self)

    def test_r23_count_r26_value(self):  # R23, R26
        scenarios([
            ("$[?count(@.*) == 2]", '[[1,2],{"a":1,"b":2},[1],"ab"]', '[[1,2],{"a":1,"b":2}]', '["$[0]","$[1]"]'),
            ("$[?count(@[0,0]) == 2]", "[[5],[]]", "[[5]]", '["$[0]"]'),
            ("$[?count(@) == 1]", "[1,null]", "[1,null]", '["$[0]","$[1]"]'),
            ("$[?count(@..*) > 2]", '[{"a":[1,2]},{"a":1}]', '[{"a":[1,2]}]', '["$[0]"]'),
            ("$[?count(@[?@ > 1]) == 2]", "[[1,2,3],[2],[0,5,6,7]]", "[[1,2,3]]", '["$[0]"]'),
            ("$[?count(@.a) == 0]", '[{"a":null},{}]', "[{}]", '["$[1]"]'),
            ("$[?value(@..color) == \"red\"]",
             '[{"color":"red"},{"x":{"color":"red"}},{"color":"red","y":{"color":"red"}},{"color":"blue"}]',
             '[{"color":"red"},{"x":{"color":"red"}}]', '["$[0]","$[1]"]'),
            ("$[?value(@.*) == 1]", '[[1],[1,1],{"k":1},[]]', '[[1],{"k":1}]', '["$[0]","$[2]"]'),
            ("$[?value(@.a) == value(@.b)]", '[{"a":1,"b":1},{"a":1},{}]', '[{"a":1,"b":1},{}]', '["$[0]","$[2]"]'),
        ])(self)

    def test_r24_r25_match_search(self):  # R24, R25
        scenarios([
            ("$[?match(@, 'a.c')]", '["abc","abcd","a\\nc","xabc",1]', '["abc"]', '["$[0]"]'),
            ("$[?match(@, '1')]", '[1,"1"]', '["1"]', '["$[1]"]'),
            ("$[?match(@.s, @.p)]", '[{"s":"aaa","p":"a+"},{"s":"b","p":"a+"},{"s":"a","p":1},{"s":"a","p":"("},{"s":"a"}]',
             '[{"s":"aaa","p":"a+"}]', '["$[0]"]'),
            ("$[?match(@, '(')]", '["("]', "[]", "[]"),
            ("$[?match(@, '')]", '["","a"]', '[""]', '["$[0]"]'),
            ("$[?match(@, 'a|bc')]", '["a","bc","abc","ac"]', '["a","bc"]', '["$[0]","$[1]"]'),
            ("$[?search(@, 'a.c')]", '["abc","abcd","a\\nc","xabc",1]', '["abc","abcd","xabc"]', '["$[0]","$[1]","$[3]"]'),
            ("$[?search(@, '')]", '["","a",1]', '["","a"]', '["$[0]","$[1]"]'),
            ("$[?search(@, 'x*')]", '["","abc"]', '["","abc"]', '["$[0]","$[1]"]'),
            ("$[?search(@, '.')]", '["","\\n","a"]', '["a"]', '["$[2]"]'),
            ("$[?search(@, '[')]", '["["]', "[]", "[]"),
        ])(self)

    def test_r27_iregexp_syntax(self):  # R27
        def m(fn, rx, s, ok):
            return ("$[?%s(@, '%s')]" % (fn, rx), json.dumps(s), json.dumps(s if ok else []),
                    json.dumps(["$[%d]" % i for i, x in enumerate(s) if ok]))
        cases = [
            m("match", "a\\\\.b", ["a.b"], True),
            m("match", "\\\\d", ["1"], False), m("match", "\\\\w", ["a"], False), m("search", "\\\\s", ["a b"], False),
            m("match", "\\\\u0041", ["A"], False), m("match", "\\\\$", ["$"], False),
            m("match", "a$", ["a$"], True), m("search", "^a", ["^ab"], True),
            m("match", "[]", ["[]"], False), m("match", "[^]", ["^"], False),
            m("match", "[a-]", ["-", "a"], True), m("match", "[-a]", ["-", "a"], True),
            m("match", "[^^]", ["x"], True), m("match", "[a-c-e]", ["a"], False), m("match", "[z-a]", ["m"], False),
            m("match", "[\\\\[\\\\]]", ["[", "]"], True), m("match", "a]", ["a]"], False),
            m("match", "a\\\\]", ["a]"], True), m("match", "a}", ["a}"], False), m("match", "a{", ["a{"], False),
            m("match", "a**", ["aa"], False), m("match", "a*?", ["aa"], False), m("match", "(?:a)", ["a"], False),
            m("match", "*a", ["a"], False), m("match", "(a", ["a"], False), m("match", "a)", ["a"], False),
            m("match", "a{,2}", ["a"], False), m("match", "a{2,1}", ["aa"], False), m("match", "a{}", ["a"], False),
            m("match", "a{2}{3}", ["aaaaaa"], False),
            m("match", "\\\\p{IsBasicLatin}", ["a"], False), m("match", "\\\\p{Lx}", ["a"], False),
            m("match", "\\\\p{l}", ["a"], False), m("match", "\\\\p{L&}", ["a"], False),
            m("match", "a\\\\-b", ["a-b"], True), m("match", "\\\\/", ["/"], False),
            m("match", "[--a]", ["a"], False), m("match", "[^-]", ["a"], True), m("match", "[a^]", ["^"], True),
        ]
        scenarios(cases)(self)
        scenarios(bad("$[?match(@, 'a\\.b')]"))(self)

    def test_r28_iregexp_semantics(self):  # R28
        scenarios([
            ("$[?match(@, 'a.c')]", '["abc","a\\nc","a\\rc","abcd","a😀c"]', '["abc","a😀c"]', '["$[0]","$[4]"]'),
            ("$[?match(@, '.')]", '["😀","ab",""]', '["😀"]', '["$[0]"]'),
            ("$[?match(@, '[a-c]+')]", '["abc","abd","","cab"]', '["abc","cab"]', '["$[0]","$[3]"]'),
            ("$[?match(@, '[^a-c]')]", '["a","d","\\n","dd"]', '["d","\\n"]', '["$[1]","$[2]"]'),
            ("$[?match(@, 'a\\\\nb')]", '["a\\nb","anb"]', '["a\\nb"]', '["$[0]"]'),
            ("$[?match(@, 'a\\nb')]", '["a\\nb","anb"]', '["a\\nb"]', '["$[0]"]'),
            ("$[?match(@, 'a\\\\tb')]", '["a\\tb","atb"]', '["a\\tb"]', '["$[0]"]'),
            ("$[?match(@, 'A')]", '["a","A"]', '["A"]', '["$[1]"]'),
            ("$[?match(@, '\\\\p{Lu}+')]", '["ABC","AbC","ÀÉ",""]', '["ABC","ÀÉ"]', '["$[0]","$[2]"]'),
            ("$[?match(@, '\\\\P{L}+')]", '["a1","12"," !"]', '["12"," !"]', '["$[1]","$[2]"]'),
            ("$[?match(@, '\\\\p{Nd}')]", '["3","٣","x","Ⅻ"]', '["3","٣"]', '["$[0]","$[1]"]'),
            ("$[?match(@, '\\\\p{N}')]", '["3","٣","x","Ⅻ"]', '["3","٣","Ⅻ"]', '["$[0]","$[1]","$[3]"]'),
            ("$[?match(@, '[\\\\p{Lu}0-9]+')]", '["A1","a1","Z9Z"]', '["A1","Z9Z"]', '["$[0]","$[2]"]'),
            ("$[?match(@, '[^\\\\p{L}]')]", '["a","1"]', '["1"]', '["$[1]"]'),
            ("$[?match(@, 'a{2}')]", '["a","aa","aaa"]', '["aa"]', '["$[1]"]'),
            ("$[?match(@, 'a{2,}')]", '["a","aa","aaa"]', '["aa","aaa"]', '["$[1]","$[2]"]'),
            ("$[?match(@, 'a{1,2}')]", '["a","aa","aaa"]', '["a","aa"]', '["$[0]","$[1]"]'),
            ("$[?match(@, 'a{0}')]", '["","a"]', '[""]', '["$[0]"]'),
            ("$[?match(@, 'ab?c')]", '["ac","abc","abbc"]', '["ac","abc"]', '["$[0]","$[1]"]'),
            ("$[?match(@, '(ab)+')]", '["abab","aba",""]', '["abab"]', '["$[0]"]'),
            ("$[?match(@, '()')]", '["","a"]', '[""]', '["$[0]"]'),
            ("$[?match(@, 'a|')]", '["","a","b"]', '["","a"]', '["$[0]","$[1]"]'),
            ("$[?match(@, 'x(a|b)*y')]", '["xy","xabbay","xacy"]', '["xy","xabbay"]', '["$[0]","$[1]"]'),
            ("$[?match(@, '(a*)*b')]", '["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"]', "[]", "[]"),
            ("$[?match(@, 'a{100000000}')]", '["aaa"]', "[]", "[]"),
        ])(self)


class Results(unittest.TestCase):
    def test_r29_normalized_paths(self):  # R29
        names = ('{"\\b":1,"\\f":2,"\\n":3,"\\r":4,"\\t":5,"\'":6,"\\\\":7,"\\u0000":8,"\\u001f":9,"\\"":10,'
                 '"/":11,"\\u007f":12,"é":13,"\\u000b":14,"\\u000e":15}')
        paths = ["$['\\b']", "$['\\f']", "$['\\n']", "$['\\r']", "$['\\t']", "$['\\'']", "$['\\\\']", "$['\\u0000']",
                 "$['\\u001f']", "$['\"']", "$['/']", "$['\u007f']", "$['é']", "$['\\u000b']", "$['\\u000e']"]
        scenarios([
            ("$[-3]", "[0,1,2,3,4]", "[2]", '["$[2]"]'),
            ("$.a.b[1:2]", '{"a":{"b":[0,1,2]}}', "[1]", '["$[\'a\'][\'b\'][1]"]'),
            ('$["\\u000B"]', '{"\\u000b":1}', "[1]", '["$[\'\\\\u000b\']"]'),
            ("$[12]", json.dumps(list(range(13))), "[12]", '["$[12]"]'),
            ("$.*", names, json.dumps(list(range(1, 16))), json.dumps(paths)),
            ("$..*", '{"a b":[{"c":1}]}', '[[{"c":1}],{"c":1},1]', '["$[\'a b\']","$[\'a b\'][0]","$[\'a b\'][0][\'c\']"]'),
        ])(self)

    def test_r30_order(self):  # R30
        scenarios([
            ("$.*", '{"b":1,"a":2,"1":3}', "[1,2,3]", '["$[\'b\']","$[\'a\']","$[\'1\']"]'),
            ("$[?@ > 0]", '{"z":1,"10":2,"2":3}', "[1,2,3]", '["$[\'z\']","$[\'10\']","$[\'2\']"]'),
            ("$..*", '{"y":{"q":1},"x":2}', '[{"q":1},2,1]', '["$[\'y\']","$[\'x\']","$[\'y\'][\'q\']"]'),
        ])(self)

    def test_r31_json_values(self):  # R31
        d = '{"a":null,"b":[null],"c":[{}],"null":1}'
        scenarios([
            ("$.a", d, "[null]", '["$[\'a\']"]'),
            ("$.a[0]", d, "[]", "[]"),
            ("$.b[?@]", d, "[null]", '["$[\'b\'][0]"]'),
            ("$.b[?@==null]", d, "[null]", '["$[\'b\'][0]"]'),
            ("$.c[?@.d==null]", d, "[]", "[]"),
            ("$.*", '{"a":1,"b":2,"a":3}', "[3,2]", '["$[\'a\']","$[\'b\']"]'),
            ("$.a", '{"a":1,"a":3}', "[3]", '["$[\'a\']"]'),
        ])(self)

    def test_r31_number_text(self):
        line = '{"id":"n","op":"query","input":{"query":"$[0]","document":[12345678901234567890123456789.5e300]}}'
        self.assertIn("12345678901234567890123456789.5e300", driver.handle_line(line))
        r = driver.handle_line('{"id":"n","op":"query","input":{"query":"$","document":[1.5e3,0.1,-0,1E400]}}')
        self.assertEqual(json.loads(r.replace("1E400", "1")), {"id": "n", "result": {"values": [[1500.0, 0.1, 0, 1]], "paths": ["$"]}})

    def test_r32_bookstore(self):  # R32
        store = {"store": {"book": [
            {"category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95},
            {"category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99},
            {"category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99},
            {"category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99}],
            "bicycle": {"color": "red", "price": 399}}}
        doc = json.dumps(store)
        b = store["store"]["book"]
        cases = [
            ("$..author", [x["author"] for x in b], ["$['store']['book'][%d]['author']" % i for i in range(4)]),
            ("$.store..price", [8.95, 12.99, 8.99, 22.99, 399],
             ["$['store']['book'][%d]['price']" % i for i in range(4)] + ["$['store']['bicycle']['price']"]),
            ("$..book[-1]", [b[3]], ["$['store']['book'][3]"]),
            ("$..book[?@.isbn]", [b[2], b[3]], ["$['store']['book'][2]", "$['store']['book'][3]"]),
            ("$..book[?@.price<10].title", ["Sayings of the Century", "Moby Dick"],
             ["$['store']['book'][0]['title']", "$['store']['book'][2]['title']"]),
            ("$.store.book[?@.category == 'fiction' && @.price > 20].title", ["The Lord of the Rings"],
             ["$['store']['book'][3]['title']"]),
            ("$.store[?length(@) == 2]", [store["store"]["bicycle"]], ["$['store']['bicycle']"]),
            ("$.store.book[?count(@.isbn) == 0].author", ["Nigel Rees", "Evelyn Waugh"],
             ["$['store']['book'][0]['author']", "$['store']['book'][1]['author']"]),
            ('$[?value(@..color) == "red"]', [store["store"]], ["$['store']"]),
            ("$.store.book[?search(@.author, 'R\\\\.')].title", ["The Lord of the Rings"],
             ["$['store']['book'][3]['title']"]),
            ("$..book[2].publisher", [], []),
        ]
        for q, vals, paths in cases:
            with self.subTest(q=q):
                r = ask(q, doc)["result"]
                self.assertEqual(canon(r["values"]), canon(vals))
                self.assertEqual(r["paths"], paths)
        self.assertEqual(len(ask("$..*", doc)["result"]["values"]), 27)


class Build(unittest.TestCase):
    def test_bu001_regen_json(self):  # REQ-BU-001
        with open(os.path.join(HERE, "REGEN.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        self.assertEqual(set(cfg), {"lang", "build", "test", "driver"})
        self.assertIn(cfg["lang"], ("ts", "py"))
        for k in ("build", "test", "driver"):
            v = cfg[k]
            self.assertTrue(isinstance(v, str) or (isinstance(v, dict) and isinstance(v.get("default"), str)))
        for v in (cfg["driver"].values() if isinstance(cfg["driver"], dict) else [cfg["driver"]]):
            self.assertRegex(v, r"^[A-Za-z0-9_.\-]+( [A-Za-z0-9_.\-]+)*$")

    def test_bu003_bu004_files_and_size(self):  # REQ-BU-003, REQ-BU-004
        total = 0
        for root, dirs, files in os.walk(HERE):
            dirs[:] = [d for d in dirs if d != ".git"]
            for fn in files:
                self.assertNotIn(fn, ("package-lock.json", "requirements.txt", "Pipfile", "poetry.lock"))
                if fn.endswith(".py") and not fn.startswith("test_"):
                    with open(os.path.join(root, fn), encoding="utf-8") as f:
                        total += sum(1 for ln in f if ln.strip())
            self.assertNotIn("node_modules", dirs)
        self.assertLessEqual(total, 3000)
        self.assertGreaterEqual(sys.version_info[:2], (3, 11))


if __name__ == "__main__":
    unittest.main()
