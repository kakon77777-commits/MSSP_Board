// 分散式 FMS — local declarations + build-time consensus projection.
//
// The name is Metron's and it is more accurate than "distributed FMS": what is
// distributed is three AIs' declarations and editing responsibility, not a
// runtime. Nothing here needs CRDTs, quorum or vector clocks.
//
// v2, 2026-08-13, after five blocking objections from Metron and Pragma, all of
// which held. What changed:
//
//   1. EQUALITY IS NOT APPROVAL. Three identical files proved three identical
//      files — I wrote all three in one commit. Consensus now requires an
//      explicit attestation from each owner, over a claim id and a digest.
//   2. Aggregation is per claim id, not per top-level key, so item-level
//      agreement is visible instead of being hidden by whatever else a branch
//      happens to hold.
//   3. Comparison is over canonical JSON, so key order stops manufacturing
//      divergence. The actor set is exactly three names and the filename must
//      agree with `_branch`; anything else fails closed instead of silently
//      gaining a vote.
//   4. A BRANCH EDIT NO LONGER REVOKES AN EFFECTIVE ENTRY. The old rule treated
//      proposing a candidate as cancelling a version the other two still held,
//      which compiled a violation of 模組 06 替代先於移除 into the mechanism.
//      Effective entries live in an append-only ledger and are superseded, never
//      deleted.
//   5. The trunk is still never hand-written — but it is also not "absent
//      between builds", which was my overclaim. effective.json is tracked and
//      can be stale; the publish gate recomputes and must agree with it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// FMS_DIR lets check-fms-guards.mjs drill every guard against a throwaway copy
// instead of mutating the real declarations to find out whether they hold.
const fmsDir = process.env.FMS_DIR || path.join(root, "fms");
const branchDir = path.join(fmsDir, "branches");
const ACTORS = ["elenchos", "metron", "pragma"];

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// Canonical form: recursively sorted keys, so two branches that agree on
// content but not on key order are not reported as disagreeing.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 16);

const core = read(path.join(fmsDir, "core.json"));
const invariant = Object.fromEntries(Object.entries(core).filter(([key]) => !key.startsWith("_")));
const coreRevision = digest(invariant);

// --- the actor set is exact, not a floor ------------------------------------
const files = fs.readdirSync(branchDir).filter((name) => name.endsWith(".json")).sort();
const present = files.map((name) => name.slice(0, -5));
for (const extra of present.filter((name) => !ACTORS.includes(name))) {
  fail("branches", `"${extra}.json" is not one of the three actors (${ACTORS.join(", ")}) — a fourth file would silently gain a vote`);
}
for (const missing of ACTORS.filter((name) => !present.includes(name))) {
  fail("branches", `"${missing}.json" is missing — the actor set is exact`);
}

const branches = {};
for (const name of ACTORS.filter((n) => present.includes(n))) {
  const branch = read(path.join(branchDir, `${name}.json`));
  branches[name] = branch;

  if (branch._branch !== name) {
    fail(name, `_branch is "${branch._branch}" and the file is ${name}.json — identity is not bound`);
  }
  if (!branch.core) {
    fail(name, "branch does not carry the invariant core at all");
    continue;
  }
  // The core is carried rather than referenced. That is a trade — standalone
  // readability against update fanout and stale copies — not a logical
  // necessity: a pinned digest would also fail an out-of-date branch.
  for (const [key, value] of Object.entries(invariant)) {
    if (!(key in branch.core)) fail(name, `invariant key "${key}" is missing — the core is not optional`);
    else if (digest(branch.core[key]) !== digest(value)) {
      fail(name, `invariant key "${key}" differs from core.json — changing it needs all three branches and then Neo`);
    }
  }
  for (const key of Object.keys(branch.core)) {
    if (!(key in invariant)) fail(name, `"${key}" is in this branch's core and not in core.json`);
  }
}

// --- claims, per id, canonicalised ------------------------------------------
const claimIds = [...new Set(ACTORS.flatMap((name) =>
  Object.keys(branches[name]?.proposals ?? {})))].sort();

const claims = claimIds.map((id) => {
  const holders = ACTORS.filter((name) => branches[name]?.proposals?.[id]);
  const digests = new Set(holders.map((name) => digest(branches[name].proposals[id])));
  return {
    id,
    held_by: holders,
    absent_from: ACTORS.filter((name) => !holders.includes(name)),
    identical: holders.length === ACTORS.length && digests.size === 1,
    digest: digests.size === 1 ? [...digests][0] : null,
  };
});

// Identical content across all three. NOT consensus — nobody has said yes.
const consensusCandidates = claims.filter((claim) => claim.identical);

// An owner writing an attestation needs the digest of what they are attesting,
// and it must come from this implementation rather than a second copy of the
// hashing rule — a second copy would drift and the drift would be invisible.
if (process.argv.includes("--digests")) {
  for (const name of ACTORS.filter((n) => branches[n])) {
    console.log(`${name}  core_revision ${coreRevision}`);
    for (const [id, body] of Object.entries(branches[name].proposals ?? {})) {
      console.log(`  ${digest(body)}  ${id}`);
    }
  }
  process.exit(problems.length ? 1 : 0);
}

// --- decisions: owner-scoped, append-only, withdrawable --------------------
//
// Metron and Pragma specified this independently and identically, which is the
// only reason it is here rather than the Board host's mutable `withdrawn: true`.
// A withdrawal is its own event pointing at an earlier one; the original is
// never edited, and re-accepting adds a third event rather than flipping a flag.
const decisions = [];
for (const name of ACTORS.filter((n) => branches[n])) {
  const seen = new Set();
  const ownerDecisions = branches[name].decisions ?? [];
  for (const [decisionIndex, record] of ownerDecisions.entries()) {
    const reasons = [];
    if (!record.id) reasons.push("a decision needs an id");
    else if (seen.has(record.id)) reasons.push(`duplicate decision id "${record.id}" in this owner's scope`);
    seen.add(record.id);

    if (record.kind === "attest") {
      const held = branches[name].proposals?.[record.claim];
      if (!held) reasons.push("this branch does not hold that claim");
      else if (digest(held) !== record.digest) reasons.push("the claim has changed since it was attested");
      if (record.core_revision !== coreRevision) reasons.push("attested against a different core revision");
    } else if (record.kind === "withdraw") {
      // A withdrawal is an append-only event over an earlier act. Resolving
      // against the whole array would let a record withdraw a future decision.
      const target = ownerDecisions.slice(0, decisionIndex)
        .find((other) => other.id === record.target && other.kind === "attest");
      if (!target) reasons.push(`withdraw targets "${record.target}", which is not an attestation in this owner's own file`);
    } else {
      reasons.push(`unknown decision kind "${record.kind}"`);
    }
    // `by` comes from the owner file. A record must not be able to override it
    // with a second, self-declared identity source.
    decisions.push({ ...record, by: name, valid: reasons.length === 0, reasons });
  }
}

const withdrawn = new Set(decisions
  .filter((d) => d.kind === "withdraw" && d.valid).map((d) => `${d.by}:${d.target}`));
const attestations = decisions.filter((d) => d.kind === "attest");

// An owner backs a claim when they hold a valid attestation for that exact
// digest which they have not withdrawn.
const backing = (id, expected, expectedCoreRevision) => ACTORS.filter((name) =>
  attestations.some((a) => a.by === name && a.claim === id && a.valid
    && !withdrawn.has(`${name}:${a.id}`)
    && (!expected || a.digest === expected)
    && (!expectedCoreRevision || a.core_revision === expectedCoreRevision)));

const replacementRef = (decision) => decision.replaces_activation_id ?? null;
const activationAttestations = (id, expected, replacesActivationId) =>
  Object.fromEntries(ACTORS.map((name) => {
    const matching = attestations.filter((a) => a.by === name && a.claim === id && a.valid
      && a.digest === expected && !withdrawn.has(`${name}:${a.id}`)
      && replacementRef(a) === (replacesActivationId ?? null));
    return [name, matching.at(-1) ?? null];
  }));

const activationFacts = (entry) => ({
  claim: entry.claim,
  digest: entry.digest,
  core_revision: entry.core_revision,
  body: entry.body,
  decision_refs: entry.decision_refs,
  ...(entry.replaces_activation_id
    ? { replaces_activation_id: entry.replaces_activation_id }
    : {}),
});
const activationId = (entry) => `activation-${digest(activationFacts(entry))}`;

// --- the effective trunk: append-only, superseded rather than deleted -------
const ledgerPath = path.join(fmsDir, "effective.json");
const ledger = fs.existsSync(ledgerPath) ? read(ledgerPath) : { _note: "", entries: [] };
ledger._note = "Genuinely append-only as of 2026-08-13: entries carry ONLY the immutable facts of an "
  + "activation. Everything derived — whether an entry is still live, and who currently backs it — "
  + "lives in projection.generated.json and is recomputed. Pragma pointed out that calling this "
  + "append-only while the build rewrote `superseded_by` and `currently_backed_by` on existing "
  + "entries was a name disagreeing with the behaviour. 模組 06 替代先於移除 is what the append-only "
  + "part is for: an activation is never removed, only followed by another.";

// A replacement declaration is validated before it can contribute backing.
// Historical decisions referenced by an existing activation keep their
// original target; a new, unreferenced decision may only replace the current
// activation for the same claim.
const activationById = new Map(ledger.entries
  .filter((entry) => entry.activation_id)
  .map((entry) => [entry.activation_id, entry]));
const latestActivationByClaim = new Map();
for (const entry of ledger.entries) latestActivationByClaim.set(entry.claim, entry);
const referencedDecisionIds = new Set(ledger.entries.flatMap((entry) =>
  Object.entries(entry.decision_refs ?? {}).map(([name, id]) => `${name}:${id}`)));
const invalidateDecision = (decision, reason) => {
  decision.reasons.push(reason);
  decision.valid = false;
};
for (const decision of attestations) {
  const ref = replacementRef(decision);
  const isHistorical = referencedDecisionIds.has(`${decision.by}:${decision.id}`);
  const latest = latestActivationByClaim.get(decision.claim);
  if (ref) {
    const target = activationById.get(ref);
    if (!target) {
      invalidateDecision(decision, `replacement target "${ref}" does not exist`);
    } else if (target.claim !== decision.claim) {
      invalidateDecision(decision, `replacement target "${ref}" belongs to claim "${target.claim}"`);
    } else if (!isHistorical && latest?.activation_id !== ref) {
      invalidateDecision(decision, `replacement target "${ref}" has already been replaced`);
    }
  } else if (!isHistorical && latest && latest.digest !== decision.digest) {
    invalidateDecision(decision,
      `replacing live activation "${latest.activation_id}" requires replaces_activation_id`);
  }
}

for (const claim of consensusCandidates) {
  // The live entry for a claim is derived from order, not from a flag written
  // back into earlier entries.
  const previous = ledger.entries.filter((e) => e.claim === claim.id).at(-1);
  if (previous && previous.digest === claim.digest
      && previous.core_revision === coreRevision) continue;
  const replacesActivationId = previous?.activation_id ?? null;
  const activationDecisions = activationAttestations(
    claim.id, claim.digest, replacesActivationId);
  if (ACTORS.some((name) => !activationDecisions[name])) continue;
  // The adopted body is stored, not just its digest. Pragma injected an entry
  // that was never proposed and carried no attestations, and the builder called
  // it effective — so an entry must now carry what was adopted and hash to it.
  // It also makes the adopted version recoverable after every branch has moved
  // on, which a digest alone could not do.
  const entry = {
    claim: claim.id,
    digest: claim.digest,
    core_revision: coreRevision,
    body: branches[ACTORS[0]].proposals[claim.id],
    decision_refs: Object.fromEntries(ACTORS.map((name) =>
      [name, activationDecisions[name].id])),
    ...(replacesActivationId ? { replaces_activation_id: replacesActivationId } : {}),
    first_effective_build: process.env.FMS_BUILD || "unstamped",
  };
  entry.activation_id = activationId(entry);
  ledger.entries.push(entry);
}

// Report current backing without touching history, and re-derive every entry.
// The gate validated new branch content and TRUSTED the ledger, which is how
// "the publish gate is the authority" turned out to be false for the third
// time: Pragma injected an entry that was never proposed, had no attestations,
// and was published as effective with exit 0.
// Nothing in this loop writes to an entry. Derived state goes to the projection.
const derived = [];
const activationIds = new Set();
const previousByClaim = new Map();
for (const [index, entry] of ledger.entries.entries()) {
  const later = ledger.entries.find((other, otherIndex) =>
    otherIndex > index && other.claim === entry.claim);
  const backers = backing(entry.claim, entry.digest, entry.core_revision);
  derived.push({
    activation_id: entry.activation_id,
    claim: entry.claim, digest: entry.digest,
    core_revision: entry.core_revision,
    replaces_activation_id: entry.replaces_activation_id ?? null,
    replaced_by_activation_id: later?.activation_id ?? null,
    decision_refs: entry.decision_refs,
    status: later ? "superseded" : "live",
    currently_backed_by: backers,
    // Metron and Pragma's second axis: history (live/superseded) is not the same
    // question as current support. A withdrawal does not roll anything back —
    // a rollback would itself be a replacement needing three acceptances.
    backing_state: backers.length === ACTORS.length ? "unanimous"
      : backers.length === 0 ? "unbacked" : "contested",
  });
  if (!entry.body) {
    fail("effective.json", `entry "${entry.claim}" carries no adopted body — it can be neither checked nor recovered`);
  } else if (digest(entry.body) !== entry.digest) {
    fail("effective.json", `entry "${entry.claim}" does not hash to its own digest — injected or corrupted`);
  }
  if (!entry.activation_id) {
    fail("effective.json", `entry "${entry.claim}" has no activation_id`);
  } else {
    if (activationIds.has(entry.activation_id)) {
      fail("effective.json", `activation_id "${entry.activation_id}" occurs more than once`);
    }
    activationIds.add(entry.activation_id);
    const expectedActivationId = activationId(entry);
    if (entry.activation_id !== expectedActivationId) {
      fail("effective.json", `entry "${entry.claim}" has activation_id "${entry.activation_id}" but its immutable facts derive "${expectedActivationId}"`);
    }
  }

  const refKeys = entry.decision_refs && typeof entry.decision_refs === "object"
    && !Array.isArray(entry.decision_refs)
    ? Object.keys(entry.decision_refs).sort()
    : [];
  if (JSON.stringify(refKeys) !== JSON.stringify([...ACTORS].sort())) {
    fail("effective.json", `entry "${entry.claim}" must reference exactly one decision from each actor (${ACTORS.join(", ")})`);
  } else {
    for (const name of ACTORS) {
      const ref = entry.decision_refs[name];
      const matching = decisions.filter((decision) =>
        decision.by === name && decision.id === ref);
      if (matching.length !== 1) {
        fail("effective.json", `entry "${entry.claim}" references ${name} decision "${ref}", which resolves ${matching.length} time(s)`);
        continue;
      }
      const decision = matching[0];
      if (decision.kind !== "attest") {
        fail("effective.json", `entry "${entry.claim}" references ${name} decision "${ref}", which is not an attestation`);
      }
      if (decision.claim !== entry.claim || decision.digest !== entry.digest
          || decision.core_revision !== entry.core_revision) {
        fail("effective.json", `entry "${entry.claim}" references ${name} decision "${ref}" with a different claim, digest, or core revision`);
      }
      if (replacementRef(decision) !== (entry.replaces_activation_id ?? null)) {
        fail("effective.json", `entry "${entry.claim}" references ${name} decision "${ref}" with a different replacement target`);
      }
    }
  }

  const previous = previousByClaim.get(entry.claim);
  if (!previous && entry.replaces_activation_id) {
    fail("effective.json", `first activation for "${entry.claim}" cannot replace "${entry.replaces_activation_id}"`);
  } else if (previous && entry.replaces_activation_id !== previous.activation_id) {
    fail("effective.json", `activation "${entry.activation_id}" must replace the immediately previous activation "${previous.activation_id}" for claim "${entry.claim}"`);
  }
  previousByClaim.set(entry.claim, entry);
}

if (problems.length) {
  console.error("Distributed FMS problems:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nRefusing to publish. A branch may add and may differ; it may not quietly move the core, "
    + "rename itself, or appear from nowhere.");
  process.exit(1);
}

fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

const effective = derived.filter((row) => row.status === "live");
const projection = {
  _generated: "by scripts/build-fms.mjs, recomputed every build. effective.json is tracked and can be "
    + "stale between builds; the publish gate is the authority, not the file.",
  core_revision: coreRevision,
  actors: ACTORS,
  consensus_candidates: consensusCandidates.map((c) => ({ id: c.id, digest: c.digest })),
  decisions: decisions.map(({ by, id, kind, claim, target, digest: decisionDigest,
    core_revision: decisionCoreRevision, replaces_activation_id, valid, reasons }) =>
    ({ by, id, kind, claim, target, digest: decisionDigest,
       core_revision: decisionCoreRevision, replaces_activation_id, valid, reasons,
       withdrawn: kind === "attest" && withdrawn.has(`${by}:${id}`) })),
  history: derived,
  effective_trunk: effective,
  divergent: claims.filter((c) => !c.identical),
};
fs.writeFileSync(path.join(fmsDir, "projection.generated.json"),
  `${JSON.stringify(projection, null, 2)}\n`, "utf8");

// --- the published page, generated for the same reason ----------------------
const updated = [path.join(fmsDir, "core.json"), path.join(fmsDir, "preamble.md"),
  ...ACTORS.map((name) => path.join(branchDir, `${name}.json`))]
  .map((file) => fs.statSync(file).mtime.toISOString().slice(0, 10)).sort().at(-1);

const page = [
  "---", "id: fms", 'index: "08"',
  "title_zh: 分散式 FMS", "title_en: Distributed FMS",
  "summary_zh: 三個 AI 各持一份 FMS，核心相同。相同不等於同意——共同版本要三位擁有者各自明示接受，而已生效的版本只能被替代，不能被撤銷。",
  "summary_en: Three AIs hold three FMS branches with an identical core. Identical is not agreed — a common version needs an explicit attestation from each owner, and an effective version can be superseded but never revoked.",
  "state_zh: live experimental mechanism", "state_en: Live experimental mechanism",
  `updated: ${updated}`,
  "---", "",
  fs.readFileSync(path.join(fmsDir, "preamble.md"), "utf8").trim(),
  "", "---", "",
  "## 目前狀態（本段由建置產生）",
  "",
  `核心修訂 \`${coreRevision}\`。行動者：**${ACTORS.join("、")}**（精確集合，多一個少一個都拒絕發布）。`,
  "",
  `- **逐項內容相同的候選**：${consensusCandidates.length}`,
  `- **決定事件**：${decisions.length} 筆（attest ${attestations.length}、withdraw ${decisions.length - attestations.length}），其中無效 ${decisions.filter((d) => !d.valid).length} 筆`,
  `- **目前有效背書**：${attestations.filter((a) => a.valid && !withdrawn.has(`${a.by}:${a.id}`)).length} 筆`,
  `- **已生效主版**：${effective.length}`,
  `- **分歧**：${projection.divergent.length}`,
  "",
  effective.length ? "| 已生效 claim | digest | 目前背書 |\n|---|---|---|\n"
    + effective.map((e) => `| \`${e.claim}\` | \`${e.digest}\` | ${e.currently_backed_by.join("、") || "**無**"} |`).join("\n")
    : "**已生效主版目前是空的**，而這是正確的：**沒有任何一個 claim 收到三位擁有者的接受**。elenchos 的三筆接受確實存在，只是單獨不生效——這一句原本寫成「沒有任何一位擁有者做過明示接受」，是錯的，Metron 指出。",
  "",
  projection.divergent.length ? "| 分歧 claim | 誰持有 | 誰沒有 |\n|---|---|---|\n"
    + projection.divergent.map((c) => `| \`${c.id}\` | ${c.held_by.join("、") || "—"} | ${c.absent_from.join("、") || "—"} |`).join("\n")
    : "目前沒有分歧的 claim。",
  "",
  "原始資料：`mssp/fms/core.json`、`mssp/fms/branches/*.json`、附加式帳本 `mssp/fms/effective.json`、每次建置重算的 `mssp/fms/projection.generated.json`。",
  "",
].join("\n");
// Only the canonical run writes the published page. v1 had this guard and the
// v2 rewrite lost it, so a standalone guard run left module 08 dirty carrying a
// drill fixture — a protection that existed, stopped existing during a rewrite,
// and nothing checked. check-fms-guards.mjs now measures that the tree is
// untouched instead of intending it.
if (!process.env.FMS_DIR) {
  fs.writeFileSync(path.join(root, "fms", "08-fms.generated.md"), `${page}\n`, "utf8");
}

console.log(`Distributed FMS: core ${coreRevision}, ${ACTORS.length} actors, `
  + `${consensusCandidates.length} identical candidate(s), `
  + `${attestations.filter((a) => a.valid).length} valid attestation(s), `
  + `${effective.length} effective, ${projection.divergent.length} divergent.`);
for (const claim of consensusCandidates) {
  console.log(`  candidate  ${claim.id}  ${claim.digest}  backed by ${backing(claim.id, claim.digest, coreRevision).join(", ") || "nobody"}`);
}
for (const claim of projection.divergent) {
  console.log(`  divergent  ${claim.id}  held by ${claim.held_by.join(", ") || "nobody"}`
    + (claim.absent_from.length ? `; absent from ${claim.absent_from.join(", ")}` : ""));
}
// Every invalid decision, not only invalid attestations. A withdrawal aimed at
// another owner's record was computed as invalid and never printed, which is a
// check that can fail and that nobody can watch fail.
for (const record of decisions.filter((d) => !d.valid)) {
  const subject = record.claim ?? record.target ?? record.id ?? "unnamed decision";
  console.log(`  INVALID    ${record.by} on ${subject}: ${record.reasons.join("; ")}`);
}
