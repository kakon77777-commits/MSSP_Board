import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const dms = path.join(app, "dist", "dms", "file-manager-view.js");
const stray = path.join(app, "src", "sms", "zz-compiled-probe.js");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const check = () => spawnSync(process.execPath, [path.join(app, "scripts", "render-renderer.mjs"), "--check"], {
  cwd: app, encoding: "utf8", timeout: 60_000,
});

const control = check();
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) process.exit(1);

const before = fs.readFileSync(dms);
let green = 0;
let errors = 0;
let dna = 0;
try {
  fs.writeFileSync(dms, Buffer.concat([before, Buffer.from("\n// mutated DMS\n")]));
  if (sha(fs.readFileSync(dms)) === sha(before)) {
    process.stdout.write("DID_NOT_APPLY mutate compiled DMS\n"); dna += 1;
  } else {
    const result = check();
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) { process.stdout.write("GREEN mutate compiled DMS\n"); green += 1; }
    else if (/stale built DMS/.test(output)) process.stdout.write("red mutate compiled DMS\n");
    else { process.stdout.write(`ERROR mutate compiled DMS: ${output.split(/\r?\n/)[0]}\n`); errors += 1; }
  }
} finally { fs.writeFileSync(dms, before); }
if (sha(fs.readFileSync(dms)) !== sha(before)) { process.stdout.write("ERROR DMS restore mismatch\n"); errors += 1; }

try {
  fs.writeFileSync(stray, "export {};\n", "utf8");
  if (!fs.existsSync(stray)) { process.stdout.write("DID_NOT_APPLY seed source residue\n"); dna += 1; }
  else {
    const result = check();
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) { process.stdout.write("GREEN seed source residue\n"); green += 1; }
    else if (/compiled JavaScript found under src/.test(output)) process.stdout.write("red seed source residue\n");
    else { process.stdout.write(`ERROR seed source residue: ${output.split(/\r?\n/)[0]}\n`); errors += 1; }
  }
} finally { if (fs.existsSync(stray)) fs.rmSync(stray); }

const restored = check();
process.stdout.write(`restored control ${restored.status === 0 ? "green" : "RED"}\n`);
process.stdout.write(`2 attacks / ${green} green / ${errors} errors / ${dna} did not apply\n`);
process.exit(restored.status === 0 && green === 0 && errors === 0 && dna === 0 ? 0 : 1);
