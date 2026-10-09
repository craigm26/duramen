---
name: duramen
description: Work spec-first in a repository whose behavior is specified in .duramen records - change the record before the code, check it after every edit, regenerate implementations from its brief, and triage what a builder had to guess. Use when a repo has .duramen files, or the user asks to specify, regenerate or judge a program with duramen.
---

# Working spec-first with duramen

A `.duramen` record (a file, or a folder of them) holds a program's requirements, examples,
decisions and deliberate gaps, and names an oracle: an executable model that every example
runs through. The record is the source; implementations are rebuilt from it.

## Rules
1. **Behavior changes start in the record.** To change what the program does, edit the
   requirement and its examples first. Never edit an implementation to change behavior the
   record does not state yet, and never hand-edit a folder of blind builds.
2. **Check after every edit.** `node <duramen>/bin/duramen.mjs check <record>` (or the `check`
   tool of `duramen mcp`). A record that does not check is not finished. Expected values that
   should come from the model are written `?`.
3. **Words go where they belong.** Obligations (MUST, SHALL, REQUIRED) only in requirement
   texts; an order that matters only in the `errors` list; context in decisions, with a
   `source`.
4. **Version honestly.** Before committing a changed record, run
   `duramen diff <old> <new>`; a breaking change needs a major bump.

## The loop
1. `duramen check <record>`: fix every P and T code (`duramen mcp`'s `explain` tool, or
   DESIGN.md, says what each means).
2. `duramen build <record> --out build/`: the brief a builder gets (SPEC.md, DECISIONS.md) and
   the suite (cases.jsonl).
3. `duramen regen <record> --lang ts|py`: a blind build in a fresh sandbox, audited and scored
   with the record's own suite. `--agent <base URL> --model <name>` builds with any
   OpenAI-compatible endpoint instead of Claude Code.
4. `duramen run <record> --impl <folder>`: judge an implementation.
5. Triage the builder's `CHOICES.md`: each choice is already pinned, deliberately open, or a
   place the record should say more (pin) or said badly (clarify). Pins and clarifications
   become examples in the next version of the record; try the choices on small records
   written to reach them before deciding.
6. When two independent builds agree with each other and not with the oracle, suspect the
   oracle first.

## What duramen does not cover
User interfaces, timing, concurrency and systems of several services. Specify the deterministic
core (validation, rules, transforms, protocols) and test the rest another way.
