// Prove the A0.0 security contract can fail.
//
//   node apps/text-editor-basic/tests/drill-security.mjs
//
// Each mutation is applied to a throwaway copy of dist/main/security.js — the
// BUILT artifact the contract test actually imports — and the suite is re-run
// against it. Mutating the built file rather than the source keeps the drill
// fast and, more importantly, keeps it pointed at the same object the test
// reads. Nothing canonical is written.
//
// red            the contract caught it
// GREEN          the contract does not notice — a hole in the contract
// DID NOT APPLY  the mutation never landed, so it measured nothing while
//                looking like it ran
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT = path.join(app, "dist", "main", "security.js");
const TEST = path.join(here, "security-boundary.test.mjs");

const MUTATIONS = [
  { label: "nodeIntegration -> true", from: "nodeIntegration: false", to: "nodeIntegration: true" },
  { label: "contextIsolation -> false", from: "contextIsolation: true", to: "contextIsolation: false" },
  { label: "sandbox -> false", from: "sandbox: true", to: "sandbox: false" },
  // The anchor is the COMPILED form. The first version used the TypeScript
  // source spelling and reported DID NOT APPLY - which is the whole reason that
  // state exists, because it would otherwise have read as a pass.
  { label: "preload dropped", from: 'preload: node_path_1.default.join(preloadDir, "preload.js")', to: 'preload: ""' },
  { label: "CSP admits a remote origin", from: '"default-src \'self\'"', to: '"default-src \'self\' https://cdn.example.com"' },
  { label: "CSP permits eval", from: '"script-src \'self\'"', to: '"script-src \'self\' \'unsafe-eval\'"' },
  { label: "navigation accepts a dev server", from: 'url.protocol === "file:"', to: 'url.protocol === "file:" || url.hostname === "127.0.0.1"' },
  { label: "preload surface exposes ipcRenderer", from: '"appVersion",', to: '"appVersion", "ipcRenderer",' },
  { label: "CONTROL. change nothing", control: true, from: null, to: null },
];

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-security — can the A0.0 contract fail?");

  if (!fs.existsSync(BUILT)) {
    say("  REFUSING: dist/main/security.js is not built. Run npm run build first.");
    say("  A drill against a missing artifact would report nothing useful.");
    return { bad: 1 };
  }

  const before = digest(BUILT);
  const original = fs.readFileSync(BUILT, "utf8");
  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  for (const m of MUTATIONS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a00-drill-"));
    const target = path.join(dir, "security.js");
    let applied = true;
    if (m.control) {
      fs.writeFileSync(target, original, "utf8");
    } else if (!original.includes(m.from)) {
      applied = false;
    } else {
      fs.writeFileSync(target, original.replace(m.from, m.to), "utf8");
    }

    let failures = 0;
    if (applied) {
      // Point the test at the mutated copy by swapping the built file only for
      // the duration of this run, then restoring it. The digest check below
      // proves the restore happened.
      fs.copyFileSync(BUILT, path.join(dir, "orig.js"));
      fs.copyFileSync(target, BUILT);
      const r = spawnSync(process.execPath, ["--test", TEST], { cwd: app, encoding: "utf8" });
      failures = ((r.stdout ?? "").match(/^✖ /gm) ?? []).length;
      fs.copyFileSync(path.join(dir, "orig.js"), BUILT);
    }
    fs.rmSync(dir, { recursive: true, force: true });

    let verdict;
    if (!applied) { verdict = "DID NOT APPLY - measured nothing"; didNotApply += 1; }
    else if (m.control) {
      verdict = failures === 0 ? "green, as a control must be" : `CONTROL WENT RED (${failures})`;
      if (failures !== 0) controlFailed = true;
    } else if (failures === 0) { verdict = "GREEN - the contract does not notice."; green += 1; }
    else verdict = `red, ${failures} test(s)`;
    say(`  ${m.label.padEnd(38)} ${verdict}`);
  }

  const after = digest(BUILT);
  const restored = before === after;
  say(`\n  built artifact restored byte-identical: ${restored}`);
  say("");
  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  say(`  ${MUTATIONS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", ARTIFACT NOT RESTORED"}`);
  if (bad === 0) say("  every mutation was caught and nothing canonical moved");
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
