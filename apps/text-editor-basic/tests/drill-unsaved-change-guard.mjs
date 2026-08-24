// Prove the executable unsaved-change guard cases can fail.
//
// The drill mutates only the built main process, restores it in a finally, and
// delegates process ownership to the acceptance test's exact captured PID.
// This file never kills by image, product, repository, or command-line match.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT = path.join(app, "dist", "main", "main.js");
const TEST = path.join(here, "unsaved-change-guard-acceptance.test.mjs");

const replaceOnce = (source, from, to) => source.includes(from) ? source.replace(from, to) : null;

const MUTATIONS = [
  {
    label: "dirty New bypasses the guard",
    mutate: (source) => replaceOnce(source,
      'if (current.dirty)\n            return unsavedChangeRefusal("New");',
      'if (false)\n            return unsavedChangeRefusal("New");'),
  },
  {
    label: "dirty Open bypasses the guard",
    mutate: (source) => replaceOnce(source,
      'if (current.dirty)\n            return unsavedChangeRefusal("Open");',
      'if (false)\n            return unsavedChangeRefusal("Open");'),
  },
  {
    label: "dirty window close bypasses the guard",
    mutate: (source) => replaceOnce(source,
      'win.on("close", (event) => {\n        if (current.dirty) {',
      'win.on("close", (event) => {\n        if (false) {'),
  },
  {
    label: "close guard is welded shut",
    mutate: (source) => replaceOnce(source,
      'win.on("close", (event) => {\n        if (current.dirty) {',
      'win.on("close", (event) => {\n        if (true) {'),
  },
  {
    label: "failed save incorrectly clears dirty",
    mutate(source) {
      const functionStart = source.indexOf("function writeCurrent(target, body) {");
      if (functionStart < 0) return null;
      const catchStart = source.indexOf("    catch (raised) {\n        return {", functionStart);
      if (catchStart < 0) return null;
      return source.slice(0, catchStart)
        + '    catch (raised) {\n        current = { ...current, dirty: false };\n        return {'
        + source.slice(catchStart + '    catch (raised) {\n        return {'.length);
    },
  },
  { label: "CONTROL. change nothing", control: true, mutate: (source) => source },
];

const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function runAcceptance() {
  return spawnSync(process.execPath, ["--test", TEST], {
    cwd: app,
    encoding: "utf8",
    timeout: 45_000,
  });
}

function guardProcessCount() {
  const command = "@(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { "
    + "$_.CommandLine -like '*--user-data-dir=*a0-guard-*' }).Count";
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const count = Number((result.stdout ?? "").trim());
  return Number.isInteger(count) ? count : -1;
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-unsaved-change-guard — can every guard case fail?\n");

  if (!fs.existsSync(BUILT)) {
    say("  REFUSING: dist/main/main.js is missing. Run npm run build first.");
    return { bad: 1 };
  }

  const original = fs.readFileSync(BUILT, "utf8");
  const before = digest(BUILT);
  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;
  let processLeaks = 0;

  try {
    for (const mutation of MUTATIONS) {
      const mutated = mutation.mutate(original);
      let verdict;

      if (mutated === null || (!mutation.control && mutated === original)) {
        verdict = "DID NOT APPLY — measured nothing";
        didNotApply += 1;
      } else {
        fs.writeFileSync(BUILT, mutated, "utf8");
        const result = runAcceptance();
        const tally = (result.stdout ?? "").match(/^ℹ fail (\d+)\s*$/m);
        const failures = tally ? Number(tally[1]) : null;
        if (failures === null) {
          verdict = `NO TALLY — exit ${result.status ?? "timeout"}`;
          didNotApply += 1;
        } else if (mutation.control) {
          verdict = failures === 0 ? "green, as a control must be" : `CONTROL RED (${failures})`;
          if (failures !== 0) controlFailed = true;
        } else if (failures > 0) {
          verdict = `red, ${failures} test(s)`;
        } else {
          verdict = "GREEN — the acceptance does not notice";
          green += 1;
        }
      }

      fs.writeFileSync(BUILT, original, "utf8");
      const remaining = guardProcessCount();
      if (remaining !== 0) {
        processLeaks += 1;
        verdict += `; HARNESS PROCESS COUNT ${remaining}`;
      }
      say(`  ${mutation.label.padEnd(43)} ${verdict}`);
    }
  } finally {
    fs.writeFileSync(BUILT, original, "utf8");
  }

  const restored = digest(BUILT) === before;
  say(`\n  built main restored byte-identical: ${restored}`);
  say(`  ${MUTATIONS.length} drills, ${green} green, ${didNotApply} did not apply, `
    + `${processLeaks} process-leak observations`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", NOT RESTORED"}`);
  const bad = green + didNotApply + processLeaks + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  return { bad };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
