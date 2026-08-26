// Prove the exact compiled-preload contract can fail.
//
//   node apps/text-editor-basic/tests/drill-preload-surface.mjs
//
// Each attack mutates only the built preload, runs only the surface contract,
// then restores the artifact before the next attack. The control must remain
// green and every non-control mutation must go red.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT = path.join(app, "dist", "preload", "preload.js");
const TEST = path.join(here, "preload-surface.test.mjs");

const ANCHOR = 'electron_1.contextBridge.exposeInMainWorld("appVersion", appVersion);';
const ATTACKS = [
  {
    label: "declared registration removed",
    mutate: (source) => source.replace(ANCHOR, ""),
  },
  {
    label: "undeclared registration added",
    mutate: (source) => source.replace(ANCHOR,
      `${ANCHOR}\nelectron_1.contextBridge.exposeInMainWorld("unexpectedBridge", {});`),
  },
  {
    label: "declared registration duplicated",
    mutate: (source) => source.replace(ANCHOR, `${ANCHOR}\n${ANCHOR}`),
  },
  {
    label: "raw ipcRenderer hidden behind declared name",
    mutate: (source) => source.replace(ANCHOR,
      'electron_1.contextBridge.exposeInMainWorld("appVersion", electron_1.ipcRenderer);'),
  },
  { label: "CONTROL. change nothing", control: true, mutate: (source) => source },
];

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function testSurface() {
  return spawnSync(process.execPath, ["--test", TEST], {
    cwd: app,
    encoding: "utf8",
  });
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-preload-surface — can the exact surface contract fail?\n");

  if (!fs.existsSync(BUILT)) {
    say("  REFUSING: dist/preload/preload.js is missing. Run npm run build first.");
    return { bad: 1 };
  }

  const original = fs.readFileSync(BUILT, "utf8");
  const before = digest(BUILT);
  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  try {
    for (const attack of ATTACKS) {
      const mutated = attack.mutate(original);
      const applied = attack.control || mutated !== original;
      let verdict;

      if (!applied) {
        verdict = "DID NOT APPLY - measured nothing";
        didNotApply += 1;
      } else {
        fs.writeFileSync(BUILT, mutated, "utf8");
        const result = testSurface();
        const red = result.status !== 0;
        if (attack.control) {
          verdict = red ? "CONTROL WENT RED" : "green, as a control must be";
          if (red) controlFailed = true;
        } else if (red) {
          const summary = (result.stdout ?? "").match(/^ℹ fail (\d+)\s*$/m);
          const failures = summary ? Number(summary[1]) : 1;
          verdict = `red, ${failures || 1} test(s)`;
        } else {
          verdict = "GREEN - the contract does not notice";
          green += 1;
        }
      }

      fs.writeFileSync(BUILT, original, "utf8");
      say(`  ${attack.label.padEnd(48)} ${verdict}`);
    }
  } finally {
    fs.writeFileSync(BUILT, original, "utf8");
  }

  const restored = digest(BUILT) === before;
  say(`\n  built preload restored byte-identical: ${restored}`);
  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  say(`  ${ATTACKS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", NOT RESTORED"}`);
  if (bad === 0) say("  every attack was caught and nothing canonical moved");
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
