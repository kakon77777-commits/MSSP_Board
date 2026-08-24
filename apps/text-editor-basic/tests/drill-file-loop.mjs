// Prove the A0 file-loop tests can fail.
//
//   node apps/text-editor-basic/tests/drill-file-loop.mjs
//
// Each mutation breaks one thing `encoding_policy`, `dialog_coverage` or the
// unsaved-change-guard row promises, applied to the BUILT files the running app
// actually loads. The suite is re-run against the mutated app and must go red.
//
// Two of these exist because a green test is not evidence on its own:
//
//   "guard welded shut"   a guard that never releases blocks every close, so it
//                         passes every "it refuses the bad thing" assertion
//                         while making the application impossible to quit. Only
//                         the positive case can catch it.
//   "stubbed reported as native"
//                         dialog_coverage's one rule is that an automated run
//                         may never be reported as native-dialog coverage. If
//                         mutating the mark leaves the suite green, that rule is
//                         a promise rather than a control.
//
// red            the suite caught it
// GREEN          the suite does not notice — a hole
// DID NOT APPLY  the mutation never landed, so it measured nothing while
//                looking like it ran
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const DOCUMENTS = path.join(app, "dist", "main", "documents.js");
const MAIN = path.join(app, "dist", "main", "main.js");
const SUITE = path.join(here, "file-loop.test.mjs");

const MUTATIONS = [
  {
    label: "BOM dropped on write",
    file: DOCUMENTS,
    from: "return doc.bom ? Buffer.concat([BOM, body]) : body;",
    to: "return body;",
  },
  {
    label: "CRLF not preserved — everything written LF",
    file: DOCUMENTS,
    from: 'const withEol = doc.eol === "crlf" ? normalised.replace(/\\n/g, "\\r\\n") : normalised;',
    to: "const withEol = normalised;",
  },
  {
    label: "invalid UTF-8 silently repaired instead of refused",
    file: DOCUMENTS,
    from: 'text = new TextDecoder("utf-8", { fatal: true }).decode(body);',
    to: 'text = body.toString("utf8");',
  },
  {
    label: "refusal no longer names the file",
    file: DOCUMENTS,
    from: "super(`${fileName}: ${reason}`);",
    to: "super(reason);",
  },
  {
    label: "dirty flag never reaches main — guard cannot fire",
    file: MAIN,
    from: "current.dirty = dirty === true;",
    to: "current.dirty = false;",
  },
  {
    label: "guard welded shut — never releases",
    file: MAIN,
    from: "if (current.dirty) {\n            event.preventDefault();",
    to: "if (true) {\n            event.preventDefault();",
  },
  {
    label: "stubbed run reported as native coverage",
    file: MAIN,
    from: 'const dialogPathMark = () => (TEST_MODE ? "stubbed" : "native");',
    to: 'const dialogPathMark = () => "native";',
  },
  { label: "CONTROL. change nothing", control: true, file: MAIN, from: null, to: null },
];

const digest = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** Where the pristine build is kept, so a killed run can be undone next time. */
const SIDECAR = path.join(app, "dist", ".drill-pristine");

/**
 * Restore anything a previous run left planted, BEFORE planting anything new.
 *
 * A `finally` only runs if the process lives to reach it. On 2026-08-25 this
 * drill was killed mid-run and left `if (true)` welded into the compiled close
 * guard; the next `npm run build` happened to wash it out, but nothing had
 * guaranteed that, and a drill that reports on a poisoned build reports on the
 * wrong subject. So the pristine copy is written first and reinstated at
 * startup, and the reinstatement is announced rather than done quietly.
 */
function reinstatePristine(files, say) {
  if (!fs.existsSync(SIDECAR)) return;
  let restored = 0;
  for (const f of files) {
    const kept = path.join(SIDECAR, path.basename(f));
    if (!fs.existsSync(kept)) continue;
    if (fs.readFileSync(kept, "utf8") !== fs.readFileSync(f, "utf8")) {
      fs.writeFileSync(f, fs.readFileSync(kept, "utf8"), "utf8");
      restored += 1;
    }
  }
  if (restored > 0) {
    say(`  NOTE: a previous run left ${restored} file(s) mutated; restored from the`);
    say("        pristine sidecar before starting. A killed drill does not clean up.");
  }
}

function keepPristine(files) {
  fs.mkdirSync(SIDECAR, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(SIDECAR, path.basename(f)), fs.readFileSync(f, "utf8"), "utf8");
  }
}

/**
 * Run the suite, bounded.
 *
 * A mutation can make the SUBJECT hang — the welded-shut guard refuses every
 * close, so the app never exits. Without a bound the drill waits forever on the
 * defect it planted. Returns -1 for "the run did not report", which is reported
 * as its own state rather than silently counted as a catch.
 */
function failures() {
  // The tally goes to a FILE, not down a pipe.
  //
  // `spawnSync` waits for the stdout pipe to close, and on Windows that pipe is
  // held by every process that inherited it — including Electron helpers that
  // outlive the runner. Under the welded-guard mutation the app refuses to quit,
  // a helper survived, and spawnSync blocked on the pipe for its full timeout
  // even though the suite had already finished and printed `fail 1`. The result
  // was reported as "no tally" for the one mutation that most needed measuring:
  // the harness, not the subject, was the thing that hung.
  //
  // Redirecting to a file means the verdict survives a lingering grandchild.
  const out = path.join(app, "dist", ".drill-run.txt");
  try { fs.rmSync(out, { force: true }); } catch { /* first run */ }
  spawnSync(
    `"${process.execPath}" --test "${SUITE}" > "${out}" 2>&1`,
    { cwd: app, shell: true, timeout: 120_000, killSignal: "SIGKILL" });
  const text = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  const m = text.match(/^. fail (\d+)$/m);
  return m ? Number(m[1]) : -1;
}

// REMOVED 2026-08-25 — a process reaper that killed 16 Electron processes.
//
// It filtered on the app's path with PowerShell's Where-Object, and the filter
// did not survive being passed through a shell. ForEach-Object then ran
// Stop-Process -Force over EVERY electron.exe on the machine: 16 before, 0
// after, including the user's other applications.
//
// The lesson is not "quote it better". A cleanup step whose blast radius
// depends on a filter working is a cleanup step that deletes everything when
// the filter silently fails - and a filter that matches too much fails exactly
// like one that matches correctly, because both produce a clean run. Anything
// that kills, deletes, or overwrites outside its own scratch directory must
// prove its target list FIRST (print it, count it, compare against a known
// total) and only then act. Nothing here needed to kill anything at all.
//
// Stray Electron processes are handled where they are created instead: the
// suite's own teardown closes with a bound and kills the handle it owns.


export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-file-loop — can the A0 file-loop suite fail?\n");

  for (const f of [DOCUMENTS, MAIN, SUITE]) {
    if (!fs.existsSync(f)) {
      say(`  REFUSING: ${path.relative(app, f)} is missing. Run npm run build first.`);
      return { bad: 1 };
    }
  }

  const watched = [DOCUMENTS, MAIN];
  reinstatePristine(watched, say);      // undo a previous run's kill, before measuring
  keepPristine(watched);                // and leave a copy for the next one
  const before = Object.fromEntries(watched.map((f) => [f, digest(f)]));
  const originals = Object.fromEntries(watched.map((f) => [f, fs.readFileSync(f, "utf8")]));

  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  for (const m of MUTATIONS) {
    let applied = true;
    if (!m.control) {
      if (!originals[m.file].includes(m.from)) applied = false;
      else fs.writeFileSync(m.file, originals[m.file].replace(m.from, m.to), "utf8");
    }

    let fails = 0;
    if (applied) {
      fails = failures();
      for (const f of watched) fs.writeFileSync(f, originals[f], "utf8");
    }

    let verdict;
    if (!applied) { verdict = "DID NOT APPLY - measured nothing"; didNotApply += 1; }
    else if (fails === -1) {
      // The run produced no tally: it hung and was killed, or crashed. That is
      // NOT the same as the suite catching the mutation, and counting it as a
      // catch would let a mutation that merely breaks the harness look like one
      // the suite detected.
      verdict = "NO TALLY - the run did not report (hung or crashed)";
      didNotApply += 1;
    } else if (m.control) {
      verdict = fails === 0 ? "green, as a control must be" : `CONTROL WENT RED (${fails})`;
      if (fails !== 0) controlFailed = true;
    } else if (fails === 0) { verdict = "GREEN - the suite does not notice"; green += 1; }
    else verdict = `red, ${fails} test(s)`;
    say(`  ${m.label.padEnd(48)} ${verdict}`);
  }

  const restored = watched.every((f) => digest(f) === before[f]);
  say(`\n  built artifacts restored byte-identical: ${restored}`);
  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  say(`  ${MUTATIONS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", NOT RESTORED"}`);
  if (bad === 0) say("  every mutation was caught and nothing canonical moved");
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
