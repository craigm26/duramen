import json
import os
import subprocess
import sys
import unittest
from decimal import Decimal

import iregexp
import jsonpath
import driver

HERE = os.path.dirname(os.path.abspath(__file__))


def q(query, doc):
    segs = jsonpath.parse(query)
    return jsonpath.evaluate(segs, doc)


def vals(query, doc):
    return q(query, doc)[0]


def invalid(query):
    try:
        jsonpath.parse(query)
    except jsonpath.QueryError:
        return True
    return False


BOOKS = {"store": {"book": [
    {"category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": Decimal("8.95")},
    {"category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": Decimal("12.99")},
    {"category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": Decimal("8.99")},
    {"category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": Decimal("22.99")},
], "bicycle": {"color": "red", "price": 399}}}


class RootAndSegments(unittest.TestCase):
    def test_root(self):  # root identifier MUST begin every query
        self.assertEqual(q("$", {"k": "v"}), ([{"k": "v"}], ["$"]))
        for bad in ["", "a", "@", ".a", " $", "$ ", "$.", "$..", "$...a", "$.a b"]:
            self.assertTrue(invalid(bad), bad)

    def test_whitespace_between_segments(self):
        self.assertEqual(vals("$ .a\n[ 'b' ]\t.c", {"a": {"b": {"c": 1}}}), [1])
        self.assertTrue(invalid("$. a"))
        self.assertTrue(invalid("$.. a"))

    def test_dot_and_bracket(self):
        self.assertEqual(vals("$.store.book[0].title", BOOKS), ["Sayings of the Century"])
        self.assertEqual(vals("$['store']['bicycle']['color']", BOOKS), ["red"])

    def test_shorthand_names(self):
        self.assertEqual(vals("$.é_1", {"é_1": 5}), [5])
        self.assertTrue(invalid("$.1a"))
        self.assertTrue(invalid("$.-a"))

    def test_nodelist_order_and_duplicates(self):
        self.assertEqual(vals("$[0,0,1]", ["a", "b"]), ["a", "a", "b"])
        self.assertEqual(vals("$[0:2,5]", list("abcdefg")), ["a", "b", "f"])

    def test_child_segment_example(self):
        self.assertEqual(vals("$.a[*].b", {"a": [{"b": 0}, {"b": 1}, {"c": 2}]}), [0, 1])

    def test_empty_result_not_error(self):
        self.assertEqual(q("$.a.d", {"a": None}), ([], []))
        self.assertEqual(q("$.a[0]", {"a": None}), ([], []))
        self.assertEqual(q("$.x[5]", {"x": [1]}), ([], []))


class NameSelector(unittest.TestCase):
    def test_names_and_paths(self):
        doc = {"o": {"j j": {"k.k": 3}}, "'": {"@": 2}}
        self.assertEqual(q("$.o['j j']", doc), ([{"k.k": 3}], ["$['o']['j j']"]))
        self.assertEqual(q('$.o["j j"]["k.k"]', doc), ([3], ["$['o']['j j']['k.k']"]))
        self.assertEqual(q('$["\'"]["@"]', doc), ([2], ["$['\\'']['@']"]))

    def test_escapes(self):
        doc = {"\b\f\n\r\t\"'/\\": 1, "A": 2, "\U0001f601": 3, "\u000b": 4}
        self.assertEqual(vals(r"""$['\b\f\n\r\t"\'\/\\']""", doc), [1])
        self.assertEqual(vals(r'''$["\b\f\n\r\t\"'\/\\"]''', doc), [1])
        self.assertEqual(vals(r"$['A']", doc), [2])
        self.assertEqual(vals(r"$['😁']", doc), [3])
        self.assertEqual(vals(r"$['😁']", doc), [3])
        self.assertEqual(q(r'$["\u000B"]', doc), ([4], ["$['\\u000b']".lower().replace("\\u000b", "\\u000b")]))

    def test_invalid_strings(self):
        for bad in [r"$['\x']", r"$['\u12']", r"$['\ud800']", r"$['\udc00']", r"$['\ud800A']",
                    r'$["\\\'"]'.replace("\\\\", "\\")[:0] + "$['a", "$['a\nb']", "$[\"a'\\\"]",
                    r"$['\"']", r'$["\'"]', "$[a]", "$['a' 'b']", "$[]", "$[,]", "$['a',]"]:
            self.assertTrue(invalid(bad), bad)

    def test_no_normalization(self):
        # MUST compare as identical scalar sequences: precomposed != decomposed
        self.assertEqual(vals("$['é']", {"é": 1}), [])
        self.assertEqual(vals("$['é']", {"é": 1}), [1])

    def test_non_object(self):
        self.assertEqual(vals("$['a']", [1]), [])
        self.assertEqual(vals("$['a']", "a"), [])

    def test_lone_surrogate_in_query_invalid(self):
        self.assertTrue(invalid("$['\ud800']"))


class Wildcard(unittest.TestCase):
    def test_wildcard(self):
        doc = {"o": {"j": 1, "k": 2}, "a": [5, 3]}
        self.assertEqual(q("$[*]", doc)[1], ["$['o']", "$['a']"])
        self.assertEqual(q("$.o[*]", doc), ([1, 2], ["$['o']['j']", "$['o']['k']"]))
        self.assertEqual(q("$.a[*]", doc), ([5, 3], ["$['a'][0]", "$['a'][1]"]))
        self.assertEqual(vals("$.o[*, *]", doc), [1, 2, 1, 2])
        self.assertEqual(vals("$.a.*.x", doc), [])
        self.assertEqual(vals("$[*]", 5), [])


class IndexSelector(unittest.TestCase):
    def test_index(self):
        self.assertEqual(q("$[1]", ["a", "b"]), (["b"], ["$[1]"]))
        self.assertEqual(q("$[-2]", ["a", "b"]), (["a"], ["$[0]"]))
        self.assertEqual(vals("$[2]", ["a", "b"]), [])
        self.assertEqual(vals("$[-3]", ["a", "b"]), [])
        self.assertEqual(vals("$[0]", {"0": 1}), [])

    def test_index_syntax(self):
        for bad in ["$[01]", "$[-01]", "$[-0]", "$[1.0]", "$[+1]", "$[1e2]", "$[ ]"]:
            self.assertTrue(invalid(bad), bad)

    def test_index_range(self):  # I-JSON range MUST be enforced
        self.assertFalse(invalid("$[9007199254740991]"))
        self.assertFalse(invalid("$[-9007199254740991]"))
        self.assertTrue(invalid("$[9007199254740992]"))
        self.assertTrue(invalid("$[-9007199254740992]"))
        self.assertTrue(invalid("$[0:9007199254740992]"))
        self.assertTrue(invalid("$[::-9007199254740992]"))
        self.assertTrue(invalid("$[9007199254740992:]"))


class Slice(unittest.TestCase):
    A = list("abcdefg")

    def test_examples(self):
        self.assertEqual(vals("$[1:3]", self.A), ["b", "c"])
        self.assertEqual(q("$[5:]", self.A), (["f", "g"], ["$[5]", "$[6]"]))
        self.assertEqual(vals("$[1:5:2]", self.A), ["b", "d"])
        self.assertEqual(vals("$[5:1:-2]", self.A), ["f", "d"])
        self.assertEqual(vals("$[::-1]", self.A), list("gfedcba"))

    def test_edge(self):
        self.assertEqual(vals("$[::0]", self.A), [])
        self.assertEqual(vals("$[-3:]", self.A), ["e", "f", "g"])
        self.assertEqual(vals("$[:-5]", self.A), ["a", "b"])
        self.assertEqual(vals("$[100:]", self.A), [])
        self.assertEqual(vals("$[-100:2]", self.A), ["a", "b"])
        self.assertEqual(vals("$[2:-100:-1]", self.A), ["c", "b", "a"])
        self.assertEqual(vals("$[:]", self.A), self.A)
        self.assertEqual(vals("$[1:2:]", self.A), ["b"])
        self.assertEqual(vals("$[ 1 : 3 : 1 ]", self.A), ["b", "c"])
        self.assertEqual(vals("$[1:3]", {"a": 1}), [])

    def test_syntax(self):
        for bad in ["$[1:2:3:4]", "$[a:b]", "$[1::2::]", "$[:::]"]:
            self.assertTrue(invalid(bad), bad)


class Filters(unittest.TestCase):
    def test_basic(self):
        doc = {"a": [3, 5, 1, 2, 4, 6, {"b": "j"}, {"b": "k"}, {"b": {}}, {"b": "kilo"}],
               "o": {"p": 1, "q": 2, "r": 3, "s": 5, "t": {"u": 6}}, "e": "f"}
        self.assertEqual(q("$.a[?@.b == 'kilo']", doc), ([{"b": "kilo"}], ["$['a'][9]"]))
        self.assertEqual(vals("$.a[?(@.b == 'kilo')]", doc), [{"b": "kilo"}])
        self.assertEqual(vals("$.a[?@>3.5]", doc), [5, 4, 6])
        self.assertEqual(len(vals("$.a[?@.b]", doc)), 4)
        self.assertEqual(q("$[?@.*]", doc)[1], ["$['a']", "$['o']"])
        self.assertEqual(q("$[?@[?@.b]]", doc)[1], ["$['a']"])
        self.assertEqual(vals("$.o[?@<3, ?@<3]", doc), [1, 2, 1, 2])
        self.assertEqual(vals("$.a[?@<2 || @.b == \"k\"]", doc), [1, {"b": "k"}])
        self.assertEqual(vals("$.o[?@>1 && @<4]", doc), [2, 3])
        self.assertEqual(vals("$.o[?@.u || @.x]", doc), [{"u": 6}])
        self.assertEqual(len(vals("$.a[?@.b == $.x]", doc)), 6)
        self.assertEqual(len(vals("$.a[?@ == @]", doc)), 10)
        self.assertEqual(vals("$.a[?!@.b && @ > 4]", doc), [5, 6])
        self.assertEqual(vals("$.a[?!(@ > 1 || @.b)]", doc), [1])
        self.assertEqual(vals("$.a[?@.b == 'k' || (@ == 3 && @ < 4)]", doc), [3, {"b": "k"}])

    def test_filter_on_primitives(self):
        self.assertEqual(vals("$[?@]", 5), [])
        self.assertEqual(vals("$.a[?@]", {"a": "str"}), [])

    def test_comparison_table(self):
        doc = {"obj": {"x": "y"}, "arr": [2, 3]}
        cases = {
            "$.absent1 == $.absent2": True, "$.absent1 <= $.absent2": True,
            "$.absent == 'g'": False, "$.absent1 != $.absent2": False,
            "$.absent != 'g'": True, "1 <= 2": True, "1 > 2": False, "13 == '13'": False,
            "'a' <= 'b'": True, "'a' > 'b'": False, "$.obj == $.arr": False,
            "$.obj != $.arr": True, "$.obj == $.obj": True, "$.obj != $.obj": False,
            "$.arr == $.arr": True, "$.arr != $.arr": False, "$.obj == 17": False,
            "$.obj != 17": True, "$.obj <= $.arr": False, "$.obj < $.arr": False,
            "$.obj <= $.obj": True, "$.arr <= $.arr": True, "1 <= $.arr": False,
            "1 >= $.arr": False, "1 > $.arr": False, "1 < $.arr": False,
            "true <= true": True, "true > true": False,
        }
        for expr, want in cases.items():
            got = bool(vals("$.z[?%s]" % expr, dict(doc, z=[0])))
            self.assertEqual(got, want, expr)

    def test_equality_details(self):
        self.assertEqual(vals("$[?@ == 1]", [1, Decimal("1.0"), True, "1", [1]]), [1, Decimal("1.0")])
        self.assertEqual(vals("$[?@ == 1.0]", [1, 2]), [1])
        self.assertEqual(vals("$[?@ == 1e2]", [100]), [100])
        self.assertEqual(vals("$[?@ == true]", [1, True]), [True])
        self.assertEqual(vals("$[?@ == null]", [None, 0, False]), [None])
        self.assertEqual(vals("$[?@ == [1,2]]".replace("[1,2]", "$.k"), [0]), [])
        doc = {"k": {"a": [1, {"b": None}]}, "l": {"a": [1, {"b": None}]}, "m": {"a": [1, {"b": 0}]}}
        self.assertEqual(vals("$[?@ == $.k]", doc), [doc["k"], doc["l"]])
        self.assertEqual(vals("$[?@.a[1].b == null]", doc), [doc["k"], doc["l"]])

    def test_ordering(self):
        self.assertEqual(vals("$[?@ < 'b']", ["a", "b", 1, ""]), ["a", ""])
        self.assertEqual(vals("$[?@ >= 2]", [1, 2, 3, "3"]), [2, 3])
        self.assertEqual(vals("$[?@ < 'ab']", ["a", "aa", "b"]), ["a", "aa"])
        self.assertEqual(vals("$[?@ > '\U0001f600']", ["￿"]), [])

    def test_syntax_errors(self):
        for bad in ["$[?]", "$[?@.a ==]", "$[?== 1]", "$[?1]", "$[?'a']", "$[?true]", "$[?@.a = 1]",
                    "$[?(@.a]", "$[?@.a)]", "$[?!@.a == 1]", "$[?@.a && ]", "$[?@.a | @.b]",
                    "$[?@ == 01]", "$[?@ == 1.]", "$[?@ == .5]", "$[?@ == +1]", "$[?@ == TRUE]",
                    "$[?@ == True]", "$[?@.* == 1]", "$[?@..a == 1]", "$[?$[*] == 1]",
                    "$[?@[0:1] == 1]", "$[?@[0,1] == 1]", "$[?@['a','b'] == 1]",
                    "$[?@ == 1 == 1]", "$[?@.a !! 1]", "$[?!]", "$[?()]", "$[?(@.a) == 1]",
                    "$[?@ == nul]", "$[?@ == 'a]", "$[?foo(@)]", "$[?@ ==1e]"]:
            self.assertTrue(invalid(bad), bad)

    def test_filter_whitespace(self):
        self.assertEqual(vals("$[? @ == 1 ]", [1]), [1])
        self.assertEqual(vals("$[?(  @ == 1  )]", [1]), [1])
        self.assertEqual(vals("$[?@\n==\t1\r&&\n@ == 1]", [1]), [1])
        self.assertEqual(vals("$[?! (@ == 2)]", [1]), [1])
        self.assertEqual(vals("$[?!\t@.a]", [{}]), [{}])

    def test_abs_query_in_filter(self):
        doc = {"x": 2, "a": [1, 2, 3]}
        self.assertEqual(vals("$.a[?@ == $.x]", doc), [2])
        self.assertEqual(vals("$.a[?$.x]", doc), [1, 2, 3])
        self.assertEqual(vals("$.a[?$.nope]", doc), [])

    def test_singular_query_in_comparison(self):
        doc = [{"a": {"b": [10, 20]}}]
        self.assertEqual(vals("$[?@.a.b[1] == 20]", doc), doc)
        self.assertEqual(vals("$[?@.a['b'][-1] == 20]", doc), doc)
        self.assertEqual(vals("$[?@ .a .b[0] == 10]", doc), doc)

    def test_precedence(self):
        # && binds tighter than ||
        self.assertEqual(vals("$[?@ == 1 || @ == 2 && @ == 3]", [1, 2, 3]), [1])
        self.assertEqual(vals("$[?(@ == 1 || @ == 2) && @ == 2]", [1, 2, 3]), [2])


class Functions(unittest.TestCase):
    def test_length(self):
        doc = ["ab", "\U0001f600\U0001f600", [1, 2, 3], {"a": 1}, 5, None, True]
        self.assertEqual(vals("$[?length(@) == 2]", doc), ["ab", "\U0001f600\U0001f600"])
        self.assertEqual(vals("$[?length(@) == 3]", doc), [[1, 2, 3]])
        self.assertEqual(vals("$[?length(@) == 1]", doc), [{"a": 1}])
        self.assertEqual(vals("$[?length(@) < 100]", doc), doc[:4])
        self.assertEqual(vals("$[?length(@.x) == length($[0].x)]", [{"x": "ab"}]), [{"x": "ab"}])
        self.assertEqual(vals("$[?length(@) >= 0]", doc[4:]), [])

    def test_count(self):
        doc = [{"a": [1, 2]}, {"a": []}, {}]
        self.assertEqual(vals("$[?count(@.a[*]) == 2]", doc), [doc[0]])
        self.assertEqual(vals("$[?count(@.a[*]) == 0]", doc), doc[1:])
        self.assertEqual(vals("$[?count(@) == 1]", doc), doc)
        self.assertEqual(vals("$[?count(@..*) > 1]", doc), [doc[0]])

    def test_value(self):
        doc = [{"a": [1]}, {"a": [1, 2]}, {"a": []}]
        self.assertEqual(vals("$[?value(@.a[*]) == 1]", doc), [doc[0]])
        self.assertEqual(vals("$[?value(@.a[*]) == value(@.a[0])]", doc), [doc[0], doc[2]])
        self.assertEqual(vals("$[?value(@..color) == 'red']", [{"x": {"color": "red"}}]),
                         [{"x": {"color": "red"}}])
        self.assertEqual(vals("$[?length(value(@.a[*])) == 1]", [{"a": ["x"]}]), [{"a": ["x"]}])

    def test_match_search(self):
        doc = {"a": [{"b": "j"}, {"b": "k"}, {"b": {}}, {"b": "kilo"}, {"b": 1}]}
        self.assertEqual(vals('$.a[?match(@.b, "[jk]")]', doc), [{"b": "j"}, {"b": "k"}])
        self.assertEqual(vals('$.a[?search(@.b, "[jk]")]', doc),
                         [{"b": "j"}, {"b": "k"}, {"b": "kilo"}])
        self.assertEqual(vals("$[?match(@, 'a.c')]", ["abc", "abcd", "a\nc", "a\rc"]), ["abc"])
        self.assertEqual(vals("$[?match(@, 'a(')]", ["a"]), [])  # invalid regexp -> false
        self.assertEqual(vals("$[?search(@, 'a(')]", ["a"]), [])
        self.assertEqual(vals("$[?match(@, @)]", ["(", 1]), [])
        self.assertEqual(vals("$[?match(@.x, 'a')]", [{"x": "a"}, {}]), [{"x": "a"}])
        self.assertEqual(vals("$[?!match(@, 'a')]", ["a", "b", 1]), ["b", 1])
        self.assertEqual(vals("$[?match(@.d, '1974-05-..')]", [{"d": "1974-05-23"}]), [{"d": "1974-05-23"}])
        self.assertEqual(vals("$[?search(@.a, '[BR]ob')]", [{"a": "xRobx"}]), [{"a": "xRobx"}])

    def test_wellTyped(self):
        for good in ["$[?length(@) < 3]", "$[?count(@.*) == 1]", "$[?match(@.timezone, 'Europe/.*')]",
                     "$[?value(@..color) == \"red\"]", "$[?length('abc') == 3]",
                     "$[?match(@.a, 'x') && count(@.*) > 0]", "$[?!match(@.a, 'x')]",
                     "$[?count($..a) == 1]", "$[?length(@ .a) == 1]", "$[?length( @ ) == 1 ]",
                     "$[?match(value(@.a), 'x')]", "$[?length(length(@)) == 1]"]:
            self.assertFalse(invalid(good), good)
        for bad in ["$[?length(@.*) < 3]", "$[?count(1) == 1]",
                    "$[?match(@.timezone, 'Europe/.*') == true]", "$[?value(@..color)]",
                    "$[?length(@)]", "$[?count(@.*)]", "$[?length()]", "$[?length(@, @)]",
                    "$[?match(@.a)]", "$[?count(@.a) == length(@..a)]",
                    "$[?length(1 == 1) == 1]", "$[?count('a') == 1]", "$[?match(@.a, 'x') == false]",
                    "$[?true == match(@.a, 'x')]", "$[?length (@) == 1]", "$[?Length(@) == 1]",
                    "$[?length(@ ==) ]", "$[?count(length(@)) == 1]", "$[?length(count(@.*) ) == 1 && ]",
                    "$[?match(@.a, 'x',)]", "$[?match(,)]", "$[?nosuch(@)]", "$[?value(1)]",
                    "$[?length(!@.a) == 1]", "$[?match(@.*, 'a')]", "$[?match(@, $..a)]"]:
            self.assertTrue(invalid(bad), bad)


class Descendant(unittest.TestCase):
    DOC = {"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}

    def test_examples(self):
        r = q("$..j", self.DOC)
        self.assertEqual(sorted(r[1]), sorted(["$['o']['j']", "$['a'][2][0]['j']"]))
        self.assertEqual(q("$..[0]", self.DOC)[1].count("$['a'][0]"), 1)
        self.assertEqual(sorted(q("$..[0]", self.DOC)[1]), sorted(["$['a'][0]", "$['a'][2][0]"]))
        self.assertEqual(len(vals("$..*", self.DOC)), 11)
        self.assertEqual(vals("$..o", self.DOC), [{"j": 1, "k": 2}])
        self.assertEqual(q("$.a..[0, 1]", self.DOC),
                         ([5, 3, {"j": 4}, {"k": 6}], ["$['a'][0]", "$['a'][1]", "$['a'][2][0]", "$['a'][2][1]"]))

    def test_order(self):  # nodes are visited before their descendants; arrays in order
        paths = q("$..*", self.DOC)[1]
        self.assertLess(paths.index("$['a']"), paths.index("$['a'][0]"))
        self.assertLess(paths.index("$['a'][1]"), paths.index("$['a'][2]"))
        self.assertLess(paths.index("$['a'][2]"), paths.index("$['a'][2][0]"))
        self.assertLess(paths.index("$['a'][2][0]"), paths.index("$['a'][2][1]"))
        self.assertLess(paths.index("$['a'][2][1]"), paths.index("$['a'][2][0]['j']"))
        self.assertLess(paths.index("$['a'][2][0]['j']"), paths.index("$['a'][2][1]['k']"))

    def test_duplicates_kept(self):
        self.assertEqual(vals("$..[0,0]", [[1]]), [[1], [1], 1, 1])

    def test_filter_in_descendant(self):
        self.assertEqual(vals("$..[?@.j]", self.DOC), [{"j": 1, "k": 2}, {"j": 4}])
        self.assertEqual(vals("$.store..price", BOOKS)[0], Decimal("8.95"))
        self.assertEqual(len(vals("$.store..price", BOOKS)), 5)
        self.assertEqual(vals("$..book[2].author", BOOKS), ["Herman Melville"])
        self.assertEqual(vals("$..book[2].publisher", BOOKS), [])
        self.assertEqual(vals("$..book[-1].title", BOOKS), ["The Lord of the Rings"])
        self.assertEqual(len(vals("$..book[?@.isbn]", BOOKS)), 2)
        self.assertEqual(len(vals("$..book[?@.price<10]", BOOKS)), 2)
        self.assertEqual(vals("$.store.book[*].author", BOOKS)[1], "Evelyn Waugh")

    def test_deep_document(self):
        doc = cur = []
        for _ in range(3000):
            nxt = []
            cur.append(nxt)
            cur = nxt
        self.assertEqual(len(vals("$..*", doc)), 3000)

    def test_bad(self):
        for bad in ["$..", "$.. a", "$..[", "$..'a'", "$...*"]:
            self.assertTrue(invalid(bad), bad)


class NullAndPaths(unittest.TestCase):
    def test_null(self):
        doc = {"a": None, "b": [None], "c": [{}], "null": 1}
        self.assertEqual(q("$.a", doc), ([None], ["$['a']"]))
        self.assertEqual(vals("$.a[0]", doc), [])
        self.assertEqual(vals("$.b[?@]", doc), [None])
        self.assertEqual(vals("$.b[?@==null]", doc), [None])
        self.assertEqual(vals("$.c[?@.d==null]", doc), [])
        self.assertEqual(vals("$.null", doc), [1])

    def test_normalized(self):
        self.assertEqual(q("$[-3]", [1, 2, 3, 4, 5])[1], ["$[2]"])
        self.assertEqual(q("$.a.b[1:2]", {"a": {"b": [1, 2, 3]}})[1], ["$['a']['b'][1]"])
        self.assertEqual(q('$["\\u000B"]', {"\u000b": 1})[1], ["$['\\u000b']"])
        self.assertEqual(q('$["\\u0061"]', {"a": 1})[1], ["$['a']"])
        d = {"\u0000\u001f\u007f ": 1, "\b\f\n\r\t'\\": 2, "é\U0001f600": 3}
        self.assertEqual(q("$[*]", d)[1], [
            "$['\\u0000\\u001f\u007f ']", "$['\\b\\f\\n\\r\\t\\'\\\\']", "$['é\U0001f600']"])


class IRegexp(unittest.TestCase):
    def m(self, p, s):
        return iregexp.matches(p, s, True)

    def test_valid_and_invalid(self):
        for ok in ["", "a|b", "a*", "a+?".replace("+?", "+"), "a?", "a{2}", "a{2,}", "a{2,3}",
                   "(a|b)*c", "[a-z]", "[^a-z]", "[-a]", "[a-]", "[\\p{L}\\d]".replace("\\d", "0-9"),
                   "\\p{Lu}", "\\P{Nd}", "[\\p{L}]", "\\(\\)\\*\\+\\-\\.\\?\\[\\\\\\]\\^\\{\\|\\}",
                   "\\n\\r\\t", "[\\n\\]]", "$^", ",-", "()", "a||b", "[^^]", "[a-c-]", "[--]".replace("--", "-"),
                   "é", "\U0001f600+", "\\p{Cn}", "\\p{Sc}", "[a^]"]:
            self.assertIsNotNone(iregexp.compile_regexp(ok), ok)
        for bad in ["(", ")", "a)", "[", "[]", "[^]", "]", "}", "{", "a{", "a{}", "a{,2}", "a{2,1}",
                    "*", "+a", "a**", "a+*", "\\d", "\\w", "\\s", "\\a", "\\p", "\\p{}", "\\p{Foo}",
                    "\\p{Cs}", "\\p{IsBasicLatin}", "[z-a]", "[a-\\p{L}]", "[\\p{L}-z]", "[a-b-c]", "[[]",                    "a{1,2,3}", "a{ 1}", "\\/", "\\u0041", "[\\d]", "(?:a)", "a|*", "\\Pl", "\\p{lu}"]:
            self.assertIsNone(iregexp.compile_regexp(bad), bad)

    def test_semantics(self):
        self.assertTrue(self.m("a.c", "abc"))
        self.assertFalse(self.m("a.c", "a\nc"))
        self.assertTrue(self.m("a.c", "a c"))
        self.assertTrue(self.m("(ab)+", "ababab"))
        self.assertFalse(self.m("(ab)+", "aba"))
        self.assertTrue(self.m("a{2,3}", "aaa"))
        self.assertFalse(self.m("a{2,3}", "aaaa"))
        self.assertTrue(self.m("a{0}", ""))
        self.assertTrue(self.m("", ""))
        self.assertFalse(self.m("", "a"))
        self.assertTrue(self.m("a|", ""))
        self.assertTrue(self.m("[^a-c]", "d"))
        self.assertFalse(self.m("[^a-c]", "b"))
        self.assertTrue(self.m("\\p{Lu}\\p{Ll}+", "Hello"))
        self.assertTrue(self.m("\\p{Nd}", "٣"))
        self.assertFalse(self.m("\\P{Nd}", "5"))
        self.assertTrue(self.m("[\\p{L}\\p{Nd}]+", "abé٣"))
        self.assertTrue(self.m("\\p{Sc}", "$"))
        self.assertTrue(self.m("^$", "^$"))
        self.assertTrue(self.m(".", "\U0001f600"))
        self.assertFalse(self.m(".", "\U0001f600\U0001f600"))
        self.assertTrue(self.m("[\U0001f600-\U0001f64f]", "\U0001f601"))
        self.assertTrue(self.m("[-]", "-"))
        self.assertTrue(self.m("[a-]", "-"))
        self.assertTrue(self.m("[\\^]", "^"))
        self.assertTrue(self.m("[a^]", "^"))
        self.assertTrue(self.m("[\\p{P}]", "!"))
        self.assertTrue(self.m("\\p{Zs}", " "))
        self.assertTrue(self.m("\\p{Cc}", "\u0001"))

    def test_search_vs_match(self):
        self.assertTrue(iregexp.matches("b+", "abbc", False))
        self.assertFalse(iregexp.matches("b+", "abbc", True))
        self.assertTrue(iregexp.matches("", "abc", False))
        self.assertFalse(iregexp.matches("x", "abc", False))

    def test_no_catastrophic_backtracking(self):
        self.assertFalse(self.m("(a*)*b", "a" * 5000))
        self.assertFalse(self.m("(a|aa)+$", "a" * 3000 + "b"))
        self.assertTrue(self.m("(a{1,50}){1,50}", "a" * 100))


class DriverTests(unittest.TestCase):
    def run_driver(self, lines):
        data = "".join(l + "\n" for l in lines).encode("utf-8")
        p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], input=data,
                           capture_output=True, cwd=HERE, timeout=60)
        self.assertEqual(p.returncode, 0)
        self.assertNotIn(b"\r", p.stdout)
        self.assertTrue(p.stdout == b"" or p.stdout.endswith(b"\n"))
        return [json.loads(l) for l in p.stdout.decode("utf-8").split("\n") if l]

    def req(self, rid, query, doc):
        return json.dumps({"id": rid, "op": "query", "input": {"query": query, "document": doc}})

    def test_query_op(self):
        out = self.run_driver([self.req("a", "$.x[*]", {"x": [1, "s", None]})])
        self.assertEqual(out, [{"id": "a", "result": {"values": [1, "s", None], "paths": ["$['x'][0]", "$['x'][1]", "$['x'][2]"]}}])

    def test_order_and_blank_lines(self):
        out = self.run_driver([self.req("1", "$", 1), "", "   ", "\t \t", self.req("2", "$", 2)])
        self.assertEqual([o["id"] for o in out], ["1", "2"])

    def test_error_order(self):
        L = self.run_driver([
            "not json", "[1]", '"s"', "null", '{"op":"query"}', '{"id":5,"op":"query"}',
            '{"id":"a"}', '{"id":"b","op":5}', '{"id":"c","op":"other"}',
            '{"id":"d","op":"query"}', '{"id":"e","op":"query","input":5}',
            '{"id":"f","op":"query","input":{"document":1}}',
            '{"id":"g","op":"query","input":{"query":5,"document":1}}',
            '{"id":"h","op":"query","input":{"query":"$"}}',
            '{"id":"i","op":"query","input":{"query":"$[","document":1}}',
            '{"id":"j","op":"query","input":{"query":"$","document":null}}',
            '{"id":"k","op":"other","input":5}',
            '{"id":"l","op":"query","input":{"query":"$[","document":1}, "x": NaN}',
        ])
        self.assertEqual(L[0], {"id": None, "error": "bad_request"})
        for i in range(1, 6):
            self.assertEqual(L[i], {"id": None, "error": "bad_request"}, i)
        self.assertEqual(L[6], {"id": "a", "error": "unknown_op"})
        self.assertEqual(L[7], {"id": "b", "error": "unknown_op"})
        self.assertEqual(L[8], {"id": "c", "error": "unknown_op"})
        for n, rid in zip(range(9, 14), "defgh"):
            self.assertEqual(L[n], {"id": rid, "error": "bad_request"}, rid)
        self.assertEqual(L[14], {"id": "i", "error": "invalid_query"})
        self.assertEqual(L[15], {"id": "j", "result": {"values": [None], "paths": ["$"]}})
        self.assertEqual(L[16], {"id": "k", "error": "unknown_op"})
        self.assertEqual(L[17], {"id": None, "error": "bad_request"})

    def test_numbers_exact(self):
        line = '{"id":"n","op":"query","input":{"query":"$[*]","document":[12345678901234567890123,1.5e300,0.1,-0,1E2,1e-7]}}'
        out = self.run_driver([line])
        self.assertEqual(out[0]["result"]["values"][0], 12345678901234567890123)
        self.assertEqual(out[0]["result"]["values"][2], 0.1)
        self.assertEqual(out[0]["result"]["values"][4], 100)
        self.assertEqual(out[0]["result"]["values"][5], 1e-7)

    def test_unicode_and_crlf(self):
        data = (self.req("u", "$['é']", {"é": "\U0001f600 "}) + "\r\n").encode("utf-8")
        p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], input=data,
                           capture_output=True, cwd=HERE, timeout=60)
        self.assertEqual(json.loads(p.stdout.decode("utf-8"))["result"]["values"], ["\U0001f600 "])
        self.assertEqual(p.stdout.count(b"\n"), 1)

    def test_no_trailing_newline_and_invalid_utf8(self):
        p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")],
                           input=self.req("z", "$", 1).encode() + b"\n\xff\xfe\n" + self.req("y", "$", 2).encode(),
                           capture_output=True, cwd=HERE, timeout=60)
        out = [json.loads(l) for l in p.stdout.decode().split("\n") if l]
        self.assertEqual([o["id"] for o in out], ["z", None, "y"])

    def test_empty_input(self):
        self.assertEqual(self.run_driver([]), [])

    def test_query_with_surrogate_escape_in_json(self):
        out = self.run_driver(['{"id":"s","op":"query","input":{"query":"$[\\"\\ud800\\"]","document":{}}}'])
        self.assertEqual(out, [{"id": "s", "error": "invalid_query"}])

    def test_dump(self):
        self.assertEqual(driver.to_json({"a": [Decimal("1.50"), 2, None, True, "é\ud800"]}),
                         '{"a":[1.50,2,null,true,"\\u00e9\\ud800"]}')


class BuildRequirements(unittest.TestCase):
    def test_regen_json(self):  # REQ-BU-001
        with open(os.path.join(HERE, "REGEN.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        self.assertEqual(set(cfg), {"lang", "build", "test", "driver"})
        self.assertEqual(cfg["lang"], "py")
        for k in ("build", "test", "driver"):
            v = cfg[k]
            self.assertTrue(isinstance(v, str) or (isinstance(v, dict) and isinstance(v.get("default"), str)))
        drv = cfg["driver"]
        for cmd in ([drv] if isinstance(drv, str) else drv.values()):
            self.assertRegex(cmd, r"^[^\s]+( [^\s]+)*$")

    def test_no_dependency_files(self):  # REQ-BU-003
        for name in ["node_modules", "package-lock.json", "requirements.txt", "Pipfile", "poetry.lock"]:
            self.assertFalse(os.path.exists(os.path.join(HERE, name)), name)

    def test_size(self):  # REQ-BU-004
        total = 0
        for root, dirs, files in os.walk(HERE):
            if os.path.basename(root) in ("test", "tests"):
                continue
            for fn in files:
                if fn.endswith(".py") and not fn.startswith("test_"):
                    with open(os.path.join(root, fn), encoding="utf-8") as f:
                        total += sum(1 for l in f if l.strip())
        self.assertLessEqual(total, 3000)

    def test_own_tests_exist(self):  # REQ-BU-002
        self.assertTrue(os.path.exists(os.path.join(HERE, "test_jsonpath.py")))


if __name__ == "__main__":
    unittest.main()
