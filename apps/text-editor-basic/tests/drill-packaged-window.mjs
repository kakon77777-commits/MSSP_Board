// Prove the packaged-launch tests can fail — and prove the contract suite CANNOT
// catch what they catch.
//
//   node apps/text-editor-basic/tests/drill-packaged-window.mjs
//
// Every mutation here breaks the SHIPPED APPLICATION while leaving
// src/main/security.ts untouched. That is the whole point: on 2026-08-24 the
// nine contract tests were green while dist/main/main.js did not exist, so an
// application that could not start scored a perfect security contract. A
// declaration is not a deployment.
//
// So each mutation is run through BOTH suites and both results are reported.
// A mutation that turns packaged-window red while security-boundary stays green
// is not a gap in the contract suite — it is the measured reason this second
// suite has to exist.
//
// red            the suite caught it
// GREEN          the suite does not notice
// DID NOT APPLY  the mutation never landed, so it measured nothing while
//                looking like it ran
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const MAIN = path.join(app, "dist", "main", "main.js");
const PRELOAD = path.join(app, "dist", "preload", "preload.js");
const INDEX = path.join(app, "dist", "renderer", "index.html");

const GUI = path.join(here, "packaged-window.test.mjs");
const CONTRACT = path.join(here, "security-boundary.test.mjs");

const MUTATIONS = [
  {
    label: "main ignores the contract entirely",
    file: MAIN,
    from: "new electron_1.BrowserWindow((0, security_1.windowOptions)())",
    to: 'new electron_1.BrowserWindow({ width: 1000, height: 700, show: false, '
      + 'webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })',
  },
  {
    label: "main keeps the options but drops the preload",
    file: MAIN,
    from: "new electron_1.BrowserWindow((0, security_1.windowOptions)())",
    to: "new electron_1.BrowserWindow({ ...(0, security_1.windowOptions)(), "
      + "webPreferences: { ...(0, security_1.windowOptions)().webPreferences, preload: undefined } })",
  },
  {
    label: "navigation guard removed from main",
    file: MAIN,
    from: "if (!(0, security_1.isNavigationAllowed)(url))",
    to: "if (false)",
  },
  {
    label: "preload leaks raw ipcRenderer",
    file: PRELOAD,
    from: 'electron_1.contextBridge.exposeInMainWorld("appVersion", appVersion);',
    to: 'electron_1.contextBridge.exposeInMainWorld("appVersion", appVersion);'
      + 'electron_1.contextBridge.exposeInMainWorld("ipcRenderer", electron_1.ipcRenderer);',
  },
  {
    label: "shipped page weakens the CSP",
    file: INDEX,
    from: "script-src 'self'",
    to: "script-src 'self' 'unsafe-inline'",
  },
  { label: "CONTROL. change nothing", control: true, file: MAIN, from: null, to: null },
];

const digest = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function failures(testFile) {
  const r = spawnSync(process.execPath, ["--test", testFile], { cwd: app, encoding: "utf8" });
  const m = (r.stdout ?? "").match(/^. fail (\d+)$/m);
  return m ? Number(m[1]) : -1;      // -1 means the run itself did not report
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-packaged-window — can the packaged-launch suite fail,");
  say("    and does the contract suite notice any of it?\n");

  for (const f of [MAIN, PRELOAD, INDEX]) {
    if (!fs.existsSync(f)) {
      say(`  REFUSING: ${path.relative(app, f)} is not built. Run npm run build first.`);
      return { bad: 1 };
    }
  }

  const before = Object.fromEntries([MAIN, PRELOAD, INDEX].map((f) => [f, digest(f)]));
  const originals = Object.fromEntries(
    [MAIN, PRELOAD, INDEX].map((f) => [f, fs.readFileSync(f, "utf8")]));

  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;
  let contractBlind = 0;

  say(`  ${"mutation".padEnd(42)} ${"packaged-window".padEnd(18)} security-boundary`);
  say(`  ${"-".repeat(42)} ${"-".repeat(18)} ${"-".repeat(18)}`);

  for (const m of MUTATIONS) {
    let applied = true;
    if (!m.control) {
      if (!originals[m.file].includes(m.from)) applied = false;
      else fs.writeFileSync(m.file, originals[m.file].replace(m.from, m.to), "utf8");
    }

    let gui = 0;
    let contract = 0;
    if (applied) {
      gui = failures(GUI);
      contract = failures(CONTRACT);
      fs.writeFileSync(m.file, originals[m.file], "utf8");     // restore immediately
    }

    let guiVerdict;
    let contractVerdict = "";
    if (!applied) {
      guiVerdict = "DID NOT APPLY";
      didNotApply += 1;
    } else if (m.control) {
      guiVerdict = gui === 0 ? "green (correct)" : `CONTROL RED (${gui})`;
      contractVerdict = contract === 0 ? "green (correct)" : `CONTROL RED (${contract})`;
      if (gui !== 0 || contract !== 0) controlFailed = true;
    } else {
      guiVerdict = gui > 0 ? `red, ${gui}` : "GREEN — not noticed";
      if (gui === 0) green += 1;
      if (contract === 0) {
        contractVerdict = "green — blind";
        contractBlind += 1;
      } else {
        contractVerdict = `red, ${contract}`;
      }
    }
    say(`  ${m.label.padEnd(42)} ${guiVerdict.padEnd(18)} ${contractVerdict}`);
  }

  const restored = [MAIN, PRELOAD, INDEX].every((f) => digest(f) === before[f]);
  say(`\n  built artifacts restored byte-identical: ${restored}`);
  say(`  ${MUTATIONS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", NOT RESTORED"}`);
  say(`  mutations the contract suite could not see: ${contractBlind} of ${MUTATIONS.length - 1}`);
  if (contractBlind > 0) {
    say("  ^ this number is the measured reason packaged-window exists. The contract");
    say("    suite is not wrong; it answers a different question, and shipping needs both.");
  }

  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
