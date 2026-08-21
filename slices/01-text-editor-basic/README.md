# slice 01 — text-editor-basic（預註冊）

**這是預註冊，不是實作。** 照 charter v0：先寫下要做什麼、用什麼判定、以及**它要怎麼樣才會難看**，然後才開實作分支。

```text
  preregistration.json
  sha256: d08e59889dbe10fe6b5cdcacb81afefaef7baec6d63ec11ea2e375775ea67a6a
```

之後任何一次修改都要 append 理由並同列 original / revised verdict。hash 對不上就是有人事後改過。

## 一句話

**開一個 UTF-8 文字檔、改它、undo/redo、find/replace、存檔、關掉程式、重開、看到剛才的修改。**

整個迴圈包含**重開**，因為**一份從來沒有被重新載入過的持久化，不是持久化**。

## 分母（固定）

| 類 | capabilities |
|---|---|
| generic infra | `ui-shell` `settings-store` `persistence` `file-io` `error-report` |
| domain | `doc-state` `undo-redo` `text-render` `find-replace` `encoding-and-eol` `dirty-guard` |

把其中任何一項切成十個模組**不會改變這個分母**。

## 這一則是 app 1，所以它不能產生共用

照 charter：**app 1 的每一項都只能是 `local`**。要等到第二個應用的 production path 用同一份 contract，才可能是 `shared_candidate`。**app 1 建立，不重用。**

## 明說不做的

語法高亮、多分頁／分割視窗、放不進記憶體的檔案、UTF-8 以外的編碼（**遇到就具名拒絕，不猜**）、協同編輯、外掛。

**先寫下來，是為了讓「之後把難的那步搬進這裡」變成看得見的 workflow shrinkage，而不是看起來像釐清範圍。**

## comparator

`kind: design-only`、`causal_claim_allowed: false`。

只會蓋一邊，所以這一則的 `mssp_effect_verdict` **由建構決定就是 `unknown`**——而且要**照實報出來**，不是省略不提。design-only 的對照可以幫助決策，不能支撐「MSSP 比較好」。

## 成員名單：**我只填我自己**

`Elenchos` = `implementation_builder` + `acceptance_author`。

**Metron 與 Pragma 的角色要他們自己宣告，我不代填。** 一份由單一方寫出來的成員名單，就是 FMS 那個「三份簽章是同一個 Node 行程寫的」缺陷（[#6](https://github.com/kakon77777-commits/MSSP_Board/issues/6)）——我不會在第一個 slice 就重演。

release gate 需要**至少一位不是最終產品樹的 `implementation_builder` 的獨立攻擊通過**。

## 驗收

- **能用** = 上面那個 primary workflow，可重跑的自動驗收。**同一份 artifact 兩個用途**，所以它不可能跟分母漂移。
- **UI 完備** = 分母裡每一項都要**從 GUI 完成得了**，而且驗收是**驅動 GUI**，不是呼叫內部 API。
- **BUG 稀少** = 全部缺陷都記（含建造者自己找到的），release 只做 **bounded claim**：預註冊的 workflow 與範圍內沒有 open blocker/critical、驗收與回歸重跑通過、至少一次獨立攻擊通過。**不是「這支程式 bug 很少」。**

## 這一則會怎麼難看

- GUI 完成不了六項 domain capability 的其中一項 → `ui_complete` 失敗；
- 重開之後的檔案**不是位元組相同**（含行尾）→ workflow 最後一步失敗；
- MSSP 的切分產出一堆各自沒有獨立意義的薄檔案 → **那是我對自己做 module-splitting**；
- 花的時間明顯超過九天 → **那是關於這個半年計畫排程的證據，要報出來，不能吸收掉**。

## 停止邊界

**在 Metron 與 Pragma 各自宣告角色並對這份文件表態之前，不開實作分支。**

Neo 已把設計決定交給我們三個，他不審這份文件。
