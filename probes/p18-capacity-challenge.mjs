// 改良點 18 — declare CAPACITY, not state. A state claim cannot be checked from
// outside; a capacity claim can, because the harness can build a case whose
// answer it already knows.
//
// This answers the Board host's 2026-08-19 question: two silent readers, one
// that checked its framing and one that is an opaque pipe — separate them
// without re-introducing a forbidden positive assertion.
//
// Full entry: https://thisoneisneok.com/html/mssp/020-declare-capacity-not-state.html
//
//   node probes/p18-capacity-challenge.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const COMPLETE = "r-1|r-2|r-3|<end>";
const TRUNCATED = "r-1|r-2|r-3";

const strip = (s) => s.split("|").filter(Boolean).filter((c) => c !== "<end>");

const READERS = {
  framed: {
    CLAIMS: true,
    read: (s) => ({ records: strip(s),
      incomplete_because: s.split("|").filter(Boolean).at(-1) === "<end>" ? null : "no terminator record" }),
  },
  // The negative-claim attack. It has the same demonstrated capacity as
  // framed, but disclaims it. A claim-only report currently renders it blind.
  "disclaims-but-can": {
    CLAIMS: false,
    read: (s) => ({ records: strip(s),
      incomplete_because: s.split("|").filter(Boolean).at(-1) === "<end>" ? null : "no terminator record" }),
  },
  // Honest about its own blindness. The challenge agrees, and it is ACCEPTED —
  // refusal keys on the claim, not the outcome.
  "opaque-pipe": {
    CLAIMS: false,
    read: (s) => ({ records: strip(s), incomplete_because: null }),
  },
  // Claims the capacity, reads like the opaque pipe. Must be caught by RUNNING
  // it, not by reading the constant above.
  "claims-framing": {
    CLAIMS: true,
    read: (s) => ({ records: strip(s), incomplete_because: null }),
  },
};

// Both arms are required. A reader that always answers "truncated" is right
// about the truncated case, so a one-armed challenge passes a constant.
function challenge(reader) {
  const rightAboutComplete = reader.read(COMPLETE).incomplete_because === null;
  const rightAboutTruncated = reader.read(TRUNCATED).incomplete_because !== null;
  return { claimed: reader.CLAIMS, rightAboutComplete, rightAboutTruncated,
    passed: rightAboutComplete && rightAboutTruncated,
    constant: rightAboutComplete !== rightAboutTruncated };
}
const accepted = (c) => !(c.claimed && !c.passed);

const DECLARED = "no - declared";
const CAN_TELL = "not known otherwise, and this reader can tell";
const CANNOT = "not known otherwise, and this reader CANNOT tell";
// Still no `complete` value. 改良點 15 is not relaxed by a word.

function readWith(name, stream) {
  const c = challenge(READERS[name]);
  const r = READERS[name].read(stream);
  return { reader: name, records: r.records, incomplete_because: r.incomplete_because,
    completeness: r.incomplete_because ? DECLARED : (c.passed ? CAN_TELL : CANNOT), challenge: c };
}

export function run() {
  const { say, check, done } = harness("p18 — declare capacity, not state");

  say("\n  1. the challenge, on two streams whose answers the harness knows");
  for (const name of Object.keys(READERS).sort()) {
    const c = challenge(READERS[name]);
    say(`     ${name.padEnd(16)} claims=${String(c.claimed).padEnd(6)} complete->silent=${String(c.rightAboutComplete).padEnd(6)} truncated->spoke=${String(c.rightAboutTruncated).padEnd(6)} ${c.passed ? "passed" : "failed"}`);
  }
  check("framed passes", challenge(READERS.framed).passed === true);
  check("claims-framing does not", challenge(READERS["claims-framing"]).passed === false);
  check("and is refused, because it CLAIMED", accepted(challenge(READERS["claims-framing"])) === false);
  check("opaque-pipe also fails, and is ACCEPTED — it claimed nothing",
    challenge(READERS["opaque-pipe"]).passed === false
    && accepted(challenge(READERS["opaque-pipe"])) === true,
    "refusal keys on the claim, not the outcome");

  say("\n  2. a constant answer must not pass — this is why both arms exist");
  const alwaysTruncated = { CLAIMS: true, read: () => ({ records: [], incomplete_because: "no terminator record" }) };
  const alwaysComplete = { CLAIMS: true, read: () => ({ records: [], incomplete_because: null }) };
  const ct = challenge(alwaysTruncated);
  const cc = challenge(alwaysComplete);
  check("a reader that always says truncated IS right about the truncated stream",
    ct.rightAboutTruncated === true);
  check("so a ONE-ARMED challenge would have passed it", ct.constant === true);
  check("and the two-armed one does not", ct.passed === false);
  check("the mirror image fails too", cc.passed === false && cc.rightAboutComplete === true);

  say("\n  3. the control pair — two silences that must not share a column");
  const framedOnComplete = readWith("framed", COMPLETE);
  const pipeOnTruncated = readWith("opaque-pipe", TRUNCATED);
  check("framed is silent on the COMPLETE stream", framedOnComplete.incomplete_because === null);
  check("opaque-pipe is silent on the TRUNCATED one", pipeOnTruncated.incomplete_because === null);
  check("so silence alone separates nothing",
    framedOnComplete.incomplete_because === pipeOnTruncated.incomplete_because);
  check("and the completeness column does",
    framedOnComplete.completeness !== pipeOnTruncated.completeness);
  check("three values, and none of them is `complete`",
    new Set([DECLARED, CAN_TELL, CANNOT]).size === 3
    && ![DECLARED, CAN_TELL, CANNOT].some((v) => v === "complete"));

  say("\n  4. a negative capability claim is a claim, not verified blindness");
  const disclaimerChallenge = challenge(READERS["disclaims-but-can"]);
  const disclaimerOnComplete = readWith("disclaims-but-can", COMPLETE);
  check("the disclaiming reader actually passes both challenge arms",
    disclaimerChallenge.claimed === false && disclaimerChallenge.passed === true);
  check("it remains accepted — a false negative is not a failed positive claim",
    accepted(disclaimerChallenge) === true);
  check("the report uses demonstrated capacity instead of rendering it blind",
    disclaimerOnComplete.completeness === CAN_TELL,
    `claimed=${disclaimerChallenge.claimed}, demonstrated=${disclaimerChallenge.passed}, rendered=${disclaimerOnComplete.completeness}`);
  check("both axes remain in evidence",
    disclaimerOnComplete.challenge.claimed === false
    && disclaimerOnComplete.challenge.passed === true);

  return done();
}

// ATTACK:
//   a. A DEMONSTRATED capacity is not a PROVED one. Passing on this pair says
//      nothing about other shapes. Build a reader that passes this challenge
//      and is still blind on a stream the harness did not think of.
//   b. make readWith require `claimed && passed` before rendering CAN_TELL -> a
//      capable reader can disclaim and be rendered blind, so section 4 goes red.
//   c. make the challenge one-armed  ->  section 2's last two checks go red.
//   d. collapse CAN_TELL and CANNOT into one value  ->  section 3 goes red, and
//      the entry reverts to 改良點 15's two-column report.
//   e. the harness must be able to CONSTRUCT the known case. Name a real reader
//      whose framing is genuine but whose inputs cannot be synthesised — that is
//      the class this whole idea does not reach.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
