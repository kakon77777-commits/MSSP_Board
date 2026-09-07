import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const subject = path.join(app, "dist", "tms", "root-session-controller.js");
const testFile = path.join(here, "root-session.test.mjs");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const run = () => spawnSync(process.execPath, ["--test", testFile], { cwd: app, encoding: "utf8", timeout: 30_000 });

const attacks = [
  ["reset root-change generation to one", "const generation = this.#lastGeneration + 1;", "const generation = 1;"],
  ["drop prior snapshot on picker cancellation", 'return { status: "cancelled", prior, evidencePath: picked.evidencePath };', 'return { status: "cancelled", prior: null, evidencePath: picked.evidencePath };'],
  ["stop publishing a new refresh generation", "const generation = this.#lastGeneration + 1;", "const generation = this.#lastGeneration;", true],
  ["allow reparse navigation", 'if (resolved.kind === "reparse")', "if (false)"],
  ["deduplicate repeated selection ids into success", 'if ((counts.get(item.submittedEntryId) ?? 0) > 1)', "if (false)"],
  ["treat non-entry cursors as selectable", 'if (!this.#snapshot.entries.some((entry) => entry.entryId === item.submittedEntryId))', "if (false)"],
  ["reuse one pinned destination id across generations", 'entryId: this.#identities.issue(canonical, "directory", "pinned-destination"),', 'entryId: "entry:fixed-destination",'],
  ["retain destination pin across root change", "this.#pinnedDestination = null;", "void this.#pinnedDestination;", true],
  ["contaminate directory completeness when destination is unavailable", "return { ...snapshot, destinationProjection: projection };", 'return { ...snapshot, completeness: projection.state === "unavailable" ? "partial" : snapshot.completeness, destinationProjection: projection };'],
];

function apply(text, attack) {
  const [, from, to, last] = attack;
  if (!last) return text.includes(from) ? text.replace(from, to) : null;
  const index = text.lastIndexOf(from);
  return index < 0 ? null : `${text.slice(0, index)}${to}${text.slice(index + from.length)}`;
}

const control = run();
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) process.exit(1);
let green = 0, errors = 0, dna = 0;
for (const attack of attacks) {
  const [label] = attack;
  const before = fs.readFileSync(subject);
  const changed = apply(before.toString("utf8"), attack);
  if (!changed) { process.stdout.write(`DID_NOT_APPLY ${label}\n`); dna += 1; continue; }
  try {
    fs.writeFileSync(subject, changed, "utf8");
    const result = run();
    if (result.status === 0) { process.stdout.write(`GREEN ${label}\n`); green += 1; }
    else if (result.error) { process.stdout.write(`ERROR ${label}: ${result.error.message}\n`); errors += 1; }
    else process.stdout.write(`red ${label}\n`);
  } finally { fs.writeFileSync(subject, before); }
  if (sha(fs.readFileSync(subject)) !== sha(before)) { process.stdout.write(`ERROR ${label}: restore mismatch\n`); errors += 1; }
}
const restored = run();
process.stdout.write(`restored control ${restored.status === 0 ? "green" : "RED"}\n`);
process.stdout.write(`${attacks.length} attacks / ${green} green / ${errors} errors / ${dna} did not apply\n`);
process.exit(restored.status === 0 && green === 0 && errors === 0 && dna === 0 ? 0 : 1);
