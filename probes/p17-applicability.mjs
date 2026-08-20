// 改良點 17 — a measurement returns a value AND its applicability, and refuses
// to hand back one it did not compute.
//
// p16's number read 0 for two different situations: a unit that declared
// nothing, and a unit whose declaration could not be suppressed. The repair is
// not a better number — they were never the same quantity.
//
// Full entry: https://thisoneisneok.com/html/mssp/019-applicability-is-part-of-the-answer.html
//
//   node probes/p17-applicability.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const SOURCES = {
  "declares-openly": { HELD: 6, suppressible: true, declares: true, baked: false },
  "never-declares": { HELD: 6, suppressible: true, declares: false, baked: false },
  // Its incompleteness IS a record, not a field beside them. Withholding the
  // field leaves the marker behind, so the two arms are not comparable and
  // there is no second arm to subtract.
  "baked-in": { HELD: 6, suppressible: false, declares: true, baked: true },
};

function collect(name, budget = 1, suppress = false) {
  const s = SOURCES[name];
  const take = Math.min(s.HELD, budget * 3);
  const records = Array.from({ length: take }, (_, i) => ({ from: name, id: `${name}-${i + 1}` }));
  if (s.baked && take < s.HELD) records.push({ from: name, id: "cursor", marker: "more-after-cursor" });
  return {
    source: name,
    records,
    incomplete_because: suppress ? null : (s.declares && take < s.HELD ? "more-after-cursor" : null),
  };
}

const POLICIES = {
  "retry-declared": (runs, rerun) => runs.map((r) => (r.incomplete_because
    ? { ...r, kept: rerun(r.source, 2).records } : { ...r, kept: r.records })),
  // The control policy. Under it a declaring unit has a MEASURED zero — both
  // arms ran and agreed. Without it every zero would mean "nothing to measure".
  "ignore-declared": (runs) => runs.map((r) => ({ ...r, kept: r.records })),
};

const through = (policy, suppress = []) => policy(
  Object.keys(SOURCES).sort().map((n) => collect(n, 1, suppress.includes(n))),
  (n, b) => collect(n, b));
const contribution = (rows, name) => rows.find((r) => r.source === name)?.kept.length ?? 0;

function incentive(policy, name) {
  if (!SOURCES[name].suppressible) {
    return { source: name, applicable: false, value: null, suppressed: null,
      declared: contribution(through(policy), name),
      reason: "the declaration is not a separable field — suppressing it would also remove a record" };
  }
  const declared = contribution(through(policy), name);
  const suppressed = contribution(through(policy, [name]), name);
  return { source: name, applicable: true, value: declared - suppressed, declared, suppressed, reason: null };
}

const measureAll = (policy) => Object.keys(SOURCES).sort().map((n) => incentive(policy, n));

// Refuses rather than skipping. A sum that quietly omits what it could not read
// prints a smaller number with the same confidence as a complete one.
function total(measured, claim = null) {
  const domain = claim?.domain ?? measured;
  const included = measured.filter((item) => item.applicable).map((item) => item.source);
  const includedSet = new Set(included);
  const missing = domain.filter((item) => !item.applicable || !includedSet.has(item.source))
    .map((item) => ({ source: item.source,
      reason: item.reason ?? "fixed-domain member was not included in measured inputs" }));
  const evidence = domain;
  const scope = { kind: claim?.kind ?? "Unspecified",
    domain: domain.map((item) => item.source) };
  if (claim === null) {
    return { kind: "Refused", claim: "Unspecified", reason: "explicit-scope-required",
      scope, included, missing, evidence };
  }
  if (claim.kind === "CompleteTotal" && missing.length > 0) {
    return { kind: "Refused", claim: "CompleteTotal", reason: "unmeasured-domain-members",
      scope, included, missing, evidence };
  }
  const value = measured.filter((item) => item.applicable)
    .reduce((sum, item) => sum + item.value, 0);
  if (claim.kind === "ScopedSubtotal") {
    return { kind: "ScopedSubtotal", scope, value, included, missing, evidence };
  }
  return { kind: "CompleteTotal", scope, value, included, missing: [], evidence };
}

// Distils the observed Example 019 defect: validation reports a problem, but
// the vulnerable order still mutates the registry.
function registerSource(registry, source) {
  const problem = typeof source.suppressible !== "boolean"
    ? `${source.name}: suppressible must be an explicit boolean` : null;
  if (problem === null) registry.set(source.name, source);
  return { problem, registered: registry.has(source.name) };
}

export function run() {
  const { say, check, done } = harness("p17 — applicability is part of the answer");

  const retry = Object.fromEntries(measureAll(POLICIES["retry-declared"]).map((m) => [m.source, m]));
  const ignore = Object.fromEntries(measureAll(POLICIES["ignore-declared"]).map((m) => [m.source, m]));

  say("\n  1. three kinds of answer");
  for (const m of Object.values(retry)) {
    say(`     ${m.source.padEnd(17)} ${m.applicable ? String(m.value).padStart(3) : "n/a"}   ${m.applicable ? "measured" : `NOT MEASURED: ${m.reason}`}`);
  }
  check("a non-applicable reading carries no value", retry["baked-in"].value === null);
  check("and carries a reason instead", Boolean(retry["baked-in"].reason));
  check("an applicable one carries a value and no reason",
    retry["declares-openly"].value === 3 && retry["declares-openly"].reason === null);

  say("\n  2. the control — a MEASURED zero");
  const control = ignore["declares-openly"];
  check("under ignore-declared it measures zero", control.value === 0);
  check("and it WAS measured — both arms ran and agreed",
    control.applicable === true && control.declared === control.suppressed);
  check("baked-in also reads as nothing, and was NOT measured",
    retry["baked-in"].value === null && retry["baked-in"].applicable === false);
  check("so a bare 0 cannot separate them; applicability can",
    control.applicable !== retry["baked-in"].applicable);

  say("\n  3. the reason is proved by running it, not believed");
  const withField = collect("baked-in", 1, false);
  const withoutField = collect("baked-in", 1, true);
  const cleanWith = collect("declares-openly", 1, false);
  const cleanWithout = collect("declares-openly", 1, true);
  check("suppressing the field leaves baked-in's marker record behind",
    withoutField.records.some((r) => r.marker) && withField.records.some((r) => r.marker));
  check("while a suppressible unit's two arms are record-identical",
    JSON.stringify(cleanWith.records) === JSON.stringify(cleanWithout.records));
  check("and differ only in the declaration field",
    cleanWith.incomplete_because !== null && cleanWithout.incomplete_because === null);

  say("\n  4. the aggregator refuses");
  const fullDomain = Object.values(retry);
  const refused = total(fullDomain, { kind: "CompleteTotal", domain: fullDomain });
  check("a total across an unmeasured unit is refused", refused.kind === "Refused", refused.reason);
  check("and the refusal names the unit", refused.missing.some((item) => item.source === "baked-in"));
  const measuredDomain = fullDomain.filter((item) => item.applicable);
  const complete = total(measuredDomain, { kind: "CompleteTotal", domain: measuredDomain });
  check("a total across measured units alone is allowed",
    complete.kind === "CompleteTotal" && complete.value === 3);

  say("\n  5. aggregate claims carry scope and evidence with the answer");
  const domain = Object.values(retry);
  let refusedAnswer = null;
  try {
    refusedAnswer = total(domain, { kind: "CompleteTotal", domain });
  } catch (error) {
    refusedAnswer = error.message;
  }
  check("CompleteTotal with a missing member returns Refused",
    refusedAnswer?.kind === "Refused" && refusedAnswer.claim === "CompleteTotal");
  check("Refused names the missing member and preserves every input",
    refusedAnswer?.missing?.some((item) => item.source === "baked-in") === true
    && refusedAnswer?.evidence?.length === domain.length);
  check("Refused carries the fixed claim scope explicitly",
    refusedAnswer?.scope?.kind === "CompleteTotal"
    && refusedAnswer.scope.domain.join("|") === "baked-in|declares-openly|never-declares");

  const measured = domain.filter((item) => item.applicable);
  const subtotal = total(measured, { kind: "ScopedSubtotal", domain });
  check("ScopedSubtotal carries the included IDs and value",
    subtotal?.kind === "ScopedSubtotal"
    && subtotal.value === 3
    && subtotal.included.join("|") === "declares-openly|never-declares");
  check("ScopedSubtotal also carries missing IDs and reasons",
    subtotal?.missing?.some((item) => item.source === "baked-in" && Boolean(item.reason)) === true);
  check("ScopedSubtotal carries the same explicit domain scope",
    subtotal?.scope?.kind === "ScopedSubtotal"
    && subtotal.scope.domain.join("|") === "baked-in|declares-openly|never-declares");

  const applicableDomain = domain.filter((item) => item.applicable);
  const omittedApplicable = total(
    applicableDomain.filter((item) => item.source === "never-declares"),
    { kind: "CompleteTotal", domain: applicableDomain });
  check("CompleteTotal refuses when an applicable fixed-domain member is omitted",
    omittedApplicable.kind === "Refused"
    && omittedApplicable.missing.some((item) => item.source === "declares-openly"),
    `${omittedApplicable.kind}, missing=${omittedApplicable.missing.map((item) => item.source).join("|")}`);

  say("\n  6. invalid registry input cannot survive validation");
  const registry = new Map();
  const explicitFalse = registerSource(registry, { name: "baked-valid", suppressible: false });
  check("explicit suppressible=false is a valid NotApplicable declaration",
    explicitFalse.problem === null && explicitFalse.registered === true
    && registry.has("baked-valid"));
  const invalid = registerSource(registry, { name: "missing-suppressibility" });
  check("a source missing the boolean field reports a problem and is not registered",
    Boolean(invalid.problem) && invalid.registered === false
    && !registry.has("missing-suppressibility"));

  return done();
}

// ATTACK:
//   a. THE ONE I FLAGGED MYSELF: `n/a` may only move the collapse outward. A
//      caller that does not branch on `applicable` reads `value: null` — which
//      in JS and Python is exactly the collapse this line is about. Show a shape
//      where ignoring the field is IMPOSSIBLE rather than merely wrong.
//      (Rust's Result does that for extraction and not for discarding — see
//      https://thisoneisneok.com/html/mssp/archaeology/020-rust-must-use.html)
//   b. a unit could declare itself unsuppressible and be LYING. It reads as
//      n/a rather than 0, which is conservative — but conservative is not
//      verified. p18's challenge idea might apply here; I did not try it.
//   c. make baked-in suppressible  ->  section 3 goes red.
//   d. return a bare scalar from CompleteTotal or ScopedSubtotal -> sections 4
//      and 5 go red because scope and evidence no longer travel with the claim.
//   e. omit any unmeasured fixed-domain member from `missing` -> section 5 goes
//      red; an explicit subtotal may exist, but cannot masquerade as complete.
//   f. mutate the registry before checking `problem` -> section 6 goes red; an
//      invalid source cannot be both rejected and canonically registered.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
