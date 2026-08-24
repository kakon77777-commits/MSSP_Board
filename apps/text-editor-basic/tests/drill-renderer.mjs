// Prove the generated-page gate can fail.
//
//   node apps/text-editor-basic/tests/drill-renderer.mjs
//
// scripts/render-renderer.mjs ends with an ATTACK list. This file is what makes
// that list a claim about behaviour rather than a comment. The distinction is
// not academic: slice 01's render-readme.mjs once carried an ATTACK note saying
// "the JSON-side rule refuses it" when no such rule existed, and it read as
// covered precisely because the note was there.
//
// Two different things are drilled, and they are not interchangeable:
//   --check  must go RED when the shipped page and the contract disagree
//   render   must REFUSE outright when the template can no longer be generated
//            from the contract, rather than emitting a page built from whatever
//            someone typed by hand
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const SCRIPT = path.join(app, "scripts", "render-renderer.mjs");
const TEMPLATE = path.join(app, "src", "renderer", "index.template.html");
const SECURITY_SRC = path.join(app, "src", "main", "security.ts");
const SECURITY_BUILT = path.join(app, "dist", "main", "security.js");
const INDEX = path.join(app, "dist", "renderer", "index.html");

const digest = (f) => (fs.existsSync(f)
  ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")
  : "ABSENT");

function runCheck() {
  const r = spawnSync(process.execPath, [SCRIPT, "--check"], { cwd: app, encoding: "utf8" });
  // Report the FAIL line, not the last line. Every failure mode ends with the
  // same "run: npm run build" hint, so taking the tail rendered a missing file
  // and a stale file identically — three distinct reds printed as one string,
  // and a drill whose verdicts cannot be told apart cannot show which one broke.
  const lines = (r.stdout ?? "").trim().split("\n");
  const line = lines.find((l) => l.includes("FAIL"))
    ?? lines.find((l) => l.includes("ok "))
    ?? lines.pop()
    ?? "";
  return { status: r.status, out: line.replace(/^\s*(FAIL|ok)\s*/, "").trim() };
}

function runRender() {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: app, encoding: "utf8" });
  // An uncaught throw prints the offending file path first and the reason
  // several lines down, so taking line 1 reports a path and calls it a refusal.
  // The exit code alone would still have "passed" this drill while telling a
  // reader nothing — a refusal nobody can read is half a control.
  const text = ((r.stderr || "") + (r.stdout || "")).trim();
  const reason = text.split("\n").find((l) => /Error:/.test(l))
    ?? text.split("\n").find((l) => l.trim() && !/^file:|^\s+at /.test(l))
    ?? "(no reason printed)";
  return { status: r.status, out: reason.replace(/^.*?Error:\s*/, "").trim() };
}

const ATTACKS = [
  {
    label: "a. edit the CSP inside the shipped page",
    file: INDEX,
    mutate: (s) => s.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
    expect: "check-red",
  },
  {
    label: "b. change the contract without rebuilding",
    file: SECURITY_BUILT,
    mutate: (s) => s.replace('"connect-src \'none\'"', '"connect-src https://api.example.com"'),
    expect: "check-red",
  },
  {
    label: "c. delete the generated page",
    file: INDEX,
    mutate: null,                 // delete rather than edit
    expect: "check-red",
  },
  {
    label: "d. hand-write a policy over the placeholder",
    file: TEMPLATE,
    mutate: (s) => s.replace("__CSP__", "default-src *"),
    expect: "render-refuses",
  },
  { label: "CONTROL. change nothing", control: true, expect: "check-green" },
];

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-renderer — can the generated-page gate fail?\n");

  for (const f of [SCRIPT, TEMPLATE, SECURITY_BUILT, INDEX]) {
    if (!fs.existsSync(f)) {
      say(`  REFUSING: ${path.relative(app, f)} is missing. Run npm run build first.`);
      return { bad: 1 };
    }
  }

  const watched = [TEMPLATE, SECURITY_SRC, SECURITY_BUILT, INDEX];
  const before = Object.fromEntries(watched.map((f) => [f, digest(f)]));
  const originals = Object.fromEntries(
    watched.filter((f) => fs.existsSync(f)).map((f) => [f, fs.readFileSync(f, "utf8")]));

  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  for (const a of ATTACKS) {
    let applied = true;
    let verdict;

    if (!a.control) {
      if (a.mutate === null) {
        fs.unlinkSync(a.file);
      } else {
        const next = a.mutate(originals[a.file]);
        if (next === originals[a.file]) applied = false;
        else fs.writeFileSync(a.file, next, "utf8");
      }
    }

    if (!applied) {
      verdict = "DID NOT APPLY - measured nothing";
      didNotApply += 1;
    } else if (a.expect === "render-refuses") {
      // The point is that generation STOPS. A gate that merely goes red here
      // would still leave a hand-written policy in the template for the next
      // person to build from.
      const r = runRender();
      if (r.status !== 0) verdict = `render refused: ${r.out.slice(0, 58)}`;
      else { verdict = "GREEN - render emitted a hand-written policy"; green += 1; }
    } else {
      const r = runCheck();
      const wantRed = a.expect === "check-red";
      const isRed = r.status !== 0;
      if (isRed === wantRed) {
        verdict = wantRed ? `check red: ${r.out.trim().slice(0, 52)}` : "green, as a control must be";
      } else if (wantRed) { verdict = "GREEN - the check does not notice"; green += 1; }
      else { verdict = "CONTROL WENT RED"; controlFailed = true; }
    }

    // Restore before the next attack, so failures cannot compound.
    for (const f of watched) {
      if (originals[f] !== undefined) fs.writeFileSync(f, originals[f], "utf8");
    }
    say(`  ${a.label.padEnd(42)} ${verdict}`);
  }

  const restored = watched.every((f) => digest(f) === before[f]);
  say(`\n  watched files restored byte-identical: ${restored}`);
  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (restored ? 0 : 1);
  say(`  ${ATTACKS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${restored ? "" : ", NOT RESTORED"}`);
  if (bad === 0) say("  every attack was refused and nothing canonical moved");
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
