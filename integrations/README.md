# Using duramen from Claude Code, Claude desktop, other models and CI

duramen is a command-line tool with no dependencies (Node.js 22.18 or later). Everything here
runs the same `bin/duramen.mjs`; replace `/path/to/duramen` with where you cloned it.

| Where | How | What it gives you |
|---|---|---|
| Claude Code, as the builder | `duramen regen <record> --lang ts\|py` | a blind build from the record's brief in a fresh sandbox, its transcript audited, scored with the record's own suite |
| Claude Code and Claude desktop, as a tool | `duramen mcp` (an MCP server) | `check`, `brief`, `cases`, `run`, `diff` and `explain` from the conversation |
| Claude Code, after every edit | `duramen hook` (a PostToolUse hook) | a `.duramen` file that stops checking clean is sent back to the agent with its diagnostics |
| Claude Code, how to work | [`claude-code/skills/duramen/SKILL.md`](claude-code/skills/duramen/SKILL.md) | the spec-first rules and the loop |
| A local model or another vendor's | `duramen regen <record> --agent <base URL> --model <name>` | the same blind build, with any OpenAI-compatible endpoint as the builder |
| CI | [`ci/duramen.yml`](ci/duramen.yml) | check the record, run the suite against the implementation, and check the version bump on pull requests |

## MCP server

Claude Code, for one project or for your user:

```
claude mcp add duramen -- node /path/to/duramen/bin/duramen.mjs mcp
```

Claude desktop: add the server to `claude_desktop_config.json` (Settings, Developer, Edit
Config), as in [`claude-desktop/claude_desktop_config.json`](claude-desktop/claude_desktop_config.json),
and restart the app. Any other MCP client: the server speaks MCP over standard input and output
(protocol versions 2025-06-18, 2025-03-26 and 2024-11-05).

A record is named by `path` (a file or folder on that machine) or carried in the call as
`files` (a map of file names to texts). The tools read records and never edit them; `run`
starts the implementation's driver, as `duramen run` does.

## Hook

Put [`claude-code/settings.json`](claude-code/settings.json) in `.claude/settings.json` (or merge
its `hooks` into yours). After an Edit, Write or MultiEdit of a `.duramen` file, the hook checks
the record it belongs to: the folder, when its `.duramen` files state one `spec` between them,
else the file. Problems block with the diagnostics, so the agent sees them at once; a clean
record adds one line of context.

## Other models

`lib/regen/agent.mjs` gives the model six tools (`list_files`, `read_file`, `write_file`,
`edit_file` confined to the work folder; `run`, for one command of the language's toolchain;
`finish`) and writes a transcript that `duramen regen` audits. Endpoints:

| Server | `--agent` |
|---|---|
| llama.cpp `llama-server --jinja` | `http://127.0.0.1:8080/v1` |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| vLLM | `http://127.0.0.1:8000/v1` |
| a vendor's OpenAI-compatible API | its base URL, with `--agent-key-env <VARIABLE>` naming the variable that holds the key |

Tried so far: llama.cpp with Gemma 4 E2B (run L01 in
[`examples/heat-engine/regen/`](../examples/heat-engine/regen/)), and a scripted endpoint in
the tests. The others follow the same protocol and have not been run here.

## Evidence

- [`claude-code/e2e/mcp-check.jsonl`](claude-code/e2e/mcp-check.jsonl): `claude -p` with the MCP
  server finds and explains a planted T002 in [`claude-code/e2e/calc.duramen`](claude-code/e2e/calc.duramen)
  (with the example's expected sum set to 3).
- [`claude-code/e2e/hook-edit.jsonl`](claude-code/e2e/hook-edit.jsonl): `claude -p` with the hook
  edits the expected sum to 5 and is told, at once, that the example now disagrees with the
  oracle.
- [`ci/local-run.txt`](ci/local-run.txt): the workflow's steps run on the heat-engine slice.
- `test/mcp-hook.test.mjs` and `test/agent.test.mjs` in `npm test`.
