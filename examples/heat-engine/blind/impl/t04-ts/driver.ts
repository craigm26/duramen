import { handle, isBlank } from "./engine.ts";

let buf = "";

function emit(line: string): void {
  if (isBlank(line)) return;
  process.stdout.write(JSON.stringify(handle(line)) + "\n");
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    emit(buf.slice(0, i));
    buf = buf.slice(i + 1);
  }
});
process.stdin.on("end", () => {
  emit(buf);
  buf = "";
});
