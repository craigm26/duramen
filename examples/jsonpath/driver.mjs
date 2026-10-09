// The driver protocol in front of oracle.mjs: one JSON request per line on standard input, one
// response per non-blank line on standard output, in order.
import { query, InvalidQuery } from './oracle.mjs';

const answer = (req) => {
  if (req === null || typeof req !== 'object' || Array.isArray(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  if (req.op !== 'query') return { id: req.id, error: 'unknown_op' };
  const input = req.input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { id: req.id, error: 'bad_request' };
  if (!Object.hasOwn(input, 'query') || typeof input.query !== 'string' || !Object.hasOwn(input, 'document')) return { id: req.id, error: 'bad_request' };
  try {
    return { id: req.id, result: query(input.query, input.document) };
  } catch (e) {
    if (e instanceof InvalidQuery) return { id: req.id, error: 'invalid_query' };
    throw e;
  }
};

// A line ends at LF, CR LF or CR. The input is read whole and split here, because from Node 24
// readline also ends lines at U+2028 and U+2029, which a request may hold inside a string.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const lines = Buffer.concat(chunks).toString('utf8').split(/\r\n|\n|\r/);
if (lines[lines.length - 1] === '') lines.pop();
for (const line of lines) {
  if (line.trim() === '') continue;
  let req;
  try { req = JSON.parse(line); } catch { req = undefined; }
  process.stdout.write(JSON.stringify(req === undefined ? { id: null, error: 'bad_request' } : answer(req)) + '\n');
}
