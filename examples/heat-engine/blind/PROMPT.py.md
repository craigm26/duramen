# Build heat-engine from its specification

You are building heat-engine from scratch. You have exactly three files: SPEC.md,
DECISIONS.md and this PROMPT.md. They are the only source of truth about this program.

## Rules
1. Build only from these three files. Do not search the web, fetch anything, install
   anything the budgets in rule 6 do not allow, or read outside this folder. If you recognize
   this program, do not reproduce remembered code; build from the spec as written.
2. Language and layout: Python 3.11 or later, standard library only, everything in this
   folder. Tests use `unittest` and live in files named `test_*.py`. On Windows the
   interpreter is started as `py -3`; on Linux as `python3`.
3. Create REGEN.json, a JSON object with keys `lang`, `build`, `test` and `driver`. `lang` is
   `"py"`. Each of `build`, `test` and `driver` is either a command string or an object whose
   keys are Node.js `process.platform` values (for example `"win32"`) plus a required
   `"default"` key, each mapping to a command string. Commands run with this folder as the
   working directory; `build` and `test` run through the platform shell, and an empty `build`
   means there is nothing to build. The same REGEN.json has to work on Windows and on Linux.
   Put build output, if any, in bin/. The driver must be startable as plain words, for example
   `py -3 driver.py` on Windows and `python3 driver.py` elsewhere.
4. Write your own tests, including at least one for every MUST in SPEC.md, and make them pass.
5. Never stop to ask a question. Where the spec is silent, ambiguous or contradicts itself,
   choose the most reasonable behavior, keep going, and record the choice in CHOICES.md.
   Record small choices too; they are the point of this exercise.
6. Budgets: the standard library only, with no packages installed; at most 800 non-blank
   lines in source files (`.py`) in this folder, not counting test files (`test_*.py`,
   `*_test.py`, and anything under a `test/` or `tests/` folder).
7. The only commands you may run: `py ...`, `python ...`, `python3 ...`, plus `mkdir`, `ls`,
   `git init`, `git add` and `git commit`. Other commands will be refused.

## Finish with
- all of your tests passing
- REGEN.json
- CHOICES.md, in this format, one entry per choice:

  ## C-<n>: <short title>
  - Spec reference: <REQ/OPEN ID or section, or "none">
  - Situation: missing | ambiguous | contradictory
  - What I chose: ...
  - Alternatives: ...
  - Should the spec pin this? yes | no | unsure, and why

- BUILD_NOTES.md: how to build, test and run, and anything that surprised you.
