# slice 01 — text-editor-basic（預註冊 v3）

> **這個檔案是產生出來的。** 不要手改 —— 改 `preregistration.json` 然後跑
> `node slices/01-text-editor-basic/render-readme.mjs`。
> `--check` 會在它過期時 exit 1。

```text
  preregistration.json  sha256 c6167506300357b529910b47e7df1f4f95918793e2a28626197c4b7a3a872617
  v0 sha256 d08e59889dbe10fe6b5cdcacb81afefaef7baec6d63ec11ea2e375775ea67a6a  (preregistration.v0.json)
  v1 sha256 2ef304cd53eb31f729e620aa102055167f6ac4b922f6623ca52808fd1d8238ea  (preregistration.v1.json)
  v2 sha256 d1f78318a9399a788b92363f75673c9ec552f6058c4ff6e97f70210db4728fa1  (preregistration.v2.json)
```

**這是預註冊，不是實作。** 目標平台 **Windows 11 x64**，其他 OS = `NotMeasured`。

## 產品工作流（11 步）

1. launch the packaged application
2. create a new empty document and type into it
3. save it with Save As to a new path
4. select text, cut it, and paste it back
5. open a pinned UTF-8 fixture from disk
6. edit its contents
7. undo and redo those edits
8. find and replace within the document
9. save
10. close the application, relaunch it, and manually reopen the file
11. an EXTERNAL oracle verifies the saved bytes and line endings against the expected value

**The program must not be its own oracle. Bytes it wrote being equal to bytes it reads back is a statement about one program, not about correctness.**

## 固定分母：11 項

| 類 | capabilities |
|---|---|
| generic infra | `ui-shell` `error-report` |
| domain | `document-io` `document-state` `undo-redo` `text-view-edit` `find-replace` `encoding-eol` `unsaved-change-guard` `new-saveas` `clipboard` |

Every capability maps to a DISTINCT failable row. No row may be cited by two capabilities without an independent assertion, and a capability with no row may not be in the denominator.

| capability | 怎麼觀察 |
|---|---|
| `ui-shell` | every workflow step is driven through it; a step needing an internal call fails ui_complete |
| `error-report` | attack: the invalid-not-utf8 fixture is refused BY NAME and the name reaches the GUI |
| `document-io` | steps 5 and 9 - reading and writing the user's document |
| `document-state` | steps 2 and 6 - after edit, undo, redo and save, the visible dirty projection equals the main-process authoritative dirty state; this assertion can fail while typed text remains visible |
| `undo-redo` | step 7 |
| `text-view-edit` | steps 2 and 6 - what is typed is what is shown |
| `find-replace` | step 8 |
| `encoding-eol` | step 11 - external oracle checks bytes and line endings across LF, CRLF and BOM fixtures |
| `unsaved-change-guard` | attack: close with unsaved changes by a route the acceptance does not drive |
| `new-saveas` | steps 2 and 3 |
| `clipboard` | step 4 |

## 修訂紀錄

**v1 kept settings-store by ADDING recent-files and window-geometry to the product workflow**（Metron 提）

settings-store and app-state persistence are REMOVED from app 1's denominator. 13 capabilities become 11.

> This is the one that stings. Pragma said settings-store had no acceptance step; instead of asking whether it belonged in the denominator at all, I grew the product scope until it did. That is foundation stuffing by another route - keeping a capability alive by inventing workflow for it. A basic text editor does not need recent files or window restore to be a basic text editor. If either appears while building, it is recorded as a local observation and does NOT enter this round's denominator or any reuse numerator.

**settings-store and persistence both cited step 9 - one observable effect counted as two capabilities**（Metron 提）

moot after removal; the rule is now explicit - every capability must map to a DISTINCT failable evidence row, and no row may be cited twice without an independent assertion

**document-io is not needed by every windowed application, so classing it generic would hand app2 and app6 undeserved generic reuse credit**（Pragma 提）

generic_infra is now only ui-shell and error-report; document-io moved to domain

**README described six domain capabilities and the old workflow while the JSON had eight and a ten-step workflow**（Metron and Pragma 提）

README regenerated from this file in the same commit; a drift check is part of the acceptance protocol

> The human handout and the canonical preregistration disagreed about the denominator. Two views of one document that can disagree is the same defect the FMS units map was built to stop.

**the membership artifact still said pending for Metron and Pragma after both had self-declared**（Pragma 提）

entries now carry each party's own declaration reference; I still author only my own row

**no execution environment was preregistered, so acceptance could not be recomputed on another machine**（Metron and Pragma 提）

target OS, runtime, package form, fixtures with hashes, EOL/BOM policy, timing policy and start/end events are all pinned below

**v3**（2026-08-26，Elenchos）

Executes section 1.3.3 of the A2 MSSP core agreed 3/3 at sha256 8656A872133D826CF0E08B7AFAE3EFDBAC0A83F6CCB427F507F38B6681D2D05F. Both corrections were reported by the outsourced A1 implementer reading this file from outside; neither was found by the three architects.

- stack.editor_component: 'CodeMirror (plain-text mode)' -> 'native textarea (plain-text)'. The stack entry was written before implementation and A1 measured a textarea carrying all four editing capabilities on Windows. Nothing checked implementation against stack, which is why the divergence survived three days.
- capability_acceptance_map['document-state']: 'steps 2 and 6' -> the row now names an assertion that can fail while text-view-edit stays green. The old row rested on the same workflow steps as text-view-edit and asserted nothing of its own, so one piece of evidence was counted twice in an 11-capability denominator.

## 技術與邊界

- **Stack**：Electron + TypeScript + native textarea (plain-text)，GUI 自動化用 Playwright Electron API。
- **驗收跑的是** the packaged executable, never a dev server。
- **Playwright Electron 是 experimental**：official docs mark Electron automation experimental; the version used goes into the evidence, and if an upgrade breaks it that is reported as an integration failure rather than fixed by changing the acceptance
- **對話框覆蓋**：自動化那條標 `dialog_path=stubbed`，原生 Open/Save As 另有一份 smoke，**前者永遠不能當成後者**。
- **效能 = `NotMeasured`**。a second-count verdict without pinned CPU, RAM, storage and background load is false precision只記原始時間，hang detector 每個 GUI 動作 30s、整個流程上限 180s。
- **外部套件不算 MSSP 地基**：Electron, the editor component and Playwright themselves never count toward any local or shared MSSP foundation。a TMS that is only a one-caller no-state wrapper over an editor-component or browser API triggers module-splitting; naming it a capability does not make it an architectural result
- **物理拓樸不預註冊**（`preregistered: false`）。假設是「each domain capability may become one TMS unit」，證偽條件：a unit with no state of its own, exactly one caller, and no ability to be exercised alone by the island test is evidence the hypothesis was wrong for that capability

## Fixtures（預先雜湊）

| key | 檔案 | bytes | sha256 |
|---|---|---|---|
| small_lf | `small-lf.txt` | 17 | `4fdbc441ea7b5461…` |
| small_crlf | `small-crlf.txt` | 20 | `c8dba68945249de9…` |
| small_bom | `small-utf8-bom.txt` | 14 | `bf7a11618542a830…` |
| normal_1mib_lf | `normal-1mib-lf.txt` | 1048575 | `e17f98ce439b3ae6…` |
| invalid_not_utf8 | `invalid-not-utf8.bin` | 14 | `19324eed10b46b4b…` |

Pinned by hash before implementation. The 1 MiB fixture exists to stop tiny-fixture laundering, not to support a latency claim.

## 實作切片

- **A0 file loop** — packaged launch, new/open/edit/Save As/save, unsaved-change guard, manual reopen, external byte and EOL oracle
- **A1 editing loop** — undo/redo, selection and clipboard, find/replace
- **A2 boundary loop** — UTF-8/BOM/EOL policy, named GUI refusal of invalid encoding, full regression and packaging evidence

Each slice starts RED with contract and GUI tests before any production code. The final denominator does not change because of implementation order.

## 角色

| 誰 | 角色 | 誰宣告的 |
|---|---|---|
| Elenchos | implementation_builder + acceptance_author | Elenchos — this file |
| Metron | reviewer + attack_author | Metron — PR #14 comment 5366635281; Board 3b18559a |
| Pragma | reviewer + attack_author | Pragma — PR #14 review 4990830147; Board 0a2a8c05 |

**at least one independent attack pass by a party that is not an implementation_builder of the FINAL product tree digest**

## 這一則會怎麼難看

- the GUI cannot complete one of the nine domain capabilities without an internal call, and ui_complete fails
- the reopened file is not byte-identical and the external oracle rejects it
- a capability turns out to be a thin editor-component wrapper, which is module-splitting done to myself
- the acceptance can only drive stubbed dialogs, so native-dialog coverage stays NotMeasured and must be reported as such
- a capability in capability_acceptance_map has no observable step that can actually fail, which would make the map decoration

## 停止邊界

**No A2 production until all of: a unified source baseline containing both the A1 head and the A0 boundary head; this preregistration green under its own fail-closed verifier with the append-only history intact; an exact workbench request derived from the three-architect-agreed core digest without broadening it; and Neo's explicit authorization to send that request. Three-architect agreement on the core is not by itself send authorization. This boundary grants no merge to main, no deployment, and no MSSP method adoption.**
