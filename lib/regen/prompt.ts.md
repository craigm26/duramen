# Build {{name}} from its specification

You are building {{name}} from scratch. You have exactly three files: SPEC.md, DECISIONS.md and
this PROMPT.md. They are the only source of truth about this program.

## Rules
1. Build only from these three files. Do not search the web, fetch anything, install anything,
   or read outside this folder. If you recognize this program, do not reproduce remembered code;
   build from the spec as written.
2. Language: TypeScript, run by Node.js 22.18 or later directly through type stripping, with no
   build step and no compiler, unless SPEC.md says otherwise. Use erasable syntax only (no
   enums, namespaces or parameter properties), give relative imports the `.ts` extension, and
   write tests with `node:test` and `node:assert` in files named `*.test.ts`. Everything goes in
   this folder.
3. SPEC.md says how the implementation is run and judged, what the implementation folder must
   contain, and what limits it must stay within. Meet all of it.
4. Write your own tests, including at least one for every MUST in SPEC.md, and make them pass.
5. Never stop to ask a question. Where the spec is silent, ambiguous or contradicts itself,
   choose the most reasonable behavior, keep going, and record the choice in CHOICES.md. Record
   small choices too; they are the point of this exercise.
6. The only commands you may run: `node ...`, `npm test...`, `npm run ...`, plus `mkdir`, `ls`,
   `git init`, `git add` and `git commit`. Other commands will be refused.

## Finish with
- all of your tests passing
- everything SPEC.md requires of the implementation folder
- CHOICES.md, in this format, one entry per choice:

  ## C-<n>: <short title>
  - Spec reference: <REQ/OPEN ID or section, or "none">
  - Situation: missing | ambiguous | contradictory
  - What I chose: ...
  - Alternatives: ...
  - Should the spec pin this? yes | no | unsure, and why

- BUILD_NOTES.md: how to build, test and run, and anything that surprised you.
