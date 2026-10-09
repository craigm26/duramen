import { handleInput } from "./src/driver.ts";

const chunks: Buffer[] = [];
process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  process.stdout.write(handleInput(Buffer.concat(chunks).toString("utf8")));
});
