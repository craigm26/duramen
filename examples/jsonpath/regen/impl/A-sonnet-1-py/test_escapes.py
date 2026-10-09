import unittest

from jsonpath import QueryError, query

BS = "\\"


def vals(text, document):
    return query(text, document)[0]


def invalid(text):
    try:
        query(text, None)
    except QueryError:
        return True
    return False


class TestStringEscapes(unittest.TestCase):
    def test_simple_escapes(self):
        key = "\b\f\n\r\t\"'/" + BS
        d = {key: 1, "a": 2, "\U0001F601": 3, "é": 4, "é": 5}
        dq = '$["' + BS + "b" + BS + "f" + BS + "n" + BS + "r" + BS + "t" + BS + '"' + "'" + BS + "/" + BS + BS + '"]'
        sq = "$['" + BS + "b" + BS + "f" + BS + "n" + BS + "r" + BS + "t" + '"' + BS + "'" + BS + "/" + BS + BS + "']"
        self.assertEqual(vals(dq, d), [1])
        self.assertEqual(vals(sq, d), [1])

    def test_unicode_escapes(self):
        d = {"a": 2, "\U0001F601": 3, "é": 4, "é": 5}
        self.assertEqual(vals('$["' + BS + 'u0061"]', d), [2])
        self.assertEqual(vals('$["' + BS + 'uD83D' + BS + 'uDE01"]', d), [3])
        self.assertEqual(vals('$["' + BS + 'ud83d' + BS + 'ude01"]', d), [3])
        self.assertEqual(vals('$["' + BS + 'u00E9"]', d), [4])
        self.assertEqual(vals('$["e' + BS + 'u0301"]', d), [5])  # no normalization
        self.assertEqual(vals('$["é"]', d), [4])
        self.assertEqual(vals('$["\U0001F601"]', d), [3])

    def test_bad_strings(self):
        for bad in ('$["' + BS + 'ud83d"]', '$["' + BS + 'ude01"]', '$["' + BS + 'ud83dx"]',
                    '$["' + BS + 'ud83d' + BS + 'u0041"]', '$["' + BS + 'u12"]', '$["' + BS + 'x41"]',
                    "$['" + BS + '"' + "']", '$["' + BS + "'" + '"]', '$["a\nb"]', '$["a\tb"]', "$['a", '$["a\']',
                    '$["' + BS + 'U0041"]', '$["' + BS + 'uZZZZ"]'):
            self.assertTrue(invalid(bad), repr(bad))

    def test_quote_escapes(self):
        self.assertEqual(vals('$["' + BS + '""]', {'"': 7}), [7])
        self.assertEqual(vals("$['" + BS + "'']", {"'": 7}), [7])
        self.assertEqual(vals('$["' + "'" + '"]', {"'": 7}), [7])
        self.assertEqual(vals("$['" + '"' + "']", {'"': 7}), [7])


if __name__ == "__main__":
    unittest.main()
