// Fail-closed verifier for the slice 01 preregistration.
//
//   node slices/01-text-editor-basic/verify-preregistration.mjs
//   node slices/01-text-editor-basic/verify-preregistration.mjs --root <dir>
//
// This exists because Pragma and Metron found that the 11/11 capability map and
// the fixture hashes were true only because REVIEWERS had recomputed them by
// hand. Nothing in the repository enforced them. Worse, render-readme.mjs's
// ATTACK (b) said "the JSON-side rule refuses it" and there was no JSON-side
// rule — a claim in a comment with nothing behind it, which is the same defect
// as an attack listed in prose.
//
// --root lets the drill runner point this at a throwaway copy, so a mutation
// never touches the canonical artifacts.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootIndex = process.argv.indexOf("--root");
const ROOT = rootIndex > -1 ? path.resolve(process.argv[rootIndex + 1]) : here;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function verify(root = ROOT) {
  const problems = [];
  const say = (line = "") => process.stdout.write(`${line}\n`);
  const check = (label, ok, detail = "") => {
    say(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
    if (!ok) problems.push(label);
  };

  const jsonPath = path.join(root, "preregistration.json");
  if (!fs.existsSync(jsonPath)) {
    say(`  FAIL preregistration.json is missing at ${root}`);
    return { ok: false, problems: ["preregistration.json missing"] };
  }
  const bytes = fs.readFileSync(jsonPath);
  let d;
  try {
    d = JSON.parse(bytes.toString("utf8"));
  } catch (raised) {
    say(`  FAIL preregistration.json does not parse - ${raised.message}`);
    return { ok: false, problems: ["preregistration.json unparseable"] };
  }

  say(`\n=== verify-preregistration  (${d.app_id} ${d.revision})`);
  say(`  sha256 ${sha256(bytes)}`);

  // 1 + 2. capability map exactness, both directions.
  const caps = [...d.required_capabilities.generic_infra, ...d.required_capabilities.domain];
  const rows = Object.keys(d.capability_acceptance_map ?? {});
  const missing = caps.filter((c) => !rows.includes(c));
  const orphan = rows.filter((r) => !caps.includes(r));
  check("every required capability has an acceptance row", missing.length === 0, missing.join(", "));
  check("no orphan acceptance rows", orphan.length === 0, orphan.join(", "));
  check("counts agree", caps.length === rows.length, `${caps.length} capabilities, ${rows.length} rows`);

  // 3-6. fixtures: the declared set, and every file's length and hash.
  const manifestPath = path.join(root, "fixtures", "MANIFEST.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  check("fixtures/MANIFEST.json exists", manifest !== null);
  if (manifest) {
    const declared = Object.keys(d.fixtures ?? {}).sort();
    const inManifest = Object.keys(manifest).sort();
    check("preregistration fixture set equals the manifest set",
      JSON.stringify(declared) === JSON.stringify(inManifest),
      `prereg [${declared}] vs manifest [${inManifest}]`);
    for (const [key, want] of Object.entries(d.fixtures ?? {})) {
      const file = path.join(root, "fixtures", want.file);
      if (!fs.existsSync(file)) {
        check(`fixture ${key} exists`, false, want.file);
        continue;
      }
      const got = fs.readFileSync(file);
      check(`fixture ${key} byte length`, got.length === want.bytes, `${got.length} vs ${want.bytes}`);
      check(`fixture ${key} sha256`, sha256(got) === want.sha256, `${sha256(got).slice(0, 16)}… vs ${want.sha256.slice(0, 16)}…`);
    }
  }

  // 7. superseded revisions are still present and still hash to what they claim.
  for (const prior of d.supersedes ?? []) {
    const p = path.join(root, prior.kept_at);
    if (!fs.existsSync(p)) {
      check(`superseded ${prior.version} kept at ${prior.kept_at}`, false, "file missing");
      continue;
    }
    const got = sha256(fs.readFileSync(p));
    check(`superseded ${prior.version} hash unchanged`, got === prior.sha256,
      `${got.slice(0, 16)}… vs ${prior.sha256.slice(0, 16)}…`);
  }

  // 8. generated README is not stale. Rendering lives in render-readme.mjs, so
  // this RUNS it rather than re-implementing the template — otherwise the
  // verifier and the renderer become two views that can drift, which is the
  // defect this whole file exists to close.
  //
  // The first version of this check only asked whether README.md existed while
  // the comment above it claimed it asked the renderer. Same defect as the
  // ATTACK comment that cited a validator which did not exist.
  const readmePath = path.join(root, "README.md");
  if (!fs.existsSync(readmePath)) {
    check("README.md exists", false);
  } else {
    const renderer = path.join(root, "render-readme.mjs");
    const r = spawnSync(process.execPath, [renderer, "--check"], { cwd: root, encoding: "utf8" });
    check("README.md is not stale", r.status === 0,
      r.status === 0 ? "" : (r.stdout ?? "").trim().split("\n")[0]);
  }

  say("");
  if (problems.length) say(`  ${problems.length} PROBLEM(S) — fail closed`);
  else say("  all invariants hold");
  return { ok: problems.length === 0, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = verify().ok ? 0 : 1;
}

// ATTACK: see drill-verifier.mjs, which applies each of these to a throwaway
// copy and requires the verifier to go red:
//   a. remove one capability's acceptance row
//   b. add an acceptance row for a capability that is not required
//   c. flip one byte in a fixture
//   d. delete a fixture
//   e. delete a superseded revision file
//   f. make the generated README stale
// plus a CONTROL that changes nothing and must stay green, and a digest of the
// canonical directory taken before and after, so a drill that escaped its
// sandbox is detected rather than assumed impossible.
//
// A drill whose mutation did not apply is reported as its own state, because a
// mutation that never landed measured nothing while looking like it ran.
