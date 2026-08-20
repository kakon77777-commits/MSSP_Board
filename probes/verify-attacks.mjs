// Verify that the stated attacks are real.
//
//   node probes/verify-attacks.mjs
//
// The README says a probe with no stated attacks is not finished. This says
// something stronger: an attack nobody ran is not an attack. Each entry below
// is applied to a throwaway copy of the probe and the suite is re-run; an
// attack that leaves it GREEN is a defect in the probe, not in the attack.
//
// This is also the workflow for attacking a probe yourself: copy, mutate, run.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// One representative attack per probe, taken verbatim from that file's ATTACK
// block. These are the cheap ones; the hard ones in those blocks are open.
const ATTACKS = [
  { probe: "p13-break-in-place.mjs", label: "p13 (a) break the control",
    from: "collect: () => ({ records: [], failed: null }) },",
    to: 'collect: () => ({ records: [], failed: "corrupt-archive" }) },' },
  { probe: "p13-break-in-place.mjs", label: "p13 (e) unbind observed failure mode",
    from: "} else if (r.failed && !source.CAN_FAIL_WITH.includes(r.failed)) {",
    to: "} else if (false && r.failed && !source.CAN_FAIL_WITH.includes(r.failed)) {" },
  { probe: "p14-outcome-travels.mjs", label: "p14 (b) all-or-nothing keeps partial work",
    from: "? { kept: [], discarded: rows.reduce((n, r) => n + r.records.length, 0) }",
    to: "? { kept: rows.flatMap((r) => r.records), discarded: 0 }" },
  { probe: "p15-direction.mjs", label: "p15 (c) at-least becomes exactly",
    from: "const sentence = `at least ${floorOf(rs)}",
    to: "const sentence = `exactly ${floorOf(rs)}" },
  { probe: "p16-incentive.mjs", label: "p16 (c) retry-declared stops retrying",
    from: "? { ...r, kept: rerun(r.source, 2).records } : { ...r, kept: r.records })),",
    to: "? { ...r, kept: r.records } : { ...r, kept: r.records }))," },
  { probe: "p17-applicability.mjs", label: "p17 (e) incomplete domain claims complete",
    from: 'if (claim.kind === "CompleteTotal" && missing.length > 0) {',
    to: 'if (false && claim.kind === "CompleteTotal" && missing.length > 0) {' },
  { probe: "p17-applicability.mjs", label: "p17 (f) invalid source reaches registry",
    from: "if (problem === null) registry.set(source.name, source);",
    to: "registry.set(source.name, source);" },
  { probe: "p18-capacity-challenge.mjs", label: "p18 (c) the challenge becomes one-armed",
    from: "passed: rightAboutComplete && rightAboutTruncated,",
    to: "passed: rightAboutTruncated," },
  { probe: "p18-capacity-challenge.mjs", label: "p18 (b) trust the negative claim",
    from: "completeness: r.incomplete_because ? DECLARED : (c.passed ? CAN_TELL : CANNOT), challenge: c };",
    to: "completeness: r.incomplete_because ? DECLARED : (c.claimed && c.passed ? CAN_TELL : CANNOT), challenge: c };" },
  { probe: "p19-multi-consumer.mjs", label: "p19 (a) declaration rewrites quorum",
    from: "function fixedMembershipQuorum(members) {",
    to: "function fixedMembershipQuorum(members) { return eligibleOnlyQuorum(members);" },
  { probe: "p19-multi-consumer.mjs", label: "p19 (b) trust declared severity",
    from: 'const fatal = run.observed.find((event) => event.kind === "fatal");',
    to: "const fatal = null;" },
  { probe: "p19-multi-consumer.mjs", label: "p19 (c) refusal drops evidence",
    from: "evidence: [...measured],",
    to: "evidence: []," },
];

function apply(attack) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mssp-attack-"));
  fs.cpSync(here, work, { recursive: true });
  const target = path.join(work, attack.probe);
  const body = fs.readFileSync(target, "utf8");
  if (!body.includes(attack.from)) {
    fs.rmSync(work, { recursive: true, force: true });
    // A mutation that does not apply has measured nothing. This is the failure
    // mode that looks most like success, so it is reported as its own state.
    return { applied: false, failures: 0 };
  }
  fs.writeFileSync(target, body.replace(attack.from, attack.to));
  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(work, "run-all.mjs")], { encoding: "utf8" });
  } catch (raised) {
    out = `${raised.stdout ?? ""}${raised.stderr ?? ""}`;
  }
  fs.rmSync(work, { recursive: true, force: true });
  return { applied: true, failures: (out.match(/^ {2}FAIL {2}/gm) ?? []).length };
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== stated attacks, applied to a throwaway copy");
  let green = 0;
  let didNotApply = 0;
  for (const attack of ATTACKS) {
    const { applied, failures } = apply(attack);
    let verdict;
    if (!applied) { verdict = "DID NOT APPLY - the anchor moved, this attack measured nothing"; didNotApply += 1; }
    else if (failures === 0) { verdict = "GREEN - the probe does not notice. Fix the probe."; green += 1; }
    else verdict = `red, ${failures} check(s)`;
    say(`  ${attack.label.padEnd(46)} ${verdict}`);
  }
  say("");
  say(`  ${ATTACKS.length} attacks, ${green} green, ${didNotApply} did not apply`);
  if (green || didNotApply) say("  An attack that leaves the suite green, or that never applied, is a hole.");
  return { green, didNotApply };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { green, didNotApply } = run();
  process.exitCode = green + didNotApply === 0 ? 0 : 1;
}
