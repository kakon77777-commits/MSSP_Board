// Generate README.md from preregistration.json, and fail when the committed
// README no longer matches.
//
//   node slices/01-text-editor-basic/render-readme.mjs           # write
//   node slices/01-text-editor-basic/render-readme.mjs --check   # verify, exit 1 if stale
//
// Metron and Pragma both raised the same blocker on v1: the README said six
// domain capabilities while the JSON said eight. Two views of one document that
// can disagree about the denominator is the defect the FMS units map exists to
// stop, and fixing the words once would only have reset the clock. The human
// view is now derived, and a stale one is a build failure.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(here, "preregistration.json");
const README_PATH = path.join(here, "README.md");

/**
 * Render one revision_log row, in either of the two shapes the history contains.
 *
 * The v3 row introduced a second shape into a list this file read with one, so
 * the built page carried two literal `undefined` lines — and BOTH this renderer's
 * --check and the verifier exited 0. Two checks agreeing with each other is not
 * two checks: neither validated the row schema at all, so they agreed about
 * nothing.
 *
 * A row matching neither shape now RENDERS THE PROBLEM instead of printing
 * `undefined`, because a page that reads as broken is better than a page that
 * reads as complete and is not. The verifier fails closed on it separately.
 */
function renderRevision(r) {
  if (typeof r?.finding === "string") {
    return `**${r.finding}**${r.raised_by ? `（${r.raised_by} 提）` : ""}`
      + `\n\n${r.change ?? "*(change missing)*"}${r.note ? `\n\n> ${r.note}` : ""}`;
  }
  if (typeof r?.revision === "string") {
    const changes = Array.isArray(r.changes) ? r.changes : [];
    return `**${r.revision}**${r.date ? `（${r.date}` : ""}${r.author ? `，${r.author}）` : r.date ? "）" : ""}`
      + `\n\n${r.why ?? "*(why missing)*"}`
      + (changes.length ? `\n\n${changes.map((c) => `- ${c}`).join("\n")}` : "");
  }
  return `**MALFORMED REVISION ROW** — matches neither declared schema:\n\n`
    + `> keys: ${Object.keys(r ?? {}).join(", ") || "(none)"}`;
}
const raw = fs.readFileSync(JSON_PATH);
const d = JSON.parse(raw.toString("utf8"));
const sha = crypto.createHash("sha256").update(raw).digest("hex");

const caps = [...d.required_capabilities.generic_infra, ...d.required_capabilities.domain];
const li = (xs) => xs.map((x) => `- ${x}`).join("\n");

const md = `# slice 01 — text-editor-basic（預註冊 ${d.revision}）

> **這個檔案是產生出來的。** 不要手改 —— 改 \`preregistration.json\` 然後跑
> \`node slices/01-text-editor-basic/render-readme.mjs\`。
> \`--check\` 會在它過期時 exit 1。

\`\`\`text
  preregistration.json  sha256 ${sha}
${d.supersedes.map((s) => `  ${s.version} sha256 ${s.sha256}  (${s.kept_at})`).join("\n")}
\`\`\`

**這是預註冊，不是實作。** 目標平台 **${d.target_platform.os}**，其他 OS = \`${d.target_platform.other_os}\`。

## 產品工作流（${d.primary_workflow.length} 步）

${d.primary_workflow.map((s, i) => `${i + 1}. ${s}`).join("\n")}

**${d.why_external_oracle}**

## 固定分母：${caps.length} 項

| 類 | capabilities |
|---|---|
| generic infra | ${d.required_capabilities.generic_infra.map((c) => `\`${c}\``).join(" ")} |
| domain | ${d.required_capabilities.domain.map((c) => `\`${c}\``).join(" ")} |

${d.capability_acceptance_rule}

| capability | 怎麼觀察 |
|---|---|
${caps.map((c) => `| \`${c}\` | ${d.capability_acceptance_map[c]} |`).join("\n")}

## 修訂紀錄

${d.revision_log.map(renderRevision).join("\n\n")}

## 技術與邊界

- **Stack**：${d.stack.runtime} + ${d.stack.language} + ${d.stack.editor_component}，GUI 自動化用 ${d.stack.gui_automation}。
- **驗收跑的是** ${d.stack.acceptance_runs_against}。
- **Playwright Electron 是 experimental**：${d.stack.playwright_electron_status}
- **對話框覆蓋**：自動化那條標 \`dialog_path=stubbed\`，原生 Open/Save As 另有一份 smoke，**前者永遠不能當成後者**。
- **效能 = \`${d.performance}\`**。${d.timing_policy.why_notmeasured}只記原始時間，hang detector 每個 GUI 動作 ${d.timing_policy.hang_detector_per_gui_action_seconds}s、整個流程上限 ${d.timing_policy.workflow_hard_cap_seconds}s。
- **外部套件不算 MSSP 地基**：${d.external_provider_contract.excluded_from_numerator}。${d.external_provider_contract.thin_wrapper_rule}
- **物理拓樸不預註冊**（\`preregistered: ${d.topology.preregistered}\`）。假設是「${d.topology.hypothesis}」，證偽條件：${d.topology.falsification}

## Fixtures（預先雜湊）

| key | 檔案 | bytes | sha256 |
|---|---|---|---|
${Object.entries(d.fixtures).map(([k, v]) => `| ${k} | \`${v.file}\` | ${v.bytes} | \`${v.sha256.slice(0, 16)}…\` |`).join("\n")}

${d.fixture_policy}

## 實作切片

${d.implementation_slices.map((s) => `- **${s.id} ${s.name}** — ${s.covers}`).join("\n")}

${d.slice_rule}

## 角色

| 誰 | 角色 | 誰宣告的 |
|---|---|---|
${d.membership.entries.map((e) => `| ${e.identity} | ${e.roles.join(" + ")} | ${e.declared_by} — ${e.evidence} |`).join("\n")}

**${d.membership.release_gate}**

## 這一則會怎麼難看

${li(d.how_this_slice_could_come_out_badly)}

## 停止邊界

**${d.stop_boundary}**
`;

const mode = process.argv.includes("--check") ? "check" : "write";
const existing = fs.existsSync(README_PATH) ? fs.readFileSync(README_PATH, "utf8") : null;

if (mode === "check") {
  const fresh = existing === md;
  process.stdout.write(`  README matches preregistration.json: ${fresh}\n`);
  if (!fresh) {
    process.stdout.write("  STALE. The human handout and the canonical preregistration disagree.\n");
    process.stdout.write("  Run without --check to regenerate.\n");
  }
  process.exitCode = fresh ? 0 : 1;
} else {
  fs.writeFileSync(README_PATH, md, "utf8");
  process.stdout.write(`  README.md written from preregistration.json (${caps.length} capabilities)\n`);
}

// ATTACK:
//   a. hand-edit README.md, run --check -> must report STALE and exit 1.
//   b. add a capability to the JSON without an acceptance row -> the table
//      renders an empty cell, which is visible; the JSON-side rule that a
//      capability with no row may not be in the denominator is what refuses it.
//   c. delete README.md, run --check -> must report STALE, not crash.
export const RENDERED_SHA = sha;
export { md };
