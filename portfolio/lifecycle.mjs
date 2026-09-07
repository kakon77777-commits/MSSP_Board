// The one place the lifecycle vocabulary and its derivations live.
//
// Agreed in
// MSSP_Architect_Exchange/decisions/2026-08-30-20-app-portfolio-skeleton-v0-direction.md
// by Elenchos, Metron and Pragma.
//
// Nothing below is stored in a product record. `current_gate`, the lifecycle
// projection and `technical_close_eligible` are computed from the stage records
// every time they are needed, because a stored copy can disagree with the stages
// it summarises — and when it does, the copy is the one people read.
export const STAGES = Object.freeze([
  "preregistration",
  "mssp_core",
  "work_package",
  "candidate",
  "island_verification",
  "integration",
  "system_acceptance",
  "technical_close",
]);

export const APPLICABILITY = Object.freeze(["required", "not_applicable"]);

export const STATES = Object.freeze([
  "not_started", "active", "blocked", "passed", "deferred", "superseded",
]);

// Applicability and scheduling are orthogonal. `deferred` is a scheduled
// obligation that still applies; `not_applicable` is a reviewed product-specific
// decision that it does not, and it always owes a rationale.
export const RATIONALE_REQUIRED_FOR = Object.freeze(["deferred"]);

const byStage = (record) => new Map(record.stages.map((s) => [s.stage, s]));

/** The first required stage that is not yet passed, or null when none remain. */
export function currentGate(record) {
  const stages = byStage(record);
  for (const name of STAGES) {
    const stage = stages.get(name);
    if (stage === undefined || stage.applicability !== "required") continue;
    if (stage.state !== "passed") return name;
  }
  return null;
}

/**
 * Technical close is a decision made AFTER eligibility, so the technical_close
 * stage is excluded from its own predicate. Requiring it to be passed in order
 * to become eligible would make the gate unreachable.
 */
export function technicalCloseEligible(record) {
  const stages = byStage(record);
  for (const name of STAGES) {
    if (name === "technical_close") break;
    const stage = stages.get(name);
    if (stage === undefined || stage.applicability !== "required") continue;
    if (stage.state !== "passed") return false;
  }
  return record.blockers.every(
    (b) => b.state === "resolved" || b.state === "moved_outside_technical_slice");
}

/**
 * A narrow projection for the index, derived rather than stored.
 *
 * It deliberately answers one question — where is this product — and is not a
 * second lifecycle that could drift from the stages.
 */
export function projection(record) {
  const stages = byStage(record);
  const closed = stages.get("technical_close");
  if (closed !== undefined && closed.state === "passed") return "technical_closed";
  if (record.blockers.some((b) => b.state === "open")) return "blocked";
  if (record.stages.some((s) => ["active", "blocked"].includes(s.state))) return "active";
  if (record.stages.some((s) => s.state === "passed")) return "active";
  return "not_started";
}
