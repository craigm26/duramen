"""judge: compare one answer with one case (REQ-JU-001 to REQ-JU-004)."""
from jsutil import jeq, dist, is_num, lookup, u16


def _valid_check(c):
    if not isinstance(c, dict) or not isinstance(c.get('path'), str) or 'kind' not in c:
        return False
    kind = c['kind']
    if kind == 'eq':
        return 'value' in c
    if kind == 'approx':
        return (is_num(c.get('value')) and is_num(c.get('tol')) and c['tol'] >= 0)
    return True


def _valid_full(f):
    if f is None:
        return True
    if not isinstance(f, dict):
        return False
    m = f.get('members')
    if not isinstance(m, list) or not all(isinstance(x, str) for x in m):
        return False
    t = f.get('tolerances')
    if not isinstance(t, dict) or not all(is_num(v) and v >= 0 for v in t.values()):
        return False
    if 'audit' in f and not isinstance(f['audit'], str):
        return False
    return True


def valid_input(inp):
    if 'case' not in inp or 'answer' not in inp:
        return False
    case, answer = inp['case'], inp['answer']
    if not isinstance(case, dict):
        return False
    checks = case.get('checks')
    if not isinstance(checks, list) or not all(_valid_check(c) for c in checks):
        return False
    if 'full' not in case or not _valid_full(case['full']):
        return False
    return answer is None or isinstance(answer, dict)


def _eq_tol(exp, act, path, tols):
    if path in tols and is_num(exp) and is_num(act):
        return dist(act, exp) <= tols[path]
    if isinstance(exp, dict) and isinstance(act, dict):
        return exp.keys() == act.keys() and all(
            _eq_tol(exp[k], act[k], path + '.' + k, tols) for k in exp)
    if isinstance(exp, list) and isinstance(act, list):
        return len(exp) == len(act) and all(
            _eq_tol(x, y, path + '.' + str(i), tols) for i, (x, y) in enumerate(zip(exp, act)))
    return jeq(exp, act)


def _check_holds(c, answer):
    found, val = lookup(answer, c['path'])
    if not found:
        return False
    if c['kind'] == 'eq':
        return jeq(val, c['value'])
    if c['kind'] == 'approx':
        return is_num(val) and dist(val, c['value']) <= c['tol']
    return False


def judge(inp):
    case, answer = inp['case'], inp['answer']
    if answer is None:
        return {'pass': False, 'failed': ['answer']}
    failed = []
    for i, c in enumerate(case['checks']):
        if not _check_holds(c, answer):
            failed.append('checks.%d' % i)
    full = case['full']
    if full is not None:
        if sorted(answer.keys(), key=u16) != full['members']:
            failed.append('members')
        if 'error' in full:
            if not ('error' in answer and jeq(answer['error'], full['error'])):
                failed.append('error')
        else:
            if 'result' in full:
                if not ('result' in answer
                        and _eq_tol(full['result'], answer['result'], 'result', full['tolerances'])):
                    failed.append('result')
            if 'audit' in full:
                if not ('audit' in answer and isinstance(answer['audit'], str)
                        and answer['audit'] == full['audit']):
                    failed.append('audit')
    if failed:
        return {'pass': False, 'failed': failed}
    return {'pass': True}
