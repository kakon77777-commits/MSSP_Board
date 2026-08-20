# probes/

每一個檔案是**一條提案的核心量測**，蒸餾到小得可以整個讀完、整個改掉。

```bash
node probes/run-all.mjs           # 全部
node probes/p16-incentive.mjs     # 單獨一條
node probes/verify-attacks.mjs    # 檢查「攻擊」本身有沒有用
```

| 檔案 | 提案 | 一句話 |
|---|---|---|
| `p13-break-in-place.mjs` | 改良點 13 | 孤島測試只會移除，不會把單元留在原地弄壞 |
| `p14-outcome-travels.mjs` | 改良點 14 | outcome 要跟著紀錄走；`finished` 是觀察出來的，不是宣告的 |
| `p15-direction.mjs` | 改良點 15 | 可以宣告自己不完整，不可以宣告自己完整 |
| `p16-incentive.mjs` | 改良點 16 | 方向由**消費它的政策**決定，而那可以用反事實量出來 |
| `p17-applicability.mjs` | 改良點 17 | 一個量測回傳**值 + 適用性**；聚合器要拒絕 |
| `p18-capacity-challenge.mjs` | 改良點 18 | 宣告**能力**不宣告狀態，而能力可以被挑戰 |

## 怎麼攻擊

每個檔案結尾有 `ATTACK:` 區塊，列出具體的變異。做法：

```bash
cp -r probes /tmp/attack && cd /tmp/attack
# 改一行
node run-all.mjs        # 看它變紅
```

然後開一個 Issue 或 PR，說**改了什麼**、**哪幾條變紅**、以及**你認為那代表什麼**。

## `verify-attacks.mjs` 在做什麼

它把每一條列出來的攻擊套到一份丟棄式副本上再跑一次。三種結果：

- `red, N check(s)` —— 攻擊有效，probe 抓得到。
- **`GREEN`** —— 攻擊套用了，而 probe **沒有注意到**。那是 probe 的洞，不是攻擊的洞。
- **`DID NOT APPLY`** —— 錨點字串不在檔案裡（通常是重構之後）。這一種**最像成功**，因為它什麼都沒量到卻不會噴錯，所以它單獨列一種狀態。

驗證器自己也驗過：塞一個只改註解的無效攻擊進去，它報 `GREEN`；塞一個不存在的錨點，它報 `DID NOT APPLY`。**一個不會失敗的驗證器沒有用。**

## 這裡是蒸餾，不是複本

完整的範例、孤島測試、對照組與考古在網站上：<https://thisoneisneok.com/mssp>

**如果某個 probe 跟網站上的條目不一致，以網站上跑得起來的那份為準**，並開 Issue 說哪裡不一致。

---

## English

Each file is one proposal's core measurement, distilled small enough to read and mutate whole.

- `node probes/run-all.mjs` — everything. `node probes/pNN-*.mjs` — one.
- Every file ends with an `ATTACK:` block. Copy the directory, change one line, run, see it go red, then open an issue or PR saying **what you changed, which checks went red, and what you think it means**.
- `verify-attacks.mjs` applies each stated attack to a throwaway copy. **GREEN** means the probe does not notice — that is a hole in the probe. **DID NOT APPLY** means the anchor string moved; it measured nothing while looking like it ran, so it gets its own state.
- The verifier has itself been checked against a vacuous attack (reports GREEN) and a missing anchor (reports DID NOT APPLY).

The hard attacks in those blocks are open, and the hardest is in `p16`: the Board host's **quorum skewing** and **poison-pill masking** both need more than one consumer, and every example in this run has exactly one by construction.
