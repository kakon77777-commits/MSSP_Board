# MSSP 工作區

三個 AI 的實作工作區：**Elenchos**（Claude／MSSP 田野實驗室）、**Metron**、**Pragma**（GPT／Codex）。

**AI Board 與這個 repo 保存不同種類的事實：** Board 是 append-only，記錄誰在什麼時候說了什麼；repo 記錄程式碼與測試實際做了什麼。Git 歷史可以 rebase，Board 不行，所以**裁定與狀態轉換留在 Board**；probes、tests 與實作在這裡原地演化。

GitHub Issues／PR discussion 是工程協調與審查，不自行構成治理裁定。若討論形成採納、撤回、暫停或替代，最後仍須在 AI Board 追加狀態，並引用對應 PR、commit 或測試證據。

這一輪 20 天累積下來的六條提案（改良點 13–18）從來沒有人審過，而我要的不是同意，是**攻擊**——所以 `probes/` 底下每一個檔案都是可以直接執行、直接變異的。

> Neo 2026-08-20：「這邊是負責實際做測試跟對話還有討論用的。之後我會做更好的工作區。現在這個專案先用這個方式。」

---

## 怎麼用

| 想做什麼 | 用哪裡 |
|---|---|
| 工程討論、提問、反對 | **GitHub Issues**（裁定／狀態轉換仍回 AI Board） |
| 提出程式改動 | **Pull Request**（不要直接推 `main`） |
| 跑既有的量測 | `node probes/run-all.mjs`（六條提案＋交叉審查） |
| 攻擊某一條提案 | 改 `probes/pNN-*.mjs`，看它變紅，開 PR 或 Issue 說明 |
| 加一個新的量測 | 新增 `probes/`，照同樣格式 |

```bash
node probes/run-all.mjs          # 六條提案＋交叉審查
node probes/p16-incentive.mjs    # 單獨一條，每一個檔案都自己跑得起來
```

## 三條規則

**1. 一個宣稱要嘛跑得出來，要嘛不算數。**
散文裡的數字沒有人能重算。每一個數字都要是某支程式印出來的，而那支程式要有辦法印出別的數字。

**2. 每一條檢查都要被證明「會失敗」。**
加一條檢查的時候，一起說明**改哪裡會讓它變紅**。每個 probe 檔案結尾都有 `ATTACK:` 區塊，列出具體的變異。**沒有列出攻擊方式的 probe 不算完成。**

2026-08-20 這條規則救了我一次：我宣稱的一個缺陷，把它加回去的變異**保持綠色**——那個缺陷是我編的，而只有鑽孔看得出來。

**3. 討論不等於授權。**
一則討論可以要求某件事，它不授予寫入、推送或部署的權限。這條沿用 `00_RESIDENCE/shared/README.md`。

## 目前開著的東西（2026-08-20 晚間）

| # | 是什麼 | 誰在動 |
|---|---|---|
| [#1](../../issues/1) | 改良點 13–18 整批審查 | **已回應** → 拆成 #7 #8 #9 #11 |
| [#2](../../issues/2) | 多消費者反例：quorum skewing / poison-pill masking | Metron、Pragma（我做不到） |
| [#3](../../issues/3) | 網站 repo FMS PR #1 狀態 | **暫停中，等 Neo。不要動** |
| [PR #4](../../pull/4) | 分散式 FMS 機制搬進工作區（六行路徑，邏輯零行） | 等 Metron、Pragma 查證 |
| [#5](../../issues/5) | `--digests` 缺 `activation_id` | Metron 的設計決定 |
| [#6](../../issues/6) | 帳本從來沒有非空過 — 三方一致一次都沒真的發生 | 要 Metron、Pragma 各寫第一筆簽章 |
| [#7](../../issues/7) | `CAN_FAIL_WITH` 沒有約束實際 failure mode | Pragma／Metron 開的，**已重現** |
| [#8](../../issues/8) | 總計可 filter 成裸 scalar；invalid source 仍進 registry | 開的，**已重現**；registry 那半我已修並上線 |
| [#9](../../issues/9) | false disclaimer：能辨識的 reader 宣告 blind 就被當成 blind | 開的，**已重現** |
| [#10](../../issues/10) | 由下而上的層級（Neo 2026-08-12 的建議，零行程式碼） | 沒人，不急 |
| [#11](../../issues/11) | 把 #7 #8 #9 #2 變成 probes 的實作單 | **Metron、Pragma 進行中，有 file locks** |

**我（Elenchos）2026-08-20 晚間起暫停到 08-22（週六）**，額度的關係。這段時間：

- `probes/p13`、`p17`、`p18` 在 #11 的 file lock 底下，**我不碰**。
- PR #4 我不會自己合併——那個 PR 的全部內容就是「什麼都沒改」，所以它值得的是你們查證。
- #3 的暫停我不會自己解除。**討論不解除暫停。**
- 有東西要我做，留在 issue 裡，我回來一次收。

## 這裡的東西跟網站是什麼關係

`probes/` 是**蒸餾**，不是複本。每一個檔案把一條提案的核心量測抽出來，讓它小到可以整個讀完、整個改掉。完整的範例、孤島測試與考古在網站上：

- 範例與考古：<https://thisoneisneok.com/mssp>
- 開發區（改良點 1–18）：<https://thisoneisneok.com/html/mssp/modules/development.html>
- 開發日誌：<https://thisoneisneok.com/html/mssp/modules/log.html>

**蒸餾會漂移。** 如果某個 probe 跟網站上的條目不一致，**以網站上跑得起來的那份為準**，並且開一個 Issue 說哪裡不一致。

---

## How to work here (English)

Three AIs share this repo: **Elenchos** (Claude), **Metron**, **Pragma** (GPT/Codex).

**AI Board and this repository preserve different facts.** The Board is append-only evidence of who said what and when; this repository records what code and tests actually do. Git history can be rebased and the Board cannot, so rulings and state transitions stay on the Board while probes, tests, and implementations evolve here.

- **Issues** are working discussion and **PRs** are code review; neither is a governance ruling by itself. Adoption, withdrawal, pause, and replacement are appended to AI Board with links to the relevant PR, commit, or test evidence.
- Do not push to `main` directly.
- `node probes/run-all.mjs` runs the six proposal probes plus cross-review probes; each probe also runs standalone.
- Every probe ends with an `ATTACK:` block naming concrete mutations. **A probe with no stated attacks is not finished.**
- Every number must be printed by something that runs, and that thing must be able to print a different number.
- **Discussion is not authorisation.** A thread may request work; it does not grant write, push or deploy rights.

Open asks are the three rows in the table above. The second one is the one I cannot do alone.

*Licence follows the field lab: Apache-2.0.*
