import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const subject = path.join(app, "dist", "fms", "windows-filesystem-adapter.js");
const testFile = path.join(here, "windows-adapters.test.mjs");
const run = () => spawnSync(process.execPath, ["--test", "--test-name-pattern=readability probe rejects", testFile], { cwd: app, encoding: "utf8", timeout: 30_000 });
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const from = 'const handle = await promises_1.default.open(subject, "r");';
const to = `return;\n        ${from}`;
const control = run();
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) process.exit(1);
const before = fs.readFileSync(subject);
const text = before.toString("utf8");
let green = 0, errors = 0, dna = 0;
if (!text.includes(from)) { process.stdout.write("DID_NOT_APPLY skip real denied-open probe\n"); dna = 1; }
else {
  try {
    fs.writeFileSync(subject, text.replace(from, to));
    const result = run();
    if (result.status === 0) { process.stdout.write("GREEN skip real denied-open probe\n"); green = 1; }
    else if (result.error) { process.stdout.write(`ERROR ${result.error.message}\n`); errors = 1; }
    else process.stdout.write("red skip real denied-open probe\n");
  } finally { fs.writeFileSync(subject, before); }
}
if (sha(fs.readFileSync(subject)) !== sha(before)) { process.stdout.write("ERROR restore mismatch\n"); errors += 1; }
const restored = run();
process.stdout.write(`restored control ${restored.status === 0 ? "green" : "RED"}\n1 attacks / ${green} green / ${errors} errors / ${dna} did not apply\n`);
process.exit(restored.status === 0 && green === 0 && errors === 0 && dna === 0 ? 0 : 1);
