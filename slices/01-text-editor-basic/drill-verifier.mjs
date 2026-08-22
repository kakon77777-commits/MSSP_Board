// Prove the verifier can fail.
//
//   node slices/01-text-editor-basic/drill-verifier.mjs
//
// Every mutation is applied to a throwaway copy under the OS temp directory.
// The canonical slice is never written to, so a drill cannot self-heal or
// corrupt the artifacts it is testing — which is exactly what happened to the
// adjacency evidence on PR #15, where the attack fixtures overwrote the
// published result.
//
// Three outcomes, and the third is the one worth having:
//   red            the verifier caught it
//   GREEN          the verifier did not notice — a hole in the verifier
//   DID NOT APPLY  the mutation never landed, so it measured nothing while
//                  looking like it ran
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verify } from "./verify-preregistration.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slice01-drill-"));
  fs.cpSync(here, dir, { recursive: true });
  return dir;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");

const DRILLS = [
  {
    label: "a. remove one capability's acceptance row",
    apply(dir) {
      const p = path.join(dir, "preregistration.json");
      const d = readJson(p);
      const victim = d.required_capabilities.domain[0];
      if (!(victim in d.capability_acceptance_map)) return false;
      delete d.capability_acceptance_map[victim];
      writeJson(p, d);
      return true;
    },
  },
  {
    label: "b. add an acceptance row nothing requires",
    apply(dir) {
      const p = path.join(dir, "preregistration.json");
      const d = readJson(p);
      if ("drill-orphan" in d.capability_acceptance_map) return false;
      d.capability_acceptance_map["drill-orphan"] = "a row for a capability that is not required";
      writeJson(p, d);
      return true;
    },
  },
  {
    label: "c. flip one byte in a fixture",
    apply(dir) {
      const d = readJson(path.join(dir, "preregistration.json"));
      const key = Object.keys(d.fixtures)[0];
      const file = path.join(dir, "fixtures", d.fixtures[key].file);
      const buf = fs.readFileSync(file);
      if (buf.length === 0) return false;
      buf[0] = buf[0] ^ 0x01;
      fs.writeFileSync(file, buf);
      return true;
    },
  },
  {
    label: "d. delete a fixture",
    apply(dir) {
      const d = readJson(path.join(dir, "preregistration.json"));
      const key = Object.keys(d.fixtures).at(-1);
      const file = path.join(dir, "fixtures", d.fixtures[key].file);
      if (!fs.existsSync(file)) return false;
      fs.rmSync(file);
      return true;
    },
  },
  {
    label: "e. delete a superseded revision file",
    apply(dir) {
      const d = readJson(path.join(dir, "preregistration.json"));
      const prior = (d.supersedes ?? [])[0];
      if (!prior) return false;
      const p = path.join(dir, prior.kept_at);
      if (!fs.existsSync(p)) return false;
      fs.rmSync(p);
      return true;
    },
  },
  // g-i exist because the verifier used to compare only the manifest's KEY SET.
  // Measured before the fix: zeroing a manifest sha256 and setting its bytes to
  // 999999 left the verifier at exit 0. A manifest check existed, so the
  // manifest looked covered.
  {
    label: "g. mutate a MANIFEST entry's sha256",
    apply(dir) {
      const p = path.join(dir, "fixtures", "MANIFEST.json");
      const m = readJson(p);
      const key = Object.keys(m)[0];
      if (!key) return false;
      m[key].sha256 = "0".repeat(64);
      writeJson(p, m);
      return true;
    },
  },
  {
    label: "h. mutate a MANIFEST entry's bytes",
    apply(dir) {
      const p = path.join(dir, "fixtures", "MANIFEST.json");
      const m = readJson(p);
      const key = Object.keys(m).at(-1);
      if (!key) return false;
      m[key].bytes = m[key].bytes + 1;
      writeJson(p, m);
      return true;
    },
  },
  {
    label: "i. mutate a MANIFEST entry's file name",
    apply(dir) {
      const p = path.join(dir, "fixtures", "MANIFEST.json");
      const m = readJson(p);
      const key = Object.keys(m)[1] ?? Object.keys(m)[0];
      if (!key) return false;
      m[key].file = `renamed-${m[key].file}`;
      writeJson(p, m);
      return true;
    },
  },
  {
    label: "j. add a MANIFEST entry nothing declares",
    apply(dir) {
      const p = path.join(dir, "fixtures", "MANIFEST.json");
      const m = readJson(p);
      if ("drill_extra" in m) return false;
      m.drill_extra = { file: "drill-extra.txt", bytes: 1, sha256: "0".repeat(64) };
      writeJson(p, m);
      return true;
    },
  },
  {
    label: "f. make the generated README stale",
    apply(dir) {
      const p = path.join(dir, "README.md");
      if (!fs.existsSync(p)) return false;
      fs.appendFileSync(p, "\ntampered by a drill\n", "utf8");
      return true;
    },
  },
  {
    label: "CONTROL. change nothing at all",
    control: true,
    apply() { return true; },
  },
];

function canonicalDigest() {
  // Everything the drills could conceivably touch, hashed, so a drill that
  // escaped its sandbox is detected rather than assumed impossible.
  const files = fs.readdirSync(here, { recursive: true })
    .map((f) => path.join(here, String(f)))
    .filter((f) => fs.statSync(f).isFile())
    .sort();
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(path.relative(here, f)).update(fs.readFileSync(f));
  return h.digest("hex");
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-verifier — can verify-preregistration.mjs fail?");
  const before = canonicalDigest();

  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  for (const drill of DRILLS) {
    const dir = sandbox();
    const applied = drill.apply(dir);
    let result = { ok: null, problems: [] };
    if (applied) {
      const original = process.stdout.write.bind(process.stdout);
      process.stdout.write = () => true;          // the drill's own output is noise
      try { result = verify(dir); } finally { process.stdout.write = original; }
    }
    fs.rmSync(dir, { recursive: true, force: true });

    let verdict;
    if (!applied) { verdict = "DID NOT APPLY - measured nothing"; didNotApply += 1; }
    else if (drill.control) {
      verdict = result.ok ? "green, as a control must be" : `CONTROL WENT RED: ${result.problems.join(", ")}`;
      if (!result.ok) controlFailed = true;
    } else if (result.ok) { verdict = "GREEN - the verifier does not notice. Fix the verifier."; green += 1; }
    else verdict = `red, ${result.problems.length} problem(s)`;
    say(`  ${drill.label.padEnd(48)} ${verdict}`);
  }

  const after = canonicalDigest();
  const untouched = before === after;
  say(`\n  canonical slice untouched by the drills: ${untouched}`);

  say("");
  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (untouched ? 0 : 1);
  say(`  ${DRILLS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${untouched ? "" : ", CANONICAL MUTATED"}`);
  if (bad === 0) say("  every mutation was caught, the control stayed green, and nothing canonical moved");
  return { bad };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
