// Generate dist/renderer/index.html from the template and security contract,
// and copy the same-origin stylesheet admitted by that contract.
//
//   node scripts/render-renderer.mjs           write it
//   node scripts/render-renderer.mjs --check   exit 1 if what is on disk is stale
//
// The Content-Security-Policy has exactly one author: contentSecurityPolicy()
// in src/main/security.ts. The template carries a placeholder, never a policy.
//
// This exists because a hand-copied rule is a rule that will drift. On
// 2026-08-23 the cross-provider line fixed a contract and missed three other
// copies of the same claim — two in a docstring, one on an error path. The cure
// is not "remember to sync"; it is making the second copy impossible to write
// by hand, and turning the check red when the generated file falls behind.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
// A compiled .js under src/ is always a build accident: every emit goes to dist.
// One appeared when a tsconfig's rootDir excluded a file it still read, and tsc
// wrote that file's output beside its source. It was one `export {};` line and
// nothing failed -- which is why it has a check rather than a convention.
function checkNoEmittedSourcesUnderSrc() {
  const strays = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) strays.push(path.relative(app, full));
    }
  };
  walk(path.join(app, "src"));
  if (strays.length > 0) {
    console.error("  FAIL compiled JavaScript found under src/: " + strays.join(", "));
    return false;
  }
  console.log("  ok   no compiled JavaScript under src/");
  return true;
}

const TEMPLATE = path.join(app, "src", "renderer", "index.template.html");
const STYLES = path.join(app, "src", "renderer", "styles.css");
const SECURITY = path.join(app, "dist", "main", "security.js");
const OUT = path.join(app, "dist", "renderer", "index.html");
const STYLES_OUT = path.join(app, "dist", "renderer", "styles.css");
const PLACEHOLDER = "__CSP__";

async function render() {
  if (!fs.existsSync(SECURITY)) {
    throw new Error(
      `dist/main/security.js is not built, so the CSP has no source.\n`
      + `  Run tsc first — this script reads the contract, it does not restate it.`);
  }
  const { contentSecurityPolicy } = await import(pathToFileURL(SECURITY).href);
  const template = fs.readFileSync(TEMPLATE, "utf8");

  // A template that no longer carries the placeholder would silently render a
  // page with whatever policy someone typed in by hand — the exact failure this
  // file prevents — so refuse rather than produce it.
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(
      `the template has no ${PLACEHOLDER} placeholder.\n`
      + `  Someone wrote a policy into it by hand; the generated page would then\n`
      + `  have a second, drifting declaration. Restore the placeholder.`);
  }
  const csp = contentSecurityPolicy();
  if (/["']/.test(csp.replace(/'self'|'none'/g, ""))) {
    throw new Error(`the policy contains a quote that would break the meta attribute: ${csp}`);
  }
  return template.replace(PLACEHOLDER, csp);
}

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const check = process.argv.includes("--check");
const wanted = await render();
const wantedStyles = fs.readFileSync(STYLES, "utf8");

if (check) {
  const sourcesClean = checkNoEmittedSourcesUnderSrc();
  const found = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  const foundStyles = fs.existsSync(STYLES_OUT) ? fs.readFileSync(STYLES_OUT, "utf8") : null;
  if (sourcesClean && found === wanted && foundStyles === wantedStyles) {
    process.stdout.write(`  ok   dist/renderer/index.html is current (${sha(wanted).slice(0, 16)}…)\n`);
    process.stdout.write(
      `  ok   dist/renderer/styles.css is current (${sha(wantedStyles).slice(0, 16)}…)\n`);
    process.exit(0);
  }
  if (found !== wanted) {
    process.stdout.write(
      found === null
        ? "  FAIL dist/renderer/index.html does not exist\n"
        : `  FAIL dist/renderer/index.html is stale\n`
          + `         on disk   ${sha(found).slice(0, 16)}…\n`
          + `         generated ${sha(wanted).slice(0, 16)}…\n`);
  }
  if (foundStyles !== wantedStyles) {
    process.stdout.write(
      foundStyles === null
        ? "  FAIL dist/renderer/styles.css does not exist\n"
        : `  FAIL dist/renderer/styles.css is stale\n`
          + `         on disk   ${sha(foundStyles).slice(0, 16)}…\n`
          + `         generated ${sha(wantedStyles).slice(0, 16)}…\n`);
  }
  process.stdout.write("       run: npm run build\n");
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, wanted, "utf8");
fs.writeFileSync(STYLES_OUT, wantedStyles, "utf8");
process.stdout.write(`  wrote dist/renderer/index.html  (${sha(wanted).slice(0, 16)}…)\n`);
process.stdout.write(`  wrote dist/renderer/styles.css (${sha(wantedStyles).slice(0, 16)}…)\n`);

// ATTACK: each of these must make --check exit 1, and tests/drill-renderer.mjs
// applies them to a throwaway copy:
//   a. edit the CSP inside the generated index.html
//   b. change contentSecurityPolicy() without rebuilding
//   c. delete the generated file
//   d. replace the template's placeholder with a hand-written policy (render
//      itself must refuse, not silently emit)
// plus a CONTROL that changes nothing and must stay green.
