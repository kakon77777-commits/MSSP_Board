import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const recordPath = path.join(here, "products", "01-text-editor-basic.json");
const indexPath = path.join(here, "index.json");
const readmePath = path.join(here, "README.md");
const verifier = path.join(here, "verify-portfolio.mjs");
const renderer = path.join(here, "render-index.mjs");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const run = (file, args = []) => spawnSync(process.execPath, [file, ...args], { cwd: repo, encoding: "utf8", timeout: 60_000 });
const canonical = {
  record: fs.readFileSync(recordPath),
  index: fs.readFileSync(indexPath),
  readme: fs.readFileSync(readmePath),
};
const attacks = [
  ["replace role array with App-1 fixed object", (r) => { r.owners = { build: "Elenchos", manifest_and_oracle: "Metron", system_acceptance: "Pragma" }; }],
  ["duplicate one semantic role", (r) => { r.owners[1].role = r.owners[0].role; }],
  ["duplicate one speaker", (r) => { r.owners[2].speaker = r.owners[0].speaker; }],
  ["drop one owner record", (r) => { r.owners.pop(); }],
  ["empty one owner role", (r) => { r.owners[1].role = ""; }],
  ["add unknown owner field", (r) => { r.owners[1].authority = true; }],
  ["change canonical speaker case", (r) => { r.owners[2].speaker = "pragma"; }],
  ["alias an owner role with trailing whitespace", (r) => { r.owners[1].role = `${r.owners[0].role} `; }],
  ["alias an owner role by case", (r) => { r.owners[1].role = "Product_build"; }],
];

const control = run(verifier);
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) process.exit(1);
let green = 0, errors = 0, dna = 0;
try {
  for (const [label, mutate] of attacks) {
    const record = JSON.parse(canonical.record.toString("utf8"));
    mutate(record);
    const changed = `${JSON.stringify(record, null, 2)}\n`;
    if (changed === canonical.record.toString("utf8")) { process.stdout.write(`DID_NOT_APPLY ${label}\n`); dna += 1; continue; }
    try {
      fs.writeFileSync(recordPath, changed);
      const rendered = run(renderer);
      if (rendered.status !== 0) {
        process.stdout.write(`red ${label} (renderer refused malformed owner shape)\n`);
      } else {
        const result = run(verifier);
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
        if (result.status === 0) { process.stdout.write(`GREEN ${label}\n`); green += 1; }
        else if (/^\s*FAIL /m.test(output)) process.stdout.write(`red ${label}\n`);
        else { process.stdout.write(`ERROR ${label}\n`); errors += 1; }
      }
    } finally {
      fs.writeFileSync(recordPath, canonical.record);
      fs.writeFileSync(indexPath, canonical.index);
      fs.writeFileSync(readmePath, canonical.readme);
    }
  }
} finally {
  fs.writeFileSync(recordPath, canonical.record);
  fs.writeFileSync(indexPath, canonical.index);
  fs.writeFileSync(readmePath, canonical.readme);
}
const restored = run(verifier);
const exact = sha(fs.readFileSync(recordPath)) === sha(canonical.record)
  && sha(fs.readFileSync(indexPath)) === sha(canonical.index)
  && sha(fs.readFileSync(readmePath)) === sha(canonical.readme);
process.stdout.write(`restored control ${restored.status === 0 ? "green" : "RED"}\nrestored byte-identical ${exact}\n`);
process.stdout.write(`${attacks.length} attacks / ${green} green / ${errors} errors / ${dna} did not apply\n`);
process.exit(restored.status === 0 && exact && green === 0 && errors === 0 && dna === 0 ? 0 : 1);
