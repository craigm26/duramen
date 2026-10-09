import { createInterface } from 'node:readline';
import { stdin, stdout, stderr } from 'node:process';
import { PassThrough } from 'node:stream';
import { checkRecord } from './checker.ts';
import { generateCases } from './cases.ts';

function isValidId(id) {
  return typeof id === 'string';
}

function isValidOp(op) {
  return typeof op === 'string';
}

function isValidInput(input) {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function main() {
  const readline = createInterface({
    input: stdin,
    output: new PassThrough(),
    terminal: false,
  });

  for await (const line of readline) {
    if (line.trim() === '') {
      continue;
    }

    let response;

    try {
      const req = JSON.parse(line);

      if (!isValidId(req.id)) {
        response = { id: null, error: 'bad_request' };
        stdout.write(JSON.stringify(response) + '\n');
        continue;
      }

      const id = req.id;

      if (!isValidOp(req.op)) {
        response = { id, error: 'unknown_op' };
        stdout.write(JSON.stringify(response) + '\n');
        continue;
      }

      const op = req.op;

      if (!isValidInput(req.input)) {
        response = { id, error: 'bad_request' };
        stdout.write(JSON.stringify(response) + '\n');
        continue;
      }

      const input = req.input;

      try {
        if (op === 'check') {
          const result = checkRecord(input);
          response = { id, result };
        } else if (op === 'cases') {
          const result = generateCases(input);
          response = { id, result };
        } else {
          response = { id, error: 'unknown_op' };
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('bad_request:')) {
          response = { id, error: 'bad_request' };
        } else {
          throw err;
        }
      }

      stdout.write(JSON.stringify(response) + '\n');
    } catch (err) {
      if (err instanceof SyntaxError) {
        const response = { id: null, error: 'bad_request' };
        stdout.write(JSON.stringify(response) + '\n');
      } else {
        throw err;
      }
    }
  }

  readline.close();
}

main().catch(err => {
  stderr.write(err.stack + '\n');
  process.exit(1);
});
