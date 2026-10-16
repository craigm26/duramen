# Format and counts of R6's outside suite, printing none of its content: the file's sha256 and
# size, how many lines parse, the forms, and whether names repeat.
import hashlib, json, sys
p = sys.argv[1]
data = open(p, 'rb').read()
print('sha256', hashlib.sha256(data).hexdigest(), 'bytes', len(data))
cases = bad = dup = 0
forms = {}
names = set()
for line in data.decode('utf-8').split('\n'):
    if not line.strip():
        continue
    try:
        c = json.loads(line)
    except Exception:
        bad += 1
        continue
    form = 'line' if isinstance(c.get('line'), str) else 'session' if isinstance(c.get('session'), list) else 'neither'
    forms[form] = forms.get(form, 0) + 1
    if c.get('name') in names:
        dup += 1
    names.add(c.get('name'))
    cases += 1
print('cases', cases, 'not JSON', bad, 'repeated names', dup, 'forms', forms)
