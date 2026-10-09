// Part of claim 7's audit (CONFIDENCE-2.md): a build that uses a JSONPath library is
// disqualified. This lists every module each build imports that is neither its own nor in its
// language's standard library, and every dependency its package.json declares. The builds ran
// with no network and no packages installed, so the expected answer is none.
//
//   node examples/jsonpath/imports.mjs <impl dir> ...
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (f === 'node_modules' || f === '.git' || f === '__pycache__') return [];
  return statSync(p).isDirectory() ? files(p) : [p];
});

const NODE = new Set(builtinModules);
const tsImports = (text) => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1/gm)].map((m) => m[2]);

// Python: every import statement, by Python's own parser; relative imports and modules of the
// build's own files are its own.
const PY = String.raw`
import ast, json, sys
out = []
for path in sys.argv[1:]:
    try:
        tree = ast.parse(open(path, encoding='utf-8').read(), path)
    except SyntaxError as e:
        out.append([path, '(does not parse: %s)' % e.msg]); continue
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            out += [[path, a.name] for a in n.names]
        elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
            out.append([path, n.module])
        elif isinstance(n, ast.Call) and getattr(n.func, 'id', getattr(n.func, 'attr', '')) in ('__import__', 'import_module') and n.args and isinstance(n.args[0], ast.Constant):
            out.append([path, str(n.args[0].value)])
print(json.dumps({'stdlib': sorted(sys.stdlib_module_names), 'imports': out}))
`;

let flagged = 0;
for (const dir of process.argv.slice(2)) {
  const all = files(dir);
  const own = new Set(all.flatMap((f) => [basename(f).replace(/\.(py|ts|mts|js|mjs)$/, ''), ...f.slice(dir.length + 1).split('/').slice(0, -1)]));
  const found = [];
  for (const f of all.filter((f) => /\.(ts|mts|cts|js|mjs|cjs)$/.test(f))) {
    for (const m of tsImports(readFileSync(f, 'utf8'))) {
      if (m.startsWith('.') || m.startsWith('node:') || NODE.has(m)) continue;
      found.push(`${f.slice(dir.length + 1)}: ${m}`);
    }
  }
  const py = all.filter((f) => extname(f) === '.py');
  if (py.length) {
    const r = spawnSync('python3', ['-I', '-c', PY, ...py], { encoding: 'utf8' });
    if (r.status !== 0) { found.push(`(python could not read the files: ${r.stderr.trim()})`); }
    else {
      const { stdlib, imports } = JSON.parse(r.stdout);
      const std = new Set(stdlib);
      for (const [f, m] of imports) {
        const top = m.split('.')[0];
        if (std.has(top) || own.has(top) || m.startsWith('(')) { if (m.startsWith('(')) found.push(`${f.slice(dir.length + 1)}: ${m}`); continue; }
        found.push(`${f.slice(dir.length + 1)}: ${m}`);
      }
    }
  }
  const pkg = join(dir, 'package.json');
  if (existsSync(pkg)) {
    const p = JSON.parse(readFileSync(pkg, 'utf8'));
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const d of Object.keys(p[k] ?? {})) found.push(`package.json ${k}: ${d}`);
  }
  for (const req of ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile']) if (existsSync(join(dir, req))) found.push(`${req} present`);
  flagged += found.length;
  process.stdout.write(`${basename(dir)}: ${found.length ? found.join('; ') : 'standard library and its own files only'}\n`);
}
process.exitCode = flagged ? 1 : 0;
