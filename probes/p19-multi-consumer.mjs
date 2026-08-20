// Cross-review probe — multi-consumer effects that p15/p16's single scalar
// cannot represent, plus the boundary between refusal and evidence masking.
//
// GitHub issue: https://github.com/kakon77777-commits/MSSP_Board/issues/11
//
//   node probes/p19-multi-consumer.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const MEMBERS = [
  { id: "a", vote: "YES", incomplete: false },
  { id: "b", vote: "YES", incomplete: false },
  { id: "c", vote: "NO", incomplete: false },
  { id: "d", vote: "NO", incomplete: false },
];

const decide = (yes, no, denominator) => {
  if (yes > denominator / 2) return "APPROVE";
  if (no > denominator / 2) return "REJECT";
  return "NO_DECISION";
};

function eligibleOnlyQuorum(members) {
  const included = members.filter((m) => !m.incomplete);
  const excluded = members.filter((m) => m.incomplete);
  const yes = included.filter((m) => m.vote === "YES").length;
  const no = included.filter((m) => m.vote === "NO").length;
  return {
    consumer: "eligible-only",
    domain: members.map((m) => m.id),
    included: included.map((m) => m.id),
    excluded: excluded.map((m) => ({ id: m.id, reason: "declared-incomplete" })),
    denominator: included.length,
    votes: { yes, no },
    decision: decide(yes, no, included.length),
  };
}

function fixedMembershipQuorum(members) {
  const included = members.filter((m) => !m.incomplete);
  const excluded = members.filter((m) => m.incomplete);
  const yes = included.filter((m) => m.vote === "YES").length;
  const no = included.filter((m) => m.vote === "NO").length;
  return {
    consumer: "fixed-membership",
    domain: members.map((m) => m.id),
    included: included.map((m) => m.id),
    excluded: excluded.map((m) => ({ id: m.id, reason: "declared-incomplete" })),
    denominator: members.length,
    votes: { yes, no },
    decision: decide(yes, no, members.length),
  };
}

const CORRUPT_RECORD = { id: "row-4", parse: "schema-invalid" };
const observedFatal = { kind: "fatal", code: "schema-invalid", about: CORRUPT_RECORD.id };

function declarationOnlyConsumer(run) {
  return {
    consumer: "declaration-only",
    declared: run.declared,
    observed: run.observed,
    decision: run.declared.kind === "fatal" ? "STOP"
      : (run.declared.kind === "incomplete" ? "RETRY" : "ACCEPT"),
  };
}

function evidenceBoundConsumer(run) {
  const declarationOnly = declarationOnlyConsumer(run);
  const fatal = run.observed.find((event) => event.kind === "fatal");
  return {
    ...declarationOnly,
    consumer: "evidence-bound",
    decision: fatal ? "STOP" : declarationOnly.decision,
  };
}

const refuseButPreserve = (measured) => ({
  kind: "refused",
  reason: "coverage is incomplete",
  evidence: [...measured],
});

export function run() {
  const { say, check, done } = harness("p19 — multi-consumer effects and evidence-preserving refusal");

  say("\n  1. quorum skewing — one local loss changes another consumer's decision");
  const before = eligibleOnlyQuorum(MEMBERS);
  const declared = MEMBERS.map((m) => (m.id === "d" ? { ...m, incomplete: true } : m));
  const after = eligibleOnlyQuorum(declared);
  say(`     eligible-only before  ${before.votes.yes} YES / ${before.votes.no} NO / denominator ${before.denominator} -> ${before.decision}`);
  say(`     eligible-only after   ${after.votes.yes} YES / ${after.votes.no} NO / denominator ${after.denominator} -> ${after.decision}`);
  check("the fixed observations start with no decision", before.decision === "NO_DECISION");
  check("excluding one NO changes the eligible-only consumer to APPROVE", after.decision === "APPROVE");
  check("the declaring unit loses its own contribution",
    before.included.includes("d") && !after.included.includes("d"),
    "local delta -1 while the coalition outcome changes");
  check("the result names domain, inclusion, exclusion and consumer",
    JSON.stringify(after.domain) === JSON.stringify(["a", "b", "c", "d"])
    && JSON.stringify(after.included) === JSON.stringify(["a", "b", "c"])
    && after.excluded[0]?.id === "d"
    && after.consumer === "eligible-only");

  const fixed = fixedMembershipQuorum(declared);
  check("a fixed-membership consumer does not let a declaration rewrite the denominator",
    fixed.denominator === 4,
    `got ${fixed.denominator}`);
  check("the same declaration cannot turn the fixed-domain result into APPROVE",
    fixed.decision === "NO_DECISION",
    `got ${fixed.decision}`);

  say("\n  2. fatal-to-incomplete masking — one source and one consumer are enough");
  const honest = { records: ["row-1", "row-2", "row-3"], declared: observedFatal, observed: [observedFatal] };
  const laundered = { records: honest.records, declared: {
    kind: "incomplete", reason: "more-after-cursor", about: CORRUPT_RECORD.id,
  }, observed: [observedFatal] };
  const honestDecision = declarationOnlyConsumer(honest);
  const launderedDecision = declarationOnlyConsumer(laundered);
  check("the honest fatal channel stops", honestDecision.decision === "STOP");
  check("the same corrupt input becomes retryable when only the declaration channel is read",
    launderedDecision.decision === "RETRY");
  check("records and corrupt subject are identical across the two arms",
    JSON.stringify(honest.records) === JSON.stringify(laundered.records)
    && honest.declared.about === laundered.declared.about);

  const bound = evidenceBoundConsumer(laundered);
  check("an evidence-bound consumer does not let an incomplete declaration downgrade fatal evidence",
    bound.decision === "STOP",
    `got ${bound.decision}`);
  check("the answer preserves both the source declaration and observed evidence",
    bound.declared.kind === "incomplete"
    && bound.observed.some((e) => e.kind === "fatal" && e.about === CORRUPT_RECORD.id));

  say("\n  3. aggregate veto is not evidence masking unless the rows disappear");
  const measured = [
    { source: "a", kind: "measured", value: 2 },
    { source: "b", kind: "not-applicable", reason: "no comparable arm" },
    { source: "c", kind: "measured", value: -1 },
  ];
  const refused = refuseButPreserve(measured);
  check("coverage refusal keeps every measured and unmeasured row",
    refused.kind === "refused" && refused.evidence.length === measured.length,
    `kept ${refused.evidence.length} of ${measured.length}`);
  check("the refusal names the availability boundary", Boolean(refused.reason));

  return done();
}

// ATTACK:
//   a. make fixedMembershipQuorum reuse the eligible-only denominator -> the
//      declaration silently rewrites the quorum and section 1 goes red.
//   b. make evidenceBoundConsumer read only run.declared -> a fatal observation
//      is laundered into RETRY and section 2 goes red.
//   c. return a refusal with evidence: [] -> section 3 goes red. A rejected
//      conclusion may be an availability veto; deleting its rows is masking.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
