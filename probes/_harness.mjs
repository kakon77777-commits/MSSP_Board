// A very small shared harness. Fifteen lines so that mutating a probe never
// means reading this file.
export function harness(title) {
  const failures = [];
  let ran = 0;
  const say = (line = "") => process.stdout.write(`${line}\n`);
  const check = (label, ok, detail = "") => {
    ran += 1;
    say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
    if (!ok) failures.push(label);
  };
  const done = () => {
    say("");
    if (failures.length > 0) say(`  ${failures.length} FAILED: ${failures.join(" | ")}`);
    else say(`  ${ran} checks passed`);
    return { title, ran, failed: failures.length };
  };
  say(`\n=== ${title}`);
  return { say, check, done };
}
