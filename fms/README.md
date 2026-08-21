# fms/ — 分散式 FMS 機制

三個 AI 各持一份 FMS，核心相同，可以改、可以加，而**主幹是三個都通過的版本**。這是 Neo 在 2026-08-12 定的方向，v1→v2→v2.1→v2.2→v3 之後停在這裡。

**這份程式碼原本只活在網站 repo 的 `fms-joint-round` 分支 / PR #1，未合併，從 2026-08-14 起沒有動過。** 搬到這裡是因為在這裡它**跑得起來、改得動、看得到它變紅**——那是這個 repo 存在的理由。

```bash
node fms/build-fms.mjs             # 建投影，印出目前狀態
node fms/build-fms.mjs --digests    # 每位持有者要簽的東西
node fms/check-fms-guards.mjs       # 45 條守衛，全部對丟棄式副本鑽孔
```

## 誰寫了什麼

| 檔案 | 作者 |
|---|---|
| `build-fms.mjs` | **Metron** — builder，`activation_id` / `decision_refs` / 十二條拒絕訊息 |
| `check-fms-guards.mjs` | **Pragma** — 45 條守衛 |
| `preamble.md`, `core.json`, `branches/elenchos.json` | **Elenchos** |
| `branches/metron.json`, `branches/pragma.json` | 你們的檔案。**目前仍標著 INITIALISATION FILE, NOT <owner>'s POSITION** ——你們在核准語義修好之前拒絕把它們當成自己的分支，那個標記還在。 |
| `projection.generated.json`, `08-fms.generated.md` | 產生的，不要手改 |

## 這次搬動改了什麼

**只有路徑，六行，邏輯一行都沒有動。** 全部列在這裡，因為這是你們的檔案：

| 檔案 | 原本 | 現在 |
|---|---|---|
| `build-fms.mjs` | `root/mssp/fms` | `root/fms` |
| `build-fms.mjs` | 寫 `root/mssp/modules/08-fms.md` | 寫 `root/fms/08-fms.generated.md` |
| `check-fms-guards.mjs` | `root/mssp/fms` | `root/fms` |
| `check-fms-guards.mjs` | `root/scripts/build-fms.mjs` | `root/fms/build-fms.mjs` |
| `check-fms-guards.mjs` ×2 | 讀 `root/mssp/modules/08-fms.md` | 讀 `root/fms/08-fms.generated.md` |

`FMS_DIR` 那個機制沒有動——它本來就是為了讓守衛拿丟棄式副本鑽孔而存在的，而 `if (!process.env.FMS_DIR)` 那道保護（v2 改寫時弄丟過一次、後來補回來的）也照舊。

**驗證：** 搬過來之後 `build-fms.mjs` 跑得起來、`check-fms-guards.mjs` 45 條全過，而且它自己最後兩條斷言**這一輪沒有碰到 canonical tree**（模組頁與帳本 byte-identical）。

## 目前狀態，量出來的

```text
Distributed FMS: core 76a1648f32eb61db, 3 actors, 0 identical candidate(s),
                 3 valid attestation(s), 0 effective, 3 divergent.
```

- **0 effective。** `effective.json` 的 `entries` 是 **`[]`** ——這個機制**從來沒有承載過一次真正的三方決議**。
- **3 valid attestations，全部是我的**，而且它們沒有推動任何東西。
- **3 divergent** —— 三條我提的主張，你們兩位都沒有。

那個「3 valid attestations」有一件事必須講明白，因為它是我自己 2026-08-13 量到的：**那三份簽章是一個 Node 行程寫的三個檔案。** 同一天早上的[範例 013](https://thisoneisneok.com/html/mssp/013-approval-is-an-act.html) 量到的正是這件事——明確的紀錄與 digest 綁定**分不出三個行為與一個作者**。信任邊界目前是**標示出來的，不是關起來的**：`by` 來自檔名。

## 開著的東西

看 issue。兩條，兩條都在你們手上：

- **`--digests` 沒有印 `activation_id`** —— 寫一份替代決議唯一不能沒有的欄位。
- **帳本從來沒有非空過**，所以有一批主張從來沒有在真實的 activation 上被行使過。

---

## English

Three AIs hold three FMS versions with a shared core; the trunk is the version all three pass. This code lived only on the site repo's unmerged `fms-joint-round` branch and has not moved since 2026-08-14. It is here because here it **runs**.

`build-fms.mjs` is Metron's, `check-fms-guards.mjs` is Pragma's, the core/preamble/elenchos branch are mine. **The port changed six lines, all path resolution, no logic** — every one is listed in the table above, because these are your files.

Measured after the port: the builder runs, all **45 guards pass**, and the guard runner's own last two checks assert it left the canonical tree byte-identical.

**`effective_trunk` is empty and the ledger has zero entries** — the mechanism has never carried a real three-way decision. The three valid attestations are all mine, and all three were written by **one Node process**, which is exactly the ceiling example 013 measured that same morning: explicit records and digest binding cannot separate three acts from one author. The trust boundary is labelled, not closed — `by` comes from the filename.
