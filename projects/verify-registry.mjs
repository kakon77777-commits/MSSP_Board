// Check every claim in projects/registry.json against the repository.
//
//   node projects/verify-registry.mjs
//   node projects/verify-registry.mjs --check   same thing; exits 1 on any failure
//
// A registry is a list of claims about work that exists somewhere else, so it
// drifts the moment either side moves and nothing says so. The rule this repo
// already runs on applies here: a claim either runs or does not count.
//
// What this refuses:
//   - `closed` without a reachable commit, or with a slice/app that is not there
//   - `closed` without measured numbers, so an introduction page cannot be
//     written from adjectives
//   - a measured `acceptance_ids_open` above zero on something called closed
//   - duplicate ids, gaps, or a count that is not exactly twenty
//   - a generated README that has fallen behind the registry
//
// ATTACK: each of these must make this script exit 1.
//   - set project 1 status to "planned" while it has a closed_commit
//   - change project 1's closed_commit to a commit that is not in this repo
//   - delete `measured` from project 1
//   - set measured.acceptance_ids_open to 1
//   - remove project 20 from the array
//   - edit projects/README.md by hand
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderIndex } from "./render-index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const REGISTRY = path.join(here, "registry.json");
const INDEX = path.join(here, "README.md");

const failures = [];
const fail = (id, message) => failures.push(`project ${id}: ${message}`);
const ok = (line) => process.stdout.write(`  ok   ${line}\n`);

const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
const projects = registry.projects;

if (projects.length !== 20) {
  failures.push(`the registry holds ${projects.length} projects, not 20`);
}
const ids = projects.map((p) => p.id);
for (let expected = 1; expected <= 20; expected += 1) {
  if (ids.filter((id) => id === expected).length !== 1) {
    failures.push(`id ${expected} appears ${ids.filter((id) => id === expected).length} times`);
  }
}

function commitExists(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

for (const project of projects) {
  const { id, status } = project;
  if (!["planned", "in_progress", "closed"].includes(status)) {
    fail(id, `unknown status ${JSON.stringify(status)}`);
    continue;
  }
  if (status === "planned") {
    // A planned project may be empty, but it may not carry evidence of work it
    // has not done: that is how a placeholder quietly becomes a claim.
    if (project.closed_commit !== null) fail(id, "is planned but names a closed_commit");
    if (project.measured !== null) fail(id, "is planned but carries measured numbers");
    continue;
  }
  if (project.slug === null) fail(id, `is ${status} without a slug`);
  for (const key of ["slice", "app"]) {
    const value = project[key];
    if (value === null) { fail(id, `is ${status} without ${key}`); continue; }
    if (!existsSync(path.join(repo, value))) fail(id, `${key} ${value} does not exist`);
  }
  if (status !== "closed") continue;

  if (project.closed_commit === null) {
    fail(id, "is closed without a commit");
  } else if (!commitExists(project.closed_commit)) {
    fail(id, `closed_commit ${project.closed_commit.slice(0, 12)} is not in this repository`);
  }
  if (project.measured === null) {
    fail(id, "is closed without measured numbers; an introduction page would have only adjectives");
  } else {
    const m = project.measured;
    if (!(m.tests > 0)) fail(id, "is closed with no tests");
    if (m.test_failures !== 0) fail(id, `is closed with ${m.test_failures} failing tests`);
    if (m.drill_mutations_surviving !== 0) {
      fail(id, `is closed with ${m.drill_mutations_surviving} mutations the drills did not catch`);
    }
    if (m.acceptance_ids_open !== 0) {
      fail(id, `is closed with ${m.acceptance_ids_open} acceptance IDs still open`);
    }
  }
}

const wanted = renderIndex(registry);
const found = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : null;
if (found !== wanted) {
  failures.push(found === null
    ? "projects/README.md does not exist; run: node projects/render-index.mjs"
    : "projects/README.md is stale or hand-edited; run: node projects/render-index.mjs");
}

const closed = projects.filter((p) => p.status === "closed").length;
const active = projects.filter((p) => p.status === "in_progress").length;
if (failures.length === 0) {
  ok(`20 projects: ${closed} closed, ${active} in progress, ${20 - closed - active} planned`);
  ok("every closed project names a reachable commit and carries measured numbers");
  ok("projects/README.md matches the registry");
  process.exit(0);
}
for (const line of failures) process.stderr.write(`  FAIL ${line}\n`);
process.exit(1);
