// Prove the local navigation boundary can fail against the BUILT artifact.
//
//   node tests/drill-navigation-boundary.mjs
//
// Each mutation is applied to dist/main/security.js, exercised in a fresh Node
// test process, and restored immediately. A mutation that does not land is not
// evidence and is reported separately from a mutation the tests miss.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT = path.join(app, "dist", "main", "security.js");
const TEST = path.join(here, "navigation-boundary.test.mjs");

const MUTATIONS = [
  {
    label: "file: scheme alone becomes sufficient",
    replacements: [{
      from: 'if (url.protocol !== "file:")\n            return false;',
      to: 'if (url.protocol === "file:")\n            return true;',
    }],
  },
  {
    label: "undeclared renderer file is laundered into the allowlist",
    replacements: [{
      from: '    "renderer.js",\n]);',
      to: '    "renderer.js",\n    "unused.html",\n]);',
    }],
  },
  {
    label: "required renderer asset disappears from the allowlist",
    replacements: [{
      from: '    "renderer.js",\n]);',
      to: ']);',
    }],
  },
  { label: "CONTROL. change nothing", control: true, replacements: [] },
];

const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function failures() {
  const result = spawnSync(process.execPath, ["--test", TEST], { cwd: app, encoding: "utf8" });
  const match = (result.stdout ?? "").match(/^. fail (\d+)$/m);
  return match ? Number(match[1]) : -1;
}

function applyMutation(original, mutation) {
  let next = original;
  for (const replacement of mutation.replacements) {
    if (!next.includes(replacement.from)) return null;
    next = next.replace(replacement.from, replacement.to);
  }
  return next;
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-navigation-boundary — can the shipped file allowlist fail?");

  if (!fs.existsSync(BUILT)) {
    say("  REFUSING: dist/main/security.js is not built. Run npm run build first.");
    return { bad: 1 };
  }

  const original = fs.readFileSync(BUILT, "utf8");
  const before = digest(BUILT);
  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  for (const mutation of MUTATIONS) {
    const mutated = mutation.control ? original : applyMutation(original, mutation);
    if (mutated === null) {
      say(`  ${mutation.label.padEnd(58)} DID NOT APPLY`);
      didNotApply += 1;
      continue;
    }

    if (!mutation.control) fs.writeFileSync(BUILT, mutated, "utf8");
    const failed = failures();
    fs.writeFileSync(BUILT, original, "utf8");

    if (mutation.control) {
      if (failed === 0) say(`  ${mutation.label.padEnd(58)} green, as a control must be`);
      else {
        say(`  ${mutation.label.padEnd(58)} CONTROL RED (${failed})`);
        controlFailed = true;
      }
    } else if (failed > 0) {
      say(`  ${mutation.label.padEnd(58)} red, ${failed} test(s)`);
    } else {
      say(`  ${mutation.label.padEnd(58)} GREEN — not noticed`);
      green += 1;
    }
  }

  const restored = digest(BUILT) === before;
  say(`\n  built navigation artifact restored byte-identical: ${restored}`);
  say(`  ${MUTATIONS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", NOT RESTORED"}`);

  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}

