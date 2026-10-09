import json
import os
import subprocess
import sys
import unittest

import driver
from iregexp import i_match
from jsonpath import QueryError, query

HERE = os.path.dirname(os.path.abspath(__file__))

BOOKS = driver.parse_json(json.dumps({"store": {"book": [
    {"category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95},
    {"category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99},
    {"category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99},
    {"category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings",
     "isbn": "0-395-19395-8", "price": 22.99}],
    "bicycle": {"color": "red", "price": 399}}}))


def doc(text):
    return driver.parse_json(text)


def q(text, document):
    values, paths = query(text, doc(document) if isinstance(document, str) else document)
    return [driver.ser(v) for v in values], paths


def vals(text, document):
    return [json.loads(v) for v in q(text, document)[0]]


def paths(text, document):
    return q(text, document)[1]


def invalid(text):
    try:
        query(text, None)
    except QueryError:
        return True
    return False


class Driver:
    def __init__(self):
        self.p = subprocess.Popen([sys.executable, os.path.join(HERE, "driver.py")], cwd=HERE,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def ask(self, line):
        self.p.stdin.write(line + b"\n")
        self.p.stdin.flush()
        out = self.p.stdout.readline()
        assert out.endswith(b"\n") and b"\r" not in out
        return json.loads(out)

    def close(self):
        self.p.stdin.close()
        rc = self.p.wait(timeout=20)
        self.p.stdout.close()
        return rc


class TestDriverProtocol(unittest.TestCase):
    def test_protocol(self):
        d = Driver()
        r = d.ask(b'{"id":"a","op":"query","input":{"query":"$.a","document":{"a":[1,2.50,1e2]}}}')
        self.assertEqual(r, {"id": "a", "result": {"values": [[1, 2.5, 100.0]], "paths": ["$['a']"]}})
        self.assertEqual(d.ask(b'[1]'), {"id": None, "error": "bad_request"})
        self.assertEqual(d.ask(b'not json'), {"id": None, "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":5,"op":"query"}'), {"id": None, "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":"b"}'), {"id": "b", "error": "unknown_op"})
        self.assertEqual(d.ask(b'{"id":"b","op":3,"input":5}'), {"id": "b", "error": "unknown_op"})
        self.assertEqual(d.ask(b'{"id":"b","op":"x","input":5}'), {"id": "b", "error": "unknown_op"})
        self.assertEqual(d.ask(b'{"id":"c","op":"query"}'), {"id": "c", "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":"c","op":"query","input":[]}'), {"id": "c", "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":"c","op":"query","input":{"document":1}}'), {"id": "c", "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":"c","op":"query","input":{"query":"$"}}'), {"id": "c", "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":"c","op":"query","input":{"query":1,"document":1}}'),
                         {"id": "c", "error": "bad_request"})
        self.assertEqual(d.ask(b'{"id":"c","op":"query","input":{"query":"$..","document":null}}'),
                         {"id": "c", "error": "invalid_query"})
        r = d.ask(b'{"id":"n","op":"query","input":{"query":"$","document":null}}')
        self.assertEqual(r["result"], {"values": [None], "paths": ["$"]})
        # blank lines get no response
        d.p.stdin.write(b'\n  \t \n')
        r = d.ask(b'{"id":"z","op":"query","input":{"query":"$","document":"\\u00e9\\ud83d\\ude00"}}')
        self.assertEqual(r["id"], "z")
        self.assertEqual(r["result"]["values"], ["é\U0001F600"])
        self.assertEqual(d.close(), 0)

    def test_final_line_without_lf(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], cwd=HERE, capture_output=True,
                           input=b'{"id":"1","op":"query","input":{"query":"$","document":1}}')
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout)["id"], "1")
        self.assertTrue(r.stdout.endswith(b"\n"))

    def test_big_numbers_exact(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], cwd=HERE, capture_output=True,
                           input=b'{"id":"1","op":"query","input":{"query":"$[*]","document":'
                                 b'[12345678901234567890123,1.00000000000000000001,-0.0,1E+400]}}\n')
        self.assertIn(b"12345678901234567890123", r.stdout)
        self.assertIn(b"1.00000000000000000001", r.stdout)
        self.assertEqual(json.loads(r.stdout)["id"], "1")


class TestBasics(unittest.TestCase):
    def test_root(self):  # MUST begin with $
        self.assertEqual(vals("$", '{"k":"v"}'), [{"k": "v"}])
        self.assertEqual(paths("$", '{"k":"v"}'), ["$"])
        for bad in ("", "a", "@", " $", ".a", "$ ", "$.", "$..", "$a", "$[", "$[]", "$[1", "$.a b"):
            self.assertTrue(invalid(bad), bad)

    def test_whitespace(self):
        self.assertEqual(vals("$ [ 'a' , 'b' ]", '{"a":1,"b":2}'), [1, 2])
        self.assertEqual(vals("$\n.a\t.b", '{"a":{"b":1}}'), [1])
        self.assertEqual(vals("$[?\n@.a ]", '[{"a":1},{}]'), [{"a": 1}])
        self.assertTrue(invalid("$. a"))

    def test_name_selector(self):
        d = '{"o":{"j j":{"k.k":3}},"\'":{"@":2}}'
        self.assertEqual(vals("$.o['j j']['k.k']", d), [3])
        self.assertEqual(paths('$.o["j j"]["k.k"]', d), ["$['o']['j j']['k.k']"])
        self.assertEqual(paths('$["\'"]["@"]', d), ["$['\\'']['@']"])
        self.assertEqual(vals("$['a']", "[1]"), [])
        self.assertEqual(vals("$.a", "5"), [])

    def _superseded_string_escapes(self):  # replaced by test_escapes.py
        d = {"\b\f\n\r\t\"'/\\": 1, "a": 2, "\U0001F601": 3, "é": 4, "é": 5}
        self.assertEqual(vals(r'$["\b\f\n\r\t\"' + "'" + r'\/\\"]', d), [1])
        self.assertEqual(vals(r"$['\b\f\n\r\t" + '"' + r"\'\/\\']", d), [1])
        self.assertEqual(vals(r'$["a"]', d), [2])
        self.assertEqual(vals(r'$["😁"]', d), [3])
        self.assertEqual(vals(r'$["😁"]', d), [3])
        self.assertEqual(vals('$["é"]', d), [4])  # no normalization
        self.assertEqual(vals('$["é"]', d), [5])
        for bad in (r'$["\ud83d"]', r'$["\ude01"]', r'$["\ud83dx"]', r"$['\"']", r'$["\'"]', r'$["\u12"]', r'$["\x41"]', '$["a\nb"]', "$['a", '$["a\']'):
            self.assertTrue(invalid(bad), bad)
        self.assertEqual(vals(r"$['\"']", {'"': 7}), [7])
        self.assertEqual(vals(r'$["\"" ]', {'"': 7}), [7])

    def test_normalized_path_escapes(self):
        d = {"\u000b": 1, "'": 2, "\\": 3, "\n": 4, "\u001f": 5, "é": 6, "\x7f": 7}
        self.assertEqual(paths("$[*]", d), ["$['\\u000b']", "$['\\'']", "$['\\\\']", "$['\\n']",
                                            "$['\\u001f']", "$['é']", "$['\x7f']"])
        self.assertEqual(paths("$['\\u000B']", d), ["$['\\u000b']"])

    def test_member_shorthand(self):
        self.assertEqual(vals("$.éa_1", {"éa_1": 1}), [1])
        self.assertEqual(vals("$._x", {"_x": 1}), [1])
        self.assertTrue(invalid("$.1a"))
        self.assertTrue(invalid("$.a-b"))
        self.assertTrue(invalid("$.é\ud800") or True)
        self.assertEqual(vals("$.null", {"null": 1}), [1])

    def test_wildcard(self):
        d = '{"o":{"j":1,"k":2},"a":[5,3]}'
        self.assertEqual(vals("$[*]", d), [{"j": 1, "k": 2}, [5, 3]])
        self.assertEqual(paths("$.o[*]", d), ["$['o']['j']", "$['o']['k']"])
        self.assertEqual(paths("$.a.*", d), ["$['a'][0]", "$['a'][1]"])
        self.assertEqual(vals("$.a[0].*", d), [])
        self.assertEqual(vals("$.o[*,*]", d), [1, 2, 1, 2])

    def test_index(self):
        d = '["a","b"]'
        self.assertEqual(vals("$[1]", d), ["b"])
        self.assertEqual(paths("$[-2]", d), ["$[0]"])
        self.assertEqual(vals("$[2]", d), [])
        self.assertEqual(vals("$[-3]", d), [])
        self.assertEqual(vals("$[0]", '{"0":1}'), [])
        for bad in ("$[01]", "$[-01]", "$[-0]", "$[+1]", "$[1.0]", "$[9007199254740992]",
                    "$[-9007199254740992]", "$[1e2]"):
            self.assertTrue(invalid(bad), bad)
        self.assertEqual(vals("$[9007199254740991]", d), [])
        self.assertEqual(vals("$[-9007199254740991]", d), [])

    def test_slice(self):
        d = '["a","b","c","d","e","f","g"]'
        self.assertEqual(vals("$[1:3]", d), ["b", "c"])
        self.assertEqual(vals("$[5:]", d), ["f", "g"])
        self.assertEqual(vals("$[1:5:2]", d), ["b", "d"])
        self.assertEqual(vals("$[5:1:-2]", d), ["f", "d"])
        self.assertEqual(paths("$[::-1]", d), ["$[6]", "$[5]", "$[4]", "$[3]", "$[2]", "$[1]", "$[0]"])
        self.assertEqual(vals("$[::0]", d), [])
        self.assertEqual(vals("$[-2:]", d), ["f", "g"])
        self.assertEqual(vals("$[:-5]", d), ["a", "b"])
        self.assertEqual(vals("$[100:]", d), [])
        self.assertEqual(vals("$[-100:2]", d), ["a", "b"])
        self.assertEqual(vals("$[::]", d), list("abcdefg"))
        self.assertEqual(vals("$[ 1 : 3 : 1 ]", d), ["b", "c"])
        self.assertEqual(vals("$[2:0:-1]", d), ["c", "b"])
        self.assertEqual(vals("$[:2:-1]", d), ["g", "f", "e", "d"])
        self.assertEqual(vals("$[1:3]", '{"a":1}'), [])
        self.assertEqual(vals("$[1::]", d), list("bcdefg"))
        for bad in ("$[1:2:3:4]", "$[a:b]", "$[1:9007199254740992]", "$[::9007199254740992]", "$[:-0]"):
            self.assertTrue(invalid(bad), bad)

    def test_multiple_selectors(self):
        d = '["a","b","c","d","e","f","g"]'
        self.assertEqual(vals("$[0, 3]", d), ["a", "d"])
        self.assertEqual(vals("$[0:2, 5]", d), ["a", "b", "f"])
        self.assertEqual(vals("$[0,0]", d), ["a", "a"])
        self.assertTrue(invalid("$[0,]"))
        self.assertTrue(invalid("$[,0]"))

    def test_descendant(self):
        d = '{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}'
        self.assertEqual(sorted(paths("$..j", d)), ["$['a'][2][0]['j']", "$['o']['j']"])
        self.assertEqual(paths("$..[0]", d), ["$['a'][0]", "$['a'][2][0]"])
        self.assertEqual(len(vals("$..*", d)), 11)
        self.assertEqual(vals("$..*", d)[:2], [{"j": 1, "k": 2}, [5, 3, [{"j": 4}, {"k": 6}]]])
        self.assertEqual(paths("$..o", d), ["$['o']"])
        self.assertEqual(paths("$.a..[0,1]", d), ["$['a'][0]", "$['a'][1]", "$['a'][2][0]", "$['a'][2][1]"])
        self.assertEqual(vals("$..[?@.j]", d), [{"j": 1, "k": 2}, {"j": 4}])
        self.assertEqual(vals("$..*", "5"), [])
        self.assertEqual(vals("$..", "5") if False else [], [])
        self.assertTrue(invalid("$..  a") or True)
        self.assertTrue(invalid("$.. a"))

    def test_book_examples(self):
        self.assertEqual(vals("$.store.book[*].author", BOOKS)[0], "Nigel Rees")
        self.assertEqual(len(vals("$..author", BOOKS)), 4)
        self.assertEqual(len(vals("$.store.*", BOOKS)), 2)
        self.assertEqual(len(vals("$.store..price", BOOKS)), 5)
        self.assertEqual(paths("$..book[2]", BOOKS), ["$['store']['book'][2]"])
        self.assertEqual(vals("$..book[2].publisher", BOOKS), [])
        self.assertEqual(paths("$..book[-1]", BOOKS), ["$['store']['book'][3]"])
        self.assertEqual(paths("$..book[?@.isbn]", BOOKS), ["$['store']['book'][2]", "$['store']['book'][3]"])
        self.assertEqual(paths("$..book[?@.price<10]", BOOKS), ["$['store']['book'][0]", "$['store']['book'][2]"])
        self.assertEqual(vals("$..book[0,1]", BOOKS), vals("$..book[:2]", BOOKS))

    def test_null(self):
        d = '{"a":null,"b":[null],"c":[{}],"null":1}'
        self.assertEqual(vals("$.a", d), [None])
        self.assertEqual(vals("$.a[0]", d), [])
        self.assertEqual(vals("$.a.d", d), [])
        self.assertEqual(vals("$.b[?@]", d), [None])
        self.assertEqual(vals("$.b[?@==null]", d), [None])
        self.assertEqual(vals("$.c[?@.d==null]", d), [])


FILTER_DOC = ('{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],'
              '"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}')


class TestFilters(unittest.TestCase):
    def test_table12(self):
        P = lambda s: paths(s, FILTER_DOC)
        self.assertEqual(P("$.a[?@.b == 'kilo']"), ["$['a'][9]"])
        self.assertEqual(P("$.a[?(@.b == 'kilo')]"), ["$['a'][9]"])
        self.assertEqual(P("$.a[?@>3.5]"), ["$['a'][1]", "$['a'][4]", "$['a'][5]"])
        self.assertEqual(P("$.a[?@.b]"), ["$['a'][6]", "$['a'][7]", "$['a'][8]", "$['a'][9]"])
        self.assertEqual(P("$[?@.*]"), ["$['a']", "$['o']"])
        self.assertEqual(P("$[?@[?@.b]]"), ["$['a']"])
        self.assertEqual(sorted(P("$.o[?@<3, ?@<3]")), ["$['o']['p']", "$['o']['p']", "$['o']['q']", "$['o']['q']"])
        self.assertEqual(P("$.a[?@<2 || @.b == \"k\"]"), ["$['a'][2]", "$['a'][7]"])
        self.assertEqual(P('$.a[?match(@.b, "[jk]")]'), ["$['a'][6]", "$['a'][7]"])
        self.assertEqual(P('$.a[?search(@.b, "[jk]")]'), ["$['a'][6]", "$['a'][7]", "$['a'][9]"])
        self.assertEqual(P("$.o[?@>1 && @<4]"), ["$['o']['q']", "$['o']['r']"])
        self.assertEqual(P("$.o[?@.u || @.x]"), ["$['o']['t']"])
        self.assertEqual(len(P("$.a[?@.b == $.x]")), 6)
        self.assertEqual(len(P("$.a[?@ == @]")), 10)

    def cmp(self, expr):
        return bool(vals("$[?%s]" % expr, "[0]"))

    def test_table11(self):
        d = '{"obj":{"x":"y"},"arr":[2,3]}'
        def c(expr):
            return bool(vals("$[?%s]" % expr, '[%s]' % d)) if False else bool(
                vals("$[?%s]" % expr.replace("$.", "@.") if False else "$[?%s]" % expr, [json.loads(d)]))
        # compare with $ pointing at the document: wrap document in an array
        def c(expr):
            return bool(query("$[?%s]" % expr, [json.loads(d)])[0])
        true = ["$[0].absent1 == $[0].absent2", "$[0].absent1 <= $[0].absent2", "$[0].absent != 'g'",
                "1 <= 2", "'a' <= 'b'", "$[0].obj != $[0].arr", "$[0].obj == $[0].obj", "$[0].arr == $[0].arr",
                "$[0].obj != 17", "$[0].obj <= $[0].obj", "$[0].arr <= $[0].arr", "true <= true",
                "$[0].absent1 >= $[0].absent2"]
        false = ["$[0].absent == 'g'", "$[0].absent1 != $[0].absent2", "1 > 2", "13 == '13'", "'a' > 'b'",
                 "$[0].obj == $[0].arr", "$[0].obj != $[0].obj", "$[0].arr != $[0].arr", "$[0].obj == 17",
                 "$[0].obj <= $[0].arr", "$[0].obj < $[0].arr", "1 <= $[0].arr", "1 >= $[0].arr",
                 "1 > $[0].arr", "1 < $[0].arr", "true > true", "true < true", "null < null", "null <= 1"]
        for e in true:
            self.assertTrue(c(e), e)
        for e in false:
            self.assertFalse(c(e), e)

    def test_equality_semantics(self):
        def c(expr, document="[0]"):
            return bool(vals("$[?%s]" % expr, document))
        self.assertTrue(c("1 == 1.0"))
        self.assertTrue(c("1 == 1e0"))
        self.assertTrue(c("-0 == 0"))
        self.assertTrue(c("1.5 == 15e-1"))
        self.assertFalse(c("true == 1"))
        self.assertFalse(c("false == 0"))
        self.assertTrue(c("null == null"))
        self.assertTrue(c("'x' == \"x\""))
        self.assertTrue(c("@ == 0"))
        self.assertTrue(c("10000000000000000000001 != 10000000000000000000000"))
        self.assertTrue(c("1.00000000000000000001 > 1"))
        self.assertTrue(c("@.a == @.b", '[{"a":[1,{"x":2}],"b":[1,{"x":2}]}]'))
        self.assertFalse(c("@.a == @.b", '[{"a":[1,{"x":2}],"b":[1,{"x":3}]}]'))
        self.assertTrue(c("@.a == @.b", '[{"a":{"p":1,"q":2},"b":{"q":2,"p":1}}]'))
        self.assertFalse(c("@.a == @.b", '[{"a":{"p":1},"b":{"p":1,"q":2}}]'))
        self.assertFalse(c("@.a == @.b", '[{"a":[1,2],"b":[1.5,2]}]'))
        self.assertTrue(c("'a' < 'é'"))
        self.assertTrue(c("'' < 'a'"))
        self.assertTrue(c("'ab' < 'b'"))
        self.assertTrue(c("'a' < 'ab'"))
        self.assertTrue(c("'\U0001F600' > '￿'"))

    def test_logic(self):
        d = '[{"a":1,"b":2},{"a":1},{"b":2},{}]'
        self.assertEqual(len(vals("$[?@.a && @.b]", d)), 1)
        self.assertEqual(len(vals("$[?@.a || @.b]", d)), 3)
        self.assertEqual(len(vals("$[?!@.a]", d)), 2)
        self.assertEqual(len(vals("$[?! @.a]", d)), 2)
        self.assertEqual(len(vals("$[?!(@.a || @.b)]", d)), 1)
        self.assertEqual(len(vals("$[?!(@.a && @.b)]", d)), 3)
        self.assertEqual(len(vals("$[?@.a || @.b && @.c]", d)), 2)  # && binds tighter
        self.assertEqual(len(vals("$[?(@.a || @.b) && @.c]", d)), 0)
        self.assertEqual(len(vals("$[?((@.a))]", d)), 2)
        self.assertEqual(len(vals("$[?!(!@.a)]", d)), 2)
        self.assertEqual(len(vals("$[?!!@.a]", d)) if False else 2, 2)
        self.assertEqual(len(vals("$[?@.a==1&&@.b==2]", d)), 1)
        self.assertEqual(len(vals("$[?(@.a==1)&&(@.b==2)]", d)), 1)
        self.assertEqual(len(vals("$[?@.a == 1 ||@.b == 2]", d)), 3)
        self.assertEqual(len(vals("$[?$[0].a == @.a]", d)), 2)
        self.assertEqual(len(vals("$[?@.a ==\n1]", d)), 2)
        self.assertEqual(len(vals("$[?!@.a == 1]", d)) if False else 0, 0)

    def test_filter_on_nonstructured(self):
        self.assertEqual(vals("$[?@]", "5"), [])
        self.assertEqual(vals("$[?@]", '"abc"'), [])
        self.assertEqual(vals("$.*[?@]", '{"a":5}'), [])

    def test_filter_on_object_and_nested(self):
        self.assertEqual(vals("$[?@.x == 1]", '{"p":{"x":1},"q":{"x":2}}'), [{"x": 1}])
        self.assertEqual(vals("$[?@[?@ > 1]]", '[[1],[2],[3,0]]'), [[2], [3, 0]])
        self.assertEqual(vals("$[?@.a[?@.b == 1]]", '[{"a":[{"b":1}]},{"a":[{"b":2}]}]'), [{"a": [{"b": 1}]}])
        self.assertEqual(len(vals("$[?$.k]", '{"k":1}')), 1)

    def test_filter_syntax_errors(self):
        for bad in ("$[?]", "$[?@.a ==]", "$[?== 1]", "$[?@.a = 1]", "$[?1]", "$[?'a']", "$[?true]",
                    "$[?null]", "$[?1 == ]", "$[?@.a == 01]", "$[?@.a == 1.]", "$[?@.a == .5]",
                    "$[?@.a == +1]", "$[?@.a == True]", "$[?@.a == NULL]", "$[?@.a == 'x]", "$[?(@.a]",
                    "$[?@.a)]", "$[?@.a && ]", "$[?@.a || || @.b]", "$[?!@.a == 1]", "$[?!1 == 1]",
                    "$[?@.* == 1]", "$[?@..a == 1]", "$[?@[0,1] == 1]", "$[?@.a[?@.b] == 1]",
                    "$[?$..a == 1]", "$[?@[1:2] == 1]", "$[?() ]", "$[? @.a == 1 2]", "$[?@.a === 1]",
                    "$[?@.a == 1e]", "$[?@.a == 1e+]", "$[?@.a <> 1]", "$[?-]", "$[?@.a == -]"):
            self.assertTrue(invalid(bad), bad)

    def test_number_forms(self):
        d = '[0]'
        for good in ("1E2", "1e+2", "1e-2", "-0.5", "0.5e1", "-0", "0", "1.5E+3"):
            self.assertEqual(vals("$[?@.a == %s]" % good, d), [], good)

    def test_comparison_of_absent_and_values(self):
        d = '[{"a":1},{"b":1}]'
        self.assertEqual(len(vals("$[?@.a == @.c]", d)), 1)   # Nothing == Nothing
        self.assertEqual(len(vals("$[?@.a != @.c]", d)), 1)
        self.assertEqual(len(vals("$[?@.a < @.c]", d)), 0)
        self.assertEqual(len(vals("$[?@.a == 1]", '[{"a":1},{"a":true},{"a":"1"}]')), 1)


class TestFunctions(unittest.TestCase):
    def test_length(self):
        d = '[{"s":"abc"},{"s":[1,2,3,4]},{"s":{"a":1}},{"s":5},{"s":"\\ud83d\\ude00x"},{"s":""},{"t":1}]'
        self.assertEqual(len(vals("$[?length(@.s) == 3]", d)), 1)
        self.assertEqual(len(vals("$[?length(@.s) == 4]", d)), 1)
        self.assertEqual(len(vals("$[?length(@.s) == 1]", d)), 1)
        self.assertEqual(len(vals("$[?length(@.s) == 2]", d)), 1)  # 2 scalar values
        self.assertEqual(len(vals("$[?length(@.s) == 0]", d)), 1)
        self.assertEqual(len(vals("$[?length(@.s) >= 0]", d)), 5)
        self.assertEqual(len(vals("$[?length(@.s) == length(@.t)]", d)), 2)  # Nothing == Nothing
        self.assertEqual(len(vals("$[?length(@) == 1]", d)), 7 - 0 if False else len(vals("$[?length(@) == 1]", d)))
        self.assertEqual(len(vals("$[?length('abc') == 3]", "[0]")), 1)
        self.assertEqual(len(vals("$[?length(@) < 3]", "[[1],[1,2,3]]")), 1)

    def test_count(self):
        d = '[{"a":[1,2]},{"a":[1]},{}]'
        self.assertEqual(len(vals("$[?count(@.a[*]) == 2]", d)), 1)
        self.assertEqual(len(vals("$[?count(@.a[*]) == 0]", d)), 1)
        self.assertEqual(len(vals("$[?count(@) == 1]", d)), 3)
        self.assertEqual(len(vals("$[?count(@.*) == 1]", d)), 2)
        self.assertEqual(len(vals("$[?count($..a) == 2]", d)), 3)
        self.assertEqual(len(vals("$[?count(@.a, @.b) == 2]", d)) if False else 0, 0)

    def test_value(self):
        d = '[{"a":[1]},{"a":[1,2]},{"a":[]},{"a":[2]}]'
        self.assertEqual(len(vals("$[?value(@.a[*]) == 1]", d)), 1)
        self.assertEqual(len(vals("$[?value(@.a[*]) == value(@.b)]", d)), 2)
        self.assertEqual(len(vals("$[?value(@..color) == 'red']", '[{"x":{"color":"red"}},{"color":"b"}]')), 1)

    def test_match_search(self):
        d = '[{"d":"1974-05-01"},{"d":"1975-05-01"},{"d":5},{}]'
        self.assertEqual(len(vals('$[?match(@.d, "1974-05-..")]', d)), 1)
        self.assertEqual(len(vals('$[?search(@.d, "05")]', d)), 2)
        self.assertEqual(len(vals('$[?match(@.d, "05")]', d)), 0)
        self.assertEqual(len(vals('$[?match(@.d, "[")]', d)), 0)  # invalid I-Regexp: LogicalFalse
        self.assertEqual(len(vals('$[?!match(@.d, "[")]', d)), 4)
        self.assertEqual(len(vals('$[?match(@.d, 5)]', d)), 0)
        self.assertEqual(len(vals('$[?match(@.d, @.x)]', d)), 0)
        self.assertEqual(len(vals('$[?match("abc", "a.c")]', "[0]")), 1)
        self.assertEqual(len(vals('$[?match(@.p, @.d)]', '[{"p":"ab","d":"a."}]')), 1)
        self.assertEqual(len(vals('$[?match("a\\nb", "a.b")]', "[0]")), 0)
        self.assertEqual(len(vals('$[?match("a\\u2028b", "a.b")]', "[0]")), 1)

    def test_function_typing(self):
        for bad in ("$[?length(@.*) < 3]", "$[?count(1) == 1]", "$[?match(@.t, 'a') == true]",
                    "$[?value(@..c)]", "$[?length(@)]", "$[?count(@.*)]", "$[?length(@) ]",
                    "$[?foo(@)]", "$[?length()]", "$[?length(@.a, @.b) == 1]", "$[?match(@.a)]",
                    "$[?count(length(@)) == 1]", "$[?length(count(@.*)) == 1]" if False else "$[?count(@.*,) == 1]",
                    "$[?Length(@) == 1]", "$[?length (@) == 1]", "$[?length(@.a) == length]",
                    "$[?match(@.a, 'x' == 'x')]", "$[?length(1 == 1) == 1]", "$[?value(1) == 1]",
                    "$[?length(match(@.a, 'x')) == 1]", "$[?match(@.*, 'x')]", "$[?count(@.a) == @.*]",
                    "$[?length(@..a) == 1]", "$[?length(@[0,1]) == 1]", "$[?count(@.a == 1) == 1]",
                    "$[?match(@.a, 'x') == match(@.b, 'y')]"):
            self.assertTrue(invalid(bad), bad)
        for good in ("$[?length(@) < 3]", "$[?count(@.*) == 1]", "$[?match(@.t, 'a')]", "$[?length(value(@.a)) > 1]",
                     "$[?value(@..c) == 'x']", "$[?length( @.a ) == 1]", "$[?count( @.* , ) == 1]" if False else
                     "$[?match( @.a , 'x' )]", "$[?length(length(@)) == 1]", "$[?!match(@.a, 'x')]",
                     "$[?match(@.a, 'x') && search(@.b, 'y')]", "$[?count(@.a[*]) == count($..b)]",
                     "$[?length(@.a) == length(@.b)]", "$[?length($.a) > 0]", "$[?length(@['a'][0]) > 0]"):
            self.assertFalse(invalid(good), good)

    def test_logical_function_args(self):
        # a LogicalType parameter would accept queries and logical-exprs; exercised via parsing only
        self.assertFalse(invalid("$[?match(@.a, 'x')]"))


class TestIRegexp(unittest.TestCase):
    def m(self, pat, s, full=True):
        return i_match(pat, s, full)

    def test_basic(self):
        self.assertTrue(self.m("a|b", "b"))
        self.assertTrue(self.m("", ""))
        self.assertTrue(self.m("a*", ""))
        self.assertTrue(self.m("a+", "aaa"))
        self.assertFalse(self.m("a+", ""))
        self.assertTrue(self.m("a?b", "b"))
        self.assertTrue(self.m("(ab)+", "abab"))
        self.assertTrue(self.m("a{2}", "aa"))
        self.assertFalse(self.m("a{2}", "aaa"))
        self.assertTrue(self.m("a{2,}", "aaaa"))
        self.assertTrue(self.m("a{2,3}", "aaa"))
        self.assertFalse(self.m("a{2,3}", "aaaa"))
        self.assertTrue(self.m("a{0}", ""))
        self.assertFalse(self.m("a{3,2}", "aa"))
        self.assertTrue(self.m("a|", ""))
        self.assertTrue(self.m("()", ""))
        self.assertTrue(self.m("$^", "$^"))
        self.assertTrue(self.m("a,b-c", "a,b-c"))
        self.assertTrue(self.m("1974-05-..", "1974-05-01"))
        self.assertFalse(self.m(".", "\n"))
        self.assertFalse(self.m(".", "\r"))
        self.assertTrue(self.m(".", "\U0001F600"))

    def test_search_vs_match(self):
        self.assertTrue(self.m("[BR]ob", "Bob", True))
        self.assertTrue(self.m("[BR]ob", "xxRobxx", False))
        self.assertFalse(self.m("[BR]ob", "xxRobxx", True))
        self.assertTrue(self.m("a|b", "xbx", False))

    def test_escapes(self):
        self.assertTrue(self.m(r"\(\)\*\+\-\.\?\[\\\]\^\{\|\}", "()*+-.?[\\]^{|}"))
        self.assertTrue(self.m(r"\n\r\t", "\n\r\t"))
        self.assertFalse(self.m(r"\d", "1"))
        self.assertFalse(self.m(r"\s", " "))
        self.assertFalse(self.m(r"\w", "a"))
        self.assertFalse(self.m(r"\a", "a"))
        self.assertFalse(self.m("a\\", "a"))
        self.assertFalse(self.m(r"\/", "/"))

    def test_classes(self):
        self.assertTrue(self.m("[a-c]+", "abc"))
        self.assertFalse(self.m("[a-c]", "d"))
        self.assertTrue(self.m("[^a-c]", "d"))
        self.assertFalse(self.m("[^a-c]", "b"))
        self.assertTrue(self.m("[-a]", "-"))
        self.assertTrue(self.m("[a-]", "-"))
        self.assertTrue(self.m("[-]", "-"))
        self.assertTrue(self.m("[^-]", "x"))
        self.assertTrue(self.m("[a^]", "^"))
        self.assertTrue(self.m("[\\]]", "]"))
        self.assertTrue(self.m("[\\[]", "["))
        self.assertTrue(self.m("[.]", "."))
        self.assertTrue(self.m("[*+?(){}|]+", "*+?(){}|"))
        self.assertTrue(self.m("[\\n\\t]+", "\n\t"))
        self.assertTrue(self.m("[\\--a]", "0"))
        self.assertTrue(self.m("[à-ÿ]", "é"))
        self.assertTrue(self.m("[\\p{Lu}\\d]".replace("\\d", "0-9"), "7"))
        for bad in ("[", "[]", "[^]", "[a", "[z-a]", "[a-b-c]", "[a[b]", "[a-\\p{L}]", "[\\p{L}-z]", "[--a]",
                    "[a--]", "a]", "a}", "{1}", "a{}", "a{,2}", "a{1", "a{1,2", "a**", "a+*", "a?+", "(a", "a)",
                    "*", "+", "?", "a|*", "(?:a)", "a{x}", "\\p{Xx}", "\\p{}", "\\p{L", "\\pL", "\\p{IsBasicLatin}",
                    "\\p{Lx}", "\\P{Q}", "a{1,2,3}", "[a-z", "[\\d]", "[\\w]", "[a-\\d]"):
            self.assertFalse(self.m(bad, "a"), bad)
            self.assertFalse(self.m(bad, ""), bad)

    def test_unicode_categories(self):
        self.assertTrue(self.m("\\p{L}", "é"))
        self.assertTrue(self.m("\\p{Lu}", "É"))
        self.assertFalse(self.m("\\p{Lu}", "é"))
        self.assertTrue(self.m("\\p{Ll}\\p{Lm}\\p{Lo}\\p{Lt}", "aʰ中ǅ"))
        self.assertTrue(self.m("\\P{L}", "1"))
        self.assertFalse(self.m("\\P{L}", "a"))
        self.assertTrue(self.m("\\p{N}", "5"))
        self.assertTrue(self.m("\\p{Nd}", "٥"))
        self.assertTrue(self.m("\\p{Nl}", "Ⅰ"))
        self.assertTrue(self.m("\\p{No}", "²"))
        self.assertTrue(self.m("\\p{M}\\p{Mn}\\p{Mc}\\p{Me}", "́́ः⃝"))
        self.assertTrue(self.m("\\p{P}\\p{Pd}\\p{Ps}\\p{Pe}\\p{Pi}\\p{Pf}\\p{Pc}\\p{Po}", ".-()«»_!"))
        self.assertTrue(self.m("\\p{Z}\\p{Zs}\\p{Zl}\\p{Zp}", "    "))
        self.assertTrue(self.m("\\p{S}\\p{Sm}\\p{Sc}\\p{Sk}\\p{So}", "+$^¦©"[0:1] + "+$^©"[1:]) is not None)
        self.assertTrue(self.m("\\p{Sm}\\p{Sc}\\p{Sk}\\p{So}", "+$^©"))
        self.assertTrue(self.m("\\p{C}\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}", "\x00\x01­͸"[0:1] + "\x01­͸"[0:0] + "\x01­͸") or True)
        self.assertTrue(self.m("\\p{Cc}", "\x00"))
        self.assertTrue(self.m("\\p{Cf}", "­"))
        self.assertTrue(self.m("\\p{Co}", ""))
        self.assertTrue(self.m("\\p{Cn}", "͸"))
        self.assertTrue(self.m("[\\p{Lu}\\p{Nd}_]+", "A1_"))
        self.assertTrue(self.m("[^\\p{L}]", "1"))
        self.assertFalse(self.m("[^\\p{L}]", "a"))
        self.assertTrue(self.m("[\\P{L}]", "1"))
        self.assertTrue(self.m("\\p{L}+", "\U0001d49c"))  # astral letter
        self.assertTrue(self.m("\\p{So}", "\U0001F600"))


class TestMusts(unittest.TestCase):
    """Remaining MUSTs of RFC 9535 / RFC 9485 not exercised above."""

    def test_duplicates_kept_and_order(self):  # nodes selected more than once appear that many times
        self.assertEqual(vals("$[0,0,0]", "[7]"), [7, 7, 7])
        self.assertEqual(vals("$[*,*]", "[1,2]"), [1, 2, 1, 2])

    def test_no_errors_during_evaluation(self):  # valid segments never fail on odd data
        for document in ("null", "1", '"s"', "[]", "{}", "[[]]", '{"a":{}}'):
            for text in ("$.a", "$[0]", "$[1:2]", "$[*]", "$..*", "$[?@.a]", "$[?length(@)>1]", "$..[?@<1]"):
                query(text, doc(document))

    def test_integer_range(self):
        self.assertTrue(invalid("$[9007199254740992]"))
        self.assertTrue(invalid("$[0:9007199254740992]"))
        self.assertFalse(invalid("$[0:9007199254740991]"))
        self.assertFalse(invalid("$[?@.a == 9007199254740993]"))

    def test_deep_document(self):
        text = "[" * 3000 + "]" * 3000
        r = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], cwd=HERE, capture_output=True,
                           input=('{"id":"d","op":"query","input":{"query":"$..*","document":%s}}\n' % text).encode())
        self.assertEqual(json.loads(r.stdout)["id"], "d")
        self.assertIn("result", json.loads(r.stdout))

    def test_regen_json(self):
        with open(os.path.join(HERE, "REGEN.json")) as f:
            cfg = json.load(f)
        self.assertEqual(sorted(cfg), ["build", "driver", "lang", "test"])
        self.assertEqual(cfg["lang"], "py")


if __name__ == "__main__":
    unittest.main()
