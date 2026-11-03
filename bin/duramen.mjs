#!/usr/bin/env node
// duramen check|build|run <record> ...   (run `duramen help` for the options)
import { cli } from '../src/cli.mjs';
import { jsonParseMisreadsKeys } from '../src/driver.mjs';

// A judge that misreads JSON gives wrong answers without a sign. duramen reads JSON with its own
// reader on an engine with the known JSON.parse bug (src/json.mjs), but an oracle or an
// implementation that uses JSON.parse can still misread, so the bug is said first, on standard
// error (which no protocol here uses).
if (jsonParseMisreadsKeys()) {
  process.stderr.write(`duramen: warning: the JSON.parse of Node.js ${process.version} misreads some escaped keys (a V8 bug, DESIGN.md "Node.js versions"). duramen reads JSON without it, but an oracle or implementation that uses JSON.parse may answer wrongly about JSON whose objects hold a key that is one backslash. Node.js 22 does not have it.\n`);
}

await cli(process.argv.slice(2));
