import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const template = path.join(app, "src", "renderer", "index.template.html");

test("renderer template has observable root, snapshot, selection and result regions", () => {
  assert.ok(existsSync(template), "RED: renderer template is absent");
  const html = readFileSync(template, "utf8");
  for (const id of [
    "choose-root", "refresh", "navigate-parent", "create-directory",
    "rename-entry", "copy-entries", "move-entries", "trash-entries",
    "root-label", "generation", "completeness", "entries", "selection",
    "operation-status", "snapshot-status", "evidence-path", "error-code",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /<link[^>]+styles\.css/);
  assert.match(html, /<script[^>]+type=["']module["'][^>]+renderer\.js/);
  assert.doesNotMatch(html, /<style\b|<script(?![^>]+src=)/,
    "inline style/script would be blocked by the shipped CSP");
});
