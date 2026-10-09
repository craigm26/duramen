"""Developer tool: list SPEC.md example lines that spec_examples.json does not cover."""
import json
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
t = open(os.path.join(HERE, 'SPEC.md'), encoding='utf-8').read().split('\n')
hdr = [i + 1 for i, l in enumerate(t) if re.match(r'^Example \d+: ', l)]
bul = [i + 1 for i, l in enumerate(t)
       if (l.startswith('- `') and '⟶' in l) or l.startswith('- the request line')]
tab = [i + 1 for i, l in enumerate(t) if l.startswith('| `') and ('bad_request' in l or '`true`' in l or '`false`' in l)]
c = json.load(open(os.path.join(HERE, 'spec_examples.json')))
srcs = {int(x['src'].split(':')[1]) for x in c}
print(len(hdr), len(bul), len(tab), len(c))
print([h for h in hdr + bul + tab if h not in srcs])
