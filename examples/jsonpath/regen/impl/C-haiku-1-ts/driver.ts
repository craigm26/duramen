// The jsonpath driver: request lines on standard input, response lines on standard output
// (SPEC.md, Driver protocol). Each response is written as soon as its request line has arrived.

import { StringDecoder } from "node:string_decoder";
import { answerLine } from "./protocol.ts";

const decoder = new StringDecoder("utf8");
let pending = "";

function emit(line: string): void {
  const out = answerLine(line);
  if (out !== null) process.stdout.write(out + "\n");
}

function feed(text: string): void {
  pending += text;
  let start = 0;
  let newline: number;
  while ((newline = pending.indexOf("\n", start)) !== -1) {
    emit(pending.slice(start, newline));
    start = newline + 1;
  }
  pending = pending.slice(start);
}

process.stdin.on("data", (chunk: Buffer) => feed(decoder.write(chunk)));

process.stdin.on("end", () => {
  feed(decoder.end());
  // The last line may lack its LF.
  emit(pending);
  pending = "";
});
