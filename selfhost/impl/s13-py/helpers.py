"""Shared helpers for the tests."""
import json
import os

import driver

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'fixtures', 'echo.mjs'), encoding='utf-8') as _f:
    ECHO = _f.read()


def S(*lines):
    return '\n'.join(lines) + '\n'


def ask(op, inp, id_='t'):
    return driver.handle(json.dumps({'id': id_, 'op': op, 'input': inp}))


def check(files, entry=None, echo=False):
    """The diagnostics `check` reports.  `files` may be a text for s.duramen."""
    if isinstance(files, str):
        files = {'s.duramen': files}
    files = dict(files)
    if echo:
        files.setdefault('echo.mjs', ECHO)
    inp = {'files': files}
    if entry is not None:
        inp['entry'] = entry
    r = ask('check', inp)
    assert 'result' in r, r
    return r['result']['diagnostics']


def cases(files, entry=None, echo=True):
    if isinstance(files, str):
        files = {'s.duramen': files}
    files = dict(files)
    if echo:
        files.setdefault('echo.mjs', ECHO)
    inp = {'files': files}
    if entry is not None:
        inp['entry'] = entry
    return ask('cases', inp)['result']
