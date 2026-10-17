// A tiny oracle for the example records in this specification. It speaks the driver protocol
// and answers each request with its input as the result, unless the input says otherwise:
//   "answer": {...}   answer with these members instead (and the request's id)
//   "line": true      answer with the request line, as received, as the result
//   "silent": true    write no answer to this request
//   "exit": <n>       answer as usual, and exit with status n at the end of input
//   "say": "<text>"   write this text as the answer line, exactly
//
// A line ends at LF, CR LF or CR, as Node's readline ended lines before Node 24; U+2028 and
// U+2029 do not end one (from Node 24, readline ends lines there too), so the input is read
// whole and split here.

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const lines = Buffer.concat(chunks).toString('utf8').split(/\r\n|\n|\r/);
if (lines[lines.length - 1] === '') lines.pop();
let status = 0;
for (const line of lines) {
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
