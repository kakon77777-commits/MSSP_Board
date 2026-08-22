// Adjacency-stacking evidence: does the ORDER of a fixed app portfolio change
// the early shared-capability count, with nothing else different?
//
//   node evidence/adjacency-ordering/calculate.mjs
//
// Everything this reads is in preregistration.json, which was pinned and
// hash-published to the append-only AI Board on 2026-08-21 BEFORE this file
// existed. The classification of each capability as generic_infra or domain was
// fixed there too, because a classification chosen after seeing the result is
// not a classification — that was Pragma's objection and it was correct.
//
//   pinned sha256 d1e49ec4d6f90df1c6ae6dfb70dd635061dccb9223bf85917653152cb9fbb813
//
// EVIDENCE LEVEL, stated by the author rather than inferred by the reader:
// this is a SPIKE ON A STATED MODEL. The app-to-capability map is my estimate
// of what these products need, not a measurement of built software. It can
// demonstrate that the mechanism exists. It cannot show that our portfolio will
// exhibit it. causal_claim_allowed = false.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// A run against the pinned manifest is the PUBLISHED CLAIM. A run against any
// other manifest is a computation, not a claim, and says so. Without this
// split the hash refusal fires first and masks every other check in the file:
// two of the four stated attacks below went red for the wrong reason, which is
// a defect caught by the wrong check.
const argIndex = process.argv.indexOf("--manifest");
const OVERRIDE = argIndex > -1 ? process.argv[argIndex + 1] : null;
// --verify recomputes and compares against the tracked artifact instead of
// overwriting it, so a stale committed result is caught rather than silently
// repaired by whoever happens to run the calculator next.
const VERIFY = process.argv.includes("--verify");
const PIN_PATH = OVERRIDE ? path.resolve(OVERRIDE) : path.join(here, "preregistration.json");
const PIN_BYTES = fs.readFileSync(PIN_PATH);
const PIN_SHA256 = crypto.createHash("sha256").update(PIN_BYTES).digest("hex");
const PIN = JSON.parse(PIN_BYTES.toString("utf8"));

// The hash the Board carries. If these disagree, the pinned file was edited
// after publication and every number below is worthless.
const PUBLISHED_SHA256 = "d1e49ec4d6f90df1c6ae6dfb70dd635061dccb9223bf85917653152cb9fbb813";

const CLASS = new Map();
for (const c of PIN.generic_infra) CLASS.set(c, "generic_infra");
for (const c of PIN.domain) CLASS.set(c, "domain");

// A capability is a shared_candidate once at least two apps in the sequence so
// far require it. Per the charter this is the SEMANTIC FLOOR of "shared" and
// nothing more — it does not mean the capability was implemented once.
function sharedAfter(order, k) {
  const seen = new Map();
  for (const app of order.slice(0, k)) {
    for (const cap of PIN.model_app_capabilities[app]) {
      seen.set(cap, (seen.get(cap) ?? []).concat ? [...(seen.get(cap) ?? []), app] : [app]);
    }
  }
  const rows = [];
  for (const [cap, apps] of seen) {
    if (apps.length >= 2) rows.push({ capability: cap, class: CLASS.get(cap) ?? "UNCLASSIFIED", consumers: apps });
  }
  rows.sort((a, b) => a.capability.localeCompare(b.capability));
  return rows;
}

function armReport(label, order) {
  const rows = sharedAfter(order, 2);
  const generic = rows.filter((r) => r.class === "generic_infra");
  const domain = rows.filter((r) => r.class === "domain");
  const unclassified = rows.filter((r) => r.class === "UNCLASSIFIED");
  return { label, order, app2: order[1], rows, total: rows.length,
    generic: generic.length, domain: domain.length, unclassified: unclassified.length };
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  const fail = [];

  say("\n=== adjacency-ordering — evidence for the charter's `adjacency stacking` attack");
  say(`\n  preregistration.json sha256 ${PIN_SHA256}`);
  say(`  published on the Board       ${PUBLISHED_SHA256}`);
  const pinIntact = PIN_SHA256 === PUBLISHED_SHA256;
  say(`  INTACT: ${pinIntact}`);
  if (!pinIntact && !OVERRIDE) {
    say("\n  REFUSING to report numbers. The pinned file no longer matches what was");
    say("  published before the run, so nothing below could be trusted.");
    return { refused: true };
  }
  if (OVERRIDE) {
    say(`\n  UNPINNED RUN against ${OVERRIDE}`);
    say("  This is a computation, not the published claim. Nothing below may be");
    say("  quoted as evidence for the charter.");
  }

  // Every capability used by the model must be classified. An unclassified one
  // would silently fall out of both columns and make the split look cleaner
  // than it is.
  const used = new Set(Object.values(PIN.model_app_capabilities).flat());
  const unclassified = [...used].filter((c) => !CLASS.has(c));
  say(`\n  capabilities used by the model: ${used.size}, unclassified: ${unclassified.length}`);
  if (unclassified.length) fail.push(`unclassified capabilities: ${unclassified.join(", ")}`);

  const A = armReport("arm A (near-twin second)", PIN.arm_A_order);
  const B = armReport("arm B (different second)", PIN.arm_B_order);

  for (const arm of [A, B]) {
    say(`\n  ${arm.label}`);
    say(`    app1 = ${arm.order[0]}   app2 = ${arm.app2}`);
    say(`    shared_candidate at app 2: ${arm.total}  (generic_infra ${arm.generic}, domain ${arm.domain})`);
    for (const r of arm.rows) {
      say(`      ${r.capability.padEnd(16)} ${r.class.padEnd(14)} ${r.consumers.join(" + ")}`);
    }
  }

  say("\n  --- the two arms differ only in the order ---");
  const sameApps = JSON.stringify([...PIN.arm_A_order].sort()) === JSON.stringify([...PIN.arm_B_order].sort());
  say(`    same app set          : ${sameApps}`);
  say(`    same capability map   : true (one file, read once)`);
  say(`    same classification   : true (one file, read once)`);
  if (!sameApps) fail.push("the two arms do not contain the same apps");

  say("\n  --- registered prediction, checked against the run ---");
  say(`    predicted: arm A strictly higher at app 2, and the excess entirely in domain`);
  const higher = A.total > B.total;
  const excessTotal = A.total - B.total;
  const excessDomain = A.domain - B.domain;
  const excessGeneric = A.generic - B.generic;
  say(`    observed : A ${A.total} vs B ${B.total}  -> strictly higher: ${higher}`);
  say(`               excess ${excessTotal}  (domain ${excessDomain}, generic_infra ${excessGeneric})`);
  const asPredicted = higher && excessDomain === excessTotal && excessGeneric === 0;
  say(`    PREDICTION HELD: ${asPredicted}`);
  if (!asPredicted) {
    say("\n    The falsification condition in the preregistration has been met.");
    say("    The claim must be withdrawn, not reworded.");
    fail.push("registered prediction did not hold");
  }

  const raw = `${JSON.stringify({ A, B, excessTotal, excessDomain, excessGeneric }, null, 2)}\n`;
  const rawSha = crypto.createHash("sha256").update(raw).digest("hex");
  const RESULT_PATH = path.join(here, "result.json");

  if (OVERRIDE) {
    // An unpinned run must NEVER write the canonical artifact. The first
    // version did, so the attack fixtures overwrote the published evidence
    // with their own output and the committed result.json ended up recording
    // 7 vs 7 - the artifact denying the very claim its commit message made.
    say(`\n  raw rows NOT written: this is an unpinned run, sha256 ${rawSha}`);
  } else if (VERIFY) {
    const tracked = fs.existsSync(RESULT_PATH) ? fs.readFileSync(RESULT_PATH, "utf8") : null;
    const fresh = tracked === raw;
    say(`\n  --verify: tracked result.json matches a fresh run: ${fresh}`);
    if (!fresh) {
      say("  The committed evidence artifact is STALE. It does not say what this");
      say("  calculator says, and a reader would take the file, not the run.");
      fail.push("tracked result.json is stale");
    }
  } else {
    fs.writeFileSync(RESULT_PATH, raw, "utf8");
    say(`\n  raw rows written to result.json, sha256 ${rawSha}`);
  }

  say("\n  EVIDENCE LEVEL: spike on a stated model. Not a measurement of built");
  say("  software. causal_claim_allowed = false — this shows the mechanism can");
  say("  occur, not that our portfolio will exhibit it.");

  say("");
  if (fail.length) {
    say(`  ${fail.length} PROBLEM(S): ${fail.join(" | ")}`);
    return { refused: false, ok: false, fail };
  }
  say("  no problems");
  return { refused: false, ok: true, A, B };
}

// ATTACK:
//   a. edit preregistration.json  -> the hash check must refuse to print any
//      number at all, not merely warn.
//   b. copy the manifest, remove a capability from the `domain` list, run with
//      --manifest  -> it must be reported as UNCLASSIFIED, not silently dropped
//      from both columns.
//   c. copy the manifest, make arm B's order identical to arm A, run with
//      --manifest  -> `same app set` stays true and the prediction FAILS,
//      because the mechanism needs the orders to differ.
//   d. swap the prediction to "arm B higher" -> PREDICTION HELD must go false.
//      A prediction that cannot fail is decoration.
//   e. hand-edit result.json, then run with --verify -> must report the tracked
//      artifact as STALE. Found by Pragma on PR #15: the committed result.json
//      recorded 7 vs 7 while the commit message claimed 7 vs 4, because an
//      unpinned attack run had written over it.
//
// b and c MUST go through --manifest. Run against the pinned file they go red
// on the hash check instead — red for a reason that has nothing to do with what
// the attack was written to test. The first version of this file had exactly
// that defect, and the run that "verified" b and c had silently re-run the
// pinned manifest twice.

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = run();
  process.exitCode = r.refused || r.ok === false ? 1 : 0;
}
