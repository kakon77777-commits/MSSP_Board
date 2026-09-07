import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const subject = path.join(app, "dist", "dms", "file-manager-view.js");
const testFile = path.join(here, "packaged-postscan-unavailable.test.mjs");
const run = () => spawnSync(process.execPath, ["--test", testFile], { cwd: app, encoding: "utf8", timeout: 30_000 });
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const from = "? result.snapshot.code\n            : \"\";";
const to = '? ""\n            : "";';

const control = run();
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) process.exit(1);
const before = fs.readFileSync(subject);
const text = before.toString("utf8");
let green = 0, errors = 0, dna = 0;
if (!text.includes(from)) {
  process.stdout.write("DID_NOT_APPLY hide unavailable snapshot code\n");
  dna = 1;
} else {
  try {
    fs.writeFileSync(subject, text.replace(from, to), "utf8");
    const result = run();
    if (result.status === 0) { process.stdout.write("GREEN hide unavailable snapshot code\n"); green = 1; }
    else if (result.error) { process.stdout.write(`ERROR ${result.error.message}\n`); errors = 1; }
    else process.stdout.write("red hide unavailable snapshot code\n");
  } finally { fs.writeFileSync(subject, before); }
}
if (sha(fs.readFileSync(subject)) !== sha(before)) { process.stdout.write("ERROR restore mismatch\n"); errors += 1; }
const restored = run();
process.stdout.write(`restored control ${restored.status === 0 ? "green" : "RED"}\n`);
process.stdout.write(`1 attacks / ${green} green / ${errors} errors / ${dna} did not apply\n`);
process.exit(restored.status === 0 && green === 0 && errors === 0 && dna === 0 ? 0 : 1);
