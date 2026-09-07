import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const testFile = path.join(here, "identity-and-name.test.mjs");
const validator = path.join(app, "dist", "tms", "single-segment-name-validator.js");
const registry = path.join(app, "dist", "tms", "entry-id-registry.js");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function run() {
  return spawnSync(process.execPath, ["--test", testFile], { cwd: app, encoding: "utf8", timeout: 30_000 });
}

const attacks = [
  {
    label: "accept non-string names",
    file: validator,
    from: 'return { ok: false, code: "invalid_argument" };',
    to: 'return { ok: true, value };',
  },
  {
    label: "allow Windows reserved names",
    file: validator,
    from: '|| /[. ]$/.test(value) || WINDOWS_RESERVED.test(value))',
    to: '|| /[. ]$/.test(value) || false)',
  },
  {
    label: "resolve stale-generation identifiers",
    file: registry,
    from: 'if (generation !== this.#generation)',
    to: 'if (false)',
  },
  {
    label: "reuse mappings across snapshot publications",
    file: registry,
    from: 'this.#byId.clear();\n        this.#byPath.clear();',
    to: 'void this.#byId;\n        void this.#byPath;',
  },
  {
    label: "accept duplicate opaque token collisions",
    file: registry,
    from: 'if (this.#byId.has(entryId))',
    to: 'if (false)',
  },
];

const control = run();
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) process.exit(1);

let green = 0;
let errors = 0;
let didNotApply = 0;
for (const attack of attacks) {
  const before = fs.readFileSync(attack.file);
  const text = before.toString("utf8");
  if (!text.includes(attack.from)) {
    process.stdout.write(`DID_NOT_APPLY ${attack.label}\n`);
    didNotApply += 1;
    continue;
  }
  try {
    const mutated = text.replace(attack.from, attack.to);
    if (mutated === text) {
      process.stdout.write(`DID_NOT_APPLY ${attack.label}\n`);
      didNotApply += 1;
      continue;
    }
    fs.writeFileSync(attack.file, mutated, "utf8");
    const result = run();
    if (result.status === 0) {
      process.stdout.write(`GREEN ${attack.label}\n`);
      green += 1;
    } else if (result.error) {
      process.stdout.write(`ERROR ${attack.label}: ${result.error.message}\n`);
      errors += 1;
    } else {
      process.stdout.write(`red ${attack.label}\n`);
    }
  } finally {
    fs.writeFileSync(attack.file, before);
  }
  const restored = fs.readFileSync(attack.file);
  if (sha(restored) !== sha(before)) {
    process.stdout.write(`ERROR ${attack.label}: restore not byte-identical\n`);
    errors += 1;
  }
}

const restoredControl = run();
process.stdout.write(`restored control ${restoredControl.status === 0 ? "green" : "RED"}\n`);
process.stdout.write(`${attacks.length} attacks / ${green} green / ${errors} errors / ${didNotApply} did not apply\n`);
process.exit(restoredControl.status === 0 && green === 0 && errors === 0 && didNotApply === 0 ? 0 : 1);
