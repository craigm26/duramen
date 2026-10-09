// A tiny oracle for the example records in this specification. It speaks the driver protocol
// and answers each request with its input as the result, unless the input says otherwise:
//   "answer": {...}   answer with these members instead (and the request's id)
//   "line": true      answer with the request line, as received, as the result
//   "silent": true    write no answer to this request
//   "exit": <n>       answer as usual, and exit with status n at the end of input
//   "say": "<text>"   write this text as the answer line, exactly
import { createInterface } from 'node:readline';

let status = 0;
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  let req;
  try { req = JSON.parse(line); } catch { console.log(JSON.stringify({ id: null, error: 'bad_request' })); continue; }
  const input = req && typeof req.input === 'object' && req.input !== null ? req.input : {};
  if (Number.isInteger(input.exit)) status = input.exit;
  if (input.silent === true) continue;
  if (typeof input.say === 'string') { console.log(input.say); continue; }
  const result = input.line === true ? { result: line } : { result: input };
  console.log(JSON.stringify({ id: req?.id ?? null, ...(input.answer ?? result) }));
}
process.exitCode = status;
