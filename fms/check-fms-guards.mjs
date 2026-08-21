// Every guard in build-fms.mjs, drilled against a throwaway copy.
//
// Written the same day the guards were, because yesterday's version of this
// mechanism shipped with a governance violation inside it and the way that was
// found was somebody else running it. A guard nobody has watched fail is a
// claim.
//
//   node scripts/check-fms-guards.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "fms");
const builder = path.join(root, "fms", "build-fms.mjs");
const failures = [];
// Captured before anything runs, so "this runner changed nothing" is a
// measurement rather than an intention.
const moduleBefore = fs.readFileSync(path.join(root, "fms", "08-fms.generated.md"), "utf8");
const ledgerBefore = fs.readFileSync(path.join(source, "effective.json"), "utf8");

const check = (label, ok, detail = "") => {
  process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}\n`);
  if (!ok) failures.push(label);
};

function sandbox(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fms-guard-"));
  fs.cpSync(source, dir, { recursive: true });
  const branch = (name) => path.join(dir, "branches", `${name}.json`);
  const load = (name) => JSON.parse(fs.readFileSync(branch(name), "utf8"));
  const save = (name, value) => fs.writeFileSync(branch(name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  mutate({ dir, branch, load, save });
  return runBuilder(dir);
}

function runBuilder(dir, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [builder, ...args],
      { env: { ...process.env, FMS_DIR: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: stdout, dir };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}`, dir };
  }
}

const readProjection = (dir) => JSON.parse(
  fs.readFileSync(path.join(dir, "projection.generated.json"), "utf8"));

process.stdout.write("\n== the actor set is exact, not a floor\n");
let run = sandbox(({ dir }) =>
  fs.writeFileSync(path.join(dir, "branches", "someone-else.json"),
    JSON.stringify({ _branch: "someone-else", core: {} }), "utf8"));
check("a fourth branch file is refused", run.code !== 0 && /not one of the three actors/.test(run.out),
  run.out.trim().split("\n").find((l) => l.includes("actors"))?.trim());
run = sandbox(({ dir }) => fs.rmSync(path.join(dir, "branches", "pragma.json")));
check("a missing branch is refused", run.code !== 0 && /is missing/.test(run.out),
  run.out.trim().split("\n").find((l) => l.includes("missing"))?.trim());
run = sandbox(({ load, save }) => { const b = load("metron"); b._branch = "elenchos"; save("metron", b); });
check("a filename that disagrees with _branch is refused",
  run.code !== 0 && /identity is not bound/.test(run.out),
  run.out.trim().split("\n").find((l) => l.includes("identity"))?.trim());

process.stdout.write("\n== the core may be added to, not moved\n");
run = sandbox(({ load, save }) => {
  const b = load("metron"); b.core.sibling_rule = "siblings are fine actually"; save("metron", b);
});
check("a branch that edits an invariant key is refused",
  run.code !== 0 && /differs from core\.json/.test(run.out),
  run.out.trim().split("\n").find((l) => l.includes("differs"))?.trim());

process.stdout.write("\n== key order is not disagreement\n");
const claim = { title: "a test claim", status: "candidate", why: "to drill canonicalisation" };
const reordered = { why: claim.why, title: claim.title, status: claim.status };
run = sandbox(({ load, save }) => {
  for (const [name, body] of [["elenchos", claim], ["metron", claim], ["pragma", reordered]]) {
    const b = load(name); b.proposals = { ...(b.proposals ?? {}), drill_claim: body }; save(name, b);
  }
});
const reorderedProjection = readProjection(run.dir);
check("three branches holding the same claim in different key order agree",
  run.code === 0
    && reorderedProjection.consensus_candidates.some((entry) => entry.id === "drill_claim"),
  run.out.trim().split("\n")[0]);

process.stdout.write("\n== identical content is NOT approval\n");
check("and three identical claims with no attestation stay out of the effective trunk",
  run.code === 0
    && !reorderedProjection.effective_trunk.some((entry) => entry.claim === "drill_claim"),
  run.out.trim().split("\n")[0]);

process.stdout.write("\n== an attestation is bound to what was read\n");
run = sandbox(({ load, save }) => {
  const b = load("elenchos");
  b.proposals.fms_should_get_smaller.why = "edited after the attestation was written";
  save("elenchos", b);
});
check("editing a claim invalidates its own author's attestation",
  /INVALID .*fms_should_get_smaller.*changed since it was attested/.test(run.out),
  run.out.trim().split("\n").find((l) => l.includes("INVALID"))?.trim());
process.stdout.write("\n== the one that matters: an effective entry is superseded, never revoked\n");
// Objection 4. In v1, one branch editing a key removed it from the trunk, which
// treated proposing a candidate as cancelling a version the other two held.
const attestAll = ({ load, save }) => {
  for (const name of ["elenchos", "metron", "pragma"]) {
    const b = load(name);
    b.proposals = { ...(b.proposals ?? {}), drill_claim: claim };
    save(name, b);
  }
};
const dirWithClaim = sandbox(attestAll).dir;
const digestOf = execFileSync(process.execPath, [builder, "--digests"],
  { env: { ...process.env, FMS_DIR: dirWithClaim }, encoding: "utf8" })
  .split("\n").find((line) => line.includes("drill_claim"))?.trim().split(/\s+/)[0];
const coreRevision = execFileSync(process.execPath, [builder, "--digests"],
  { env: { ...process.env, FMS_DIR: dirWithClaim }, encoding: "utf8" })
  .split("\n")[0].trim().split(/\s+/).at(-1);

run = sandbox(({ load, save }) => {
  attestAll({ load, save });
  const b = load("elenchos");
  b.decisions = [...(b.decisions ?? []),
    { id: "elenchos-drill-wrong-core", kind: "attest", claim: "drill_claim",
      digest: digestOf, core_revision: "0000000000000000" }];
  save("elenchos", b);
});
check("an attestation against another core revision is invalid",
  /INVALID .*drill_claim.*different core revision/.test(run.out),
  run.out.trim().split("\n").find((l) => l.includes("INVALID") && l.includes("drill_claim"))?.trim());

const withThreeAttestations = ({ load, save }) => {
  attestAll({ load, save });
  for (const name of ["elenchos", "metron", "pragma"]) {
    const b = load(name);
    b.decisions = [...(b.decisions ?? []),
      { id: `${name}-drill-a1`, kind: "attest", claim: "drill_claim",
        digest: digestOf, core_revision: coreRevision }];
    save(name, b);
  }
};
run = sandbox(withThreeAttestations);
const activatedProjection = readProjection(run.dir);
const activatedRow = activatedProjection.effective_trunk.find((entry) => entry.claim === "drill_claim");
check("three attestations over one claim make it effective",
  run.code === 0 && activatedRow?.status === "live" && activatedRow?.backing_state === "unanimous",
  run.out.trim().split("\n")[0]);
const activatedLedger = JSON.parse(fs.readFileSync(path.join(run.dir, "effective.json"), "utf8"));
const activatedEntry = activatedLedger.entries.find((e) => e.claim === "drill_claim");
check("an activation carries an id and exactly one decision ref per actor",
  activatedEntry?.activation_id?.startsWith("activation-")
    && JSON.stringify(Object.keys(activatedEntry.decision_refs ?? {}).sort())
      === JSON.stringify(["elenchos", "metron", "pragma"]),
  activatedEntry ? `${activatedEntry.activation_id} / ${JSON.stringify(activatedEntry.decision_refs)}` : "missing");

// Now edit one branch's copy. Under v1 the key left the trunk immediately.
const effectiveDir = sandbox(withThreeAttestations).dir;
const b = JSON.parse(fs.readFileSync(path.join(effectiveDir, "branches", "pragma.json"), "utf8"));
b.proposals.drill_claim = { ...claim, why: "pragma is now proposing something else" };
fs.writeFileSync(path.join(effectiveDir, "branches", "pragma.json"), JSON.stringify(b, null, 2), "utf8");
const after = execFileSync(process.execPath, [builder],
  { env: { ...process.env, FMS_DIR: effectiveDir }, encoding: "utf8" });
const ledger = JSON.parse(fs.readFileSync(path.join(effectiveDir, "effective.json"), "utf8"));
const entry = ledger.entries.find((e) => e.claim === "drill_claim");
// Derived state moved out of the ledger on 2026-08-13, because calling the file
// append-only while rewriting `superseded_by` and `currently_backed_by` into
// existing entries was a name disagreeing with the behaviour — Pragma's point.
// This drill caught the move itself, which is the only reason it is worth having.
const projectionAfter = JSON.parse(
  fs.readFileSync(path.join(effectiveDir, "projection.generated.json"), "utf8"));
const row = projectionAfter.effective_trunk.find((e) => e.claim === "drill_claim");
check("one branch proposing a change does NOT remove the effective entry",
  Boolean(entry) && row?.status === "live",
  after.trim().split("\n")[0]);
check("the ledger entry itself carries no derived state",
  entry.currently_backed_by === undefined && entry.superseded_by === undefined,
  Object.keys(entry).join(", "));
check("and the report shows its backing has weakened instead",
  row.currently_backed_by.length === 2 && row.backing_state === "contested",
  `${row.backing_state}, backed by ${row.currently_backed_by.join(", ")}`);

process.stdout.write("\n== replacement is a new three-owner activation, not implicit rollback\n");
const replacementBody = { ...claim, why: "a replacement accepted by all three owners" };
const prepareReplacement = ({ target = "current", claimId = "drill_claim",
  body = replacementBody, idSuffix = "a2" } = {}) => {
  const dir = sandbox(withThreeAttestations).dir;
  const ledgerFile = path.join(dir, "effective.json");
  const firstLedger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const first = firstLedger.entries.find((entry) => entry.claim === "drill_claim");
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.proposals = { ...(branch.proposals ?? {}), [claimId]: body };
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }
  const digestLines = runBuilder(dir, ["--digests"]).out;
  const replacementDigest = digestLines.split("\n")
    .find((line) => line.includes(claimId))?.trim().split(/\s+/)[0];
  const targetId = target === "current" ? first.activation_id
    : target === "missing" ? "activation-does-not-exist" : null;
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.decisions.push({ id: `${name}-drill-${idSuffix}`, kind: "attest",
      claim: claimId, digest: replacementDigest, core_revision: coreRevision,
      ...(targetId ? { replaces_activation_id: targetId } : {}) });
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }
  return { dir, first, replacementDigest, baselineEntryCount: firstLedger.entries.length,
    result: runBuilder(dir) };
};

const replacement = prepareReplacement();
const replacementLedger = JSON.parse(
  fs.readFileSync(path.join(replacement.dir, "effective.json"), "utf8"));
const replacementProjection = JSON.parse(
  fs.readFileSync(path.join(replacement.dir, "projection.generated.json"), "utf8"));
const replacementEntries = replacementLedger.entries.filter((entry) => entry.claim === "drill_claim");
const replacementRows = replacementProjection.history.filter((entry) => entry.claim === "drill_claim");
check("three replacement decisions append a second activation",
  replacement.result.code === 0 && replacementEntries.length === 2,
  `${replacementEntries.length} activation(s)`);
check("the replacement explicitly points to the immediately previous activation",
  replacementEntries[1]?.replaces_activation_id === replacementEntries[0]?.activation_id,
  `${replacementEntries[1]?.replaces_activation_id} -> ${replacementEntries[0]?.activation_id}`);
check("projection derives one superseded activation followed by one live activation",
  replacementRows[0]?.status === "superseded"
    && replacementRows[0]?.replaced_by_activation_id === replacementRows[1]?.activation_id
    && replacementRows[1]?.status === "live",
  replacementRows.map((entry) => `${entry.status}:${entry.activation_id}`).join(", "));

{
  const attempt = prepareReplacement();
  const file = path.join(attempt.dir, "branches", "pragma.json");
  const branch = JSON.parse(fs.readFileSync(file, "utf8"));
  branch.decisions.push({ id: "pragma-drill-w2", kind: "withdraw", target: "pragma-drill-a2" });
  fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  const result = runBuilder(attempt.dir);
  const projection = JSON.parse(
    fs.readFileSync(path.join(attempt.dir, "projection.generated.json"), "utf8"));
  const history = projection.history.filter((entry) => entry.claim === "drill_claim");
  const liveDrillRow = projection.effective_trunk.find((entry) => entry.claim === "drill_claim");
  check("withdrawing from the replacement contests it without reviving the old activation",
    result.code === 0 && history.length === 2
      && history[0]?.status === "superseded"
      && history[1]?.status === "live" && history[1]?.backing_state === "contested"
      && liveDrillRow?.activation_id === history[1]?.activation_id,
    history.map((entry) => `${entry.status}/${entry.backing_state}`).join(", "));
}

{
  const attempt = prepareReplacement();
  const ledgerFile = path.join(attempt.dir, "effective.json");
  const beforeRollback = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const current = beforeRollback.entries.filter((entry) => entry.claim === "drill_claim").at(-1);
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(attempt.dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.proposals.drill_claim = claim;
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }
  const digestLines = runBuilder(attempt.dir, ["--digests"]).out;
  const rollbackDigest = digestLines.split("\n")
    .find((line) => line.includes("drill_claim"))?.trim().split(/\s+/)[0];
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(attempt.dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.decisions.push({ id: `${name}-drill-rollback`, kind: "attest",
      claim: "drill_claim", digest: rollbackDigest, core_revision: coreRevision,
      replaces_activation_id: current.activation_id });
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }
  const result = runBuilder(attempt.dir);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const entries = ledger.entries.filter((entry) => entry.claim === "drill_claim");
  const projection = JSON.parse(
    fs.readFileSync(path.join(attempt.dir, "projection.generated.json"), "utf8"));
  const history = projection.history.filter((entry) => entry.claim === "drill_claim");
  const liveDrillRow = projection.effective_trunk.find((entry) => entry.claim === "drill_claim");
  check("an explicit three-owner rollback appends a third activation",
    result.code === 0 && entries.length === 3
      && entries[2]?.digest === entries[0]?.digest
      && entries[2]?.replaces_activation_id === entries[1]?.activation_id,
    `${entries.length} activations; ${entries[2]?.replaces_activation_id} replaces ${entries[1]?.activation_id}`);
  check("rollback preserves both earlier activations and makes only the third live",
    history.map((entry) => entry.status).join(",") === "superseded,superseded,live"
      && liveDrillRow?.activation_id === history[2]?.activation_id,
    history.map((entry) => `${entry.status}:${entry.activation_id}`).join(", "));
}

for (const [label, options, expected] of [
  ["replacement decisions with no target", { target: "none" }, "requires replaces_activation_id"],
  ["replacement decisions with a missing target", { target: "missing" }, "does not exist"],
  ["replacement decisions targeting another claim", {
    target: "current", claimId: "other_claim",
    body: { title: "another claim", status: "candidate", why: "must not replace drill_claim" },
  }, "belongs to claim"],
]) {
  const attempt = prepareReplacement(options);
  const attemptLedger = JSON.parse(fs.readFileSync(path.join(attempt.dir, "effective.json"), "utf8"));
  check(`${label} do not activate`,
    attemptLedger.entries.length === attempt.baselineEntryCount && attempt.result.out.includes(expected),
    attempt.result.out.split("\n").find((line) => line.includes(expected))?.trim());
}

{
  const dir = replacement.dir;
  const oldActivationId = replacementEntries[0].activation_id;
  const thirdBody = { ...claim, why: "a competing successor that points behind the live revision" };
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.proposals.drill_claim = thirdBody;
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }
  const digestLines = runBuilder(dir, ["--digests"]).out;
  const thirdDigest = digestLines.split("\n")
    .find((line) => line.includes("drill_claim"))?.trim().split(/\s+/)[0];
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.decisions.push({ id: `${name}-drill-a3`, kind: "attest",
      claim: "drill_claim", digest: thirdDigest, core_revision: coreRevision,
      replaces_activation_id: oldActivationId });
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }
  const attempt = runBuilder(dir);
  const ledgerAfterAttempt = JSON.parse(
    fs.readFileSync(path.join(dir, "effective.json"), "utf8"));
  check("a second successor cannot branch from an already-replaced activation",
    ledgerAfterAttempt.entries.filter((entry) => entry.claim === "drill_claim").length === 2
      && /has already been replaced/.test(attempt.out),
    attempt.out.split("\n").find((line) => line.includes("already been replaced"))?.trim());
}

process.stdout.write("\n== the same claim digest under a new core needs a new activation\n");
{
  const dir = sandbox(withThreeAttestations).dir;
  const ledgerFile = path.join(dir, "effective.json");
  const firstLedger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const first = firstLedger.entries.find((entry) => entry.claim === "drill_claim");

  const coreFile = path.join(dir, "core.json");
  const nextCore = JSON.parse(fs.readFileSync(coreFile, "utf8"));
  nextCore.revision_probe = "the same claim is being accepted under a different core";
  fs.writeFileSync(coreFile, JSON.stringify(nextCore, null, 2), "utf8");
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.core.revision_probe = nextCore.revision_probe;
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }

  const digestLines = runBuilder(dir, ["--digests"]).out;
  const nextCoreRevision = digestLines.split("\n")[0].trim().split(/\s+/).at(-1);
  const sameClaimDigest = digestLines.split("\n")
    .find((line) => line.includes("drill_claim"))?.trim().split(/\s+/)[0];
  for (const name of ["elenchos", "metron", "pragma"]) {
    const file = path.join(dir, "branches", `${name}.json`);
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    branch.core_revision = nextCoreRevision;
    branch.decisions.push({ id: `${name}-drill-core2`, kind: "attest",
      claim: "drill_claim", digest: sameClaimDigest, core_revision: nextCoreRevision,
      replaces_activation_id: first.activation_id });
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  }

  const result = runBuilder(dir);
  const nextLedger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const projection = JSON.parse(
    fs.readFileSync(path.join(dir, "projection.generated.json"), "utf8"));
  const history = projection.history.filter((entry) => entry.claim === "drill_claim");
  check("the claim body digest stayed equal while the core revision changed",
    sameClaimDigest === digestOf && nextCoreRevision !== coreRevision,
    `claim ${digestOf} -> ${sameClaimDigest}; core ${coreRevision} -> ${nextCoreRevision}`);
  check("three decisions under the new core append a replacement activation",
    result.code === 0
      && nextLedger.entries.filter((entry) => entry.claim === "drill_claim").length === 2,
    result.out.trim().split("\n")[0]);
  check("the old core activation is unbacked and the new one unanimous",
    history[0]?.status === "superseded" && history[0]?.backing_state === "unbacked"
      && history[1]?.status === "live" && history[1]?.backing_state === "unanimous"
      && history[0]?.core_revision === coreRevision
      && history[1]?.core_revision === nextCoreRevision,
    history.map((entry) => `${entry.core_revision}:${entry.status}/${entry.backing_state}`).join(", "));
}

process.stdout.write("\n== withdrawal is an event, not a flag on the old one\n");
// Metron and Pragma specified this independently and identically, which is why
// it is here rather than the Board host's mutable `withdrawn: true`.
// The entry has to be effective BEFORE the withdrawal, or this measures nothing:
// a claim that never reached three attestations was never activated, and its
// absence afterwards says nothing about whether a withdrawal revokes anything.
// The first drill of this was written that way and correctly came out red.
{
  const dir = sandbox(withThreeAttestations).dir;
  const branch = JSON.parse(fs.readFileSync(path.join(dir, "branches", "pragma.json"), "utf8"));
  branch.decisions.push({ id: "pragma-drill-w1", kind: "withdraw", target: "pragma-drill-a1" });
  fs.writeFileSync(path.join(dir, "branches", "pragma.json"), JSON.stringify(branch, null, 2), "utf8");
  const out = execFileSync(process.execPath, [builder],
    { env: { ...process.env, FMS_DIR: dir }, encoding: "utf8" });
  const projection = JSON.parse(fs.readFileSync(path.join(dir, "projection.generated.json"), "utf8"));
  const withdrawnRow = projection.effective_trunk.find((e) => e.claim === "drill_claim");
  check("a withdrawal leaves the already-effective entry live",
    withdrawnRow?.status === "live", out.trim().split("\n")[0]);
  check("history axis says live, state axis says contested",
    withdrawnRow?.status === "live" && withdrawnRow?.backing_state === "contested",
    `${withdrawnRow?.status} / ${withdrawnRow?.backing_state} / ${withdrawnRow?.currently_backed_by.join(", ")}`);
  const original = projection.decisions.find((d) => d.id === "pragma-drill-a1");
  check("the withdrawn attestation is still recorded rather than edited",
    original?.kind === "attest" && original?.withdrawn === true,
    original ? `withdrawn=${original.withdrawn}` : "gone");
}
run = sandbox(({ load, save }) => {
  const branch = load("pragma");
  branch.decisions = [...(branch.decisions ?? []),
    { id: "pragma-w0", kind: "withdraw", target: "elenchos-a1" }];
  save("pragma", branch);
});
check("a withdrawal aimed at another owner's attestation is invalid",
  /not an attestation in this owner/.test(run.out),
  run.out.split("\n").find((l) => l.includes("withdraw"))?.trim() || "(not reported)");

process.stdout.write("\n== the ledger is not self-authorising\n");
// Pragma injected an entry that was never proposed and had no attestations, and
// the builder called it effective with exit 0.
for (const [label, extra] of [
  ["an entry with no adopted body", {}],
  ["an entry whose body does not hash to its digest", { body: { x: 1 } }],
]) {
  const injected = sandbox(({ dir }) => {
    const file = path.join(dir, "effective.json");
    const ledger = JSON.parse(fs.readFileSync(file, "utf8"));
    ledger.entries.push({ claim: "a-claim-nobody-ever-proposed", digest: "deadbeefdeadbeef",
      core_revision: "0", attested_by: ["elenchos", "metron", "pragma"], ...extra });
    fs.writeFileSync(file, JSON.stringify(ledger, null, 2), "utf8");
  });
  check(`${label} is refused`, injected.code !== 0 && /nobody-ever-proposed/.test(injected.out),
    injected.out.split("\n").find((l) => l.includes("nobody-ever-proposed"))?.trim());
}

// A body that hashes correctly plus an activation id is still only a claim
// made by the ledger about itself. Corrupt a real activation so every unrelated
// field stays valid and each drill reaches the decision-ref check it names.
const corruptActivation = (mutate) => {
  const dir = sandbox(withThreeAttestations).dir;
  const file = path.join(dir, "effective.json");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const entry = value.entries.find((candidate) => candidate.claim === "drill_claim");
  mutate({ dir, entry });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  return runBuilder(dir);
};

let injected = corruptActivation(({ entry }) => { delete entry.decision_refs; });
check("a well-formed ledger entry without three owner decision refs is refused",
  injected.code !== 0 && /must reference exactly one decision from each actor/.test(injected.out),
  injected.out.split("\n").find((l) => l.includes("must reference exactly"))?.trim());

injected = corruptActivation(({ entry }) => {
  entry.decision_refs = { elenchos: "elenchos-drill-a1",
    metron: "elenchos-drill-a1", pragma: "elenchos-drill-a1" };
});
check("one owner's decision repeated for all actors is refused",
  injected.code !== 0 && /references metron decision.*resolves 0 time/.test(injected.out),
  injected.out.split("\n").find((l) => l.includes("references metron decision"))?.trim());

injected = corruptActivation(({ entry }) => {
  entry.decision_refs.pragma = "pragma-decision-does-not-exist";
});
check("a missing owner decision ref is refused",
  injected.code !== 0 && /pragma-decision-does-not-exist.*resolves 0 time/.test(injected.out),
  injected.out.split("\n").find((l) => l.includes("pragma-decision-does-not-exist"))?.trim());

injected = corruptActivation(({ entry }) => {
  entry.decision_refs.someone_else = "someone-else-a1";
});
check("an activation carrying an extra actor ref is refused",
  injected.code !== 0 && /must reference exactly one decision from each actor/.test(injected.out),
  injected.out.split("\n").find((l) => l.includes("must reference exactly"))?.trim());

injected = corruptActivation(({ dir, entry }) => {
  const file = path.join(dir, "branches", "pragma.json");
  const branch = JSON.parse(fs.readFileSync(file, "utf8"));
  branch.decisions.push({ id: "pragma-drill-w-ref", kind: "withdraw",
    target: entry.decision_refs.pragma });
  entry.decision_refs.pragma = "pragma-drill-w-ref";
  fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
});
check("an activation cannot cite a withdrawal as its owner decision",
  injected.code !== 0 && /which is not an attestation/.test(injected.out),
  injected.out.split("\n").find((l) => l.includes("not an attestation"))?.trim());

for (const [label, field, value] of [
  ["a decision ref with another claim", "claim", "not-drill-claim"],
  ["a decision ref with another digest", "digest", "0000000000000000"],
  ["a decision ref with another core revision", "core_revision", "0000000000000000"],
]) {
  injected = corruptActivation(({ dir, entry }) => {
    const file = path.join(dir, "branches", "pragma.json");
    const branch = JSON.parse(fs.readFileSync(file, "utf8"));
    const decision = branch.decisions.find((candidate) => candidate.id === entry.decision_refs.pragma);
    decision[field] = value;
    fs.writeFileSync(file, JSON.stringify(branch, null, 2), "utf8");
  });
  check(`${label} is refused`,
    injected.code !== 0 && /different claim, digest, or core revision/.test(injected.out),
    injected.out.split("\n").find((l) => l.includes("different claim, digest, or core revision"))?.trim());
}

process.stdout.write("\n== rebuilding does not rewrite decisions or activation history\n");
{
  const dir = sandbox(withThreeAttestations).dir;
  const ledgerPath = path.join(dir, "effective.json");
  const decisionsBefore = new Map(["elenchos", "metron", "pragma"].map((name) => [
    name,
    fs.readFileSync(path.join(dir, "branches", `${name}.json`), "utf8"),
  ]));
  const ledgerBeforeRebuild = fs.readFileSync(ledgerPath, "utf8");
  const projectionPath = path.join(dir, "projection.generated.json");
  const projectionBeforeRebuild = fs.readFileSync(projectionPath, "utf8");
  execFileSync(process.execPath, [builder],
    { env: { ...process.env, FMS_DIR: dir }, encoding: "utf8" });
  const ledgerAfterRebuild = fs.readFileSync(ledgerPath, "utf8");
  check("a second build leaves the activation ledger byte-identical",
    ledgerAfterRebuild === ledgerBeforeRebuild);
  check("a build leaves every owner's decision file byte-identical",
    [...decisionsBefore].every(([name, before]) =>
      fs.readFileSync(path.join(dir, "branches", `${name}.json`), "utf8") === before));
  check("a second build derives a byte-identical projection",
    fs.readFileSync(projectionPath, "utf8") === projectionBeforeRebuild);
}

process.stdout.write("\n== this runner does not touch the canonical tree\n");
check("module 08 is byte-identical to before this run",
  fs.readFileSync(path.join(root, "fms", "08-fms.generated.md"), "utf8") === moduleBefore);
check("the canonical ledger is byte-identical to before this run",
  fs.readFileSync(path.join(source, "effective.json"), "utf8") === ledgerBefore);

process.stdout.write(failures.length ? `\n${failures.length} failure(s)\n` : "\nall guards drilled\n");
for (const f of failures) process.stdout.write(`  - ${f}\n`);
process.exit(failures.length ? 1 : 0);
