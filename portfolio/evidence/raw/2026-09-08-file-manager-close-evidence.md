---
date: 2026-09-08
topic: app2-file-manager-technical-close-evidence-index
status: exact-evidence-index
authority: portfolio-projection-not-product-reacceptance
---

# App 2 file-manager-basic — technical-close evidence index

Exact product subject:

```text
commit  40b781c6f903cd941c49af57614c9a02b525907f
tree    f2317ebb25ff93c4d830e3e5155bf2dc9811bb50
main    reachable and current at close preparation
```

Three independent seats reported no blocker on that exact subject. The durable
sources remain outside this repository and are indexed here by exact bytes and
SHA-256; this file is a portfolio projection, not a replacement for them.

```text
Pragma acceptance
  MSSP_Architect_Exchange/evidence/2026-09-08-pragma-app2-40-id-integration-candidate-v4.md
  2262 / EA64A2FC788F1FA360D12A5C28BA5103829757E0D6C2D515DA5894BAE25C494C

Metron exact review
  MSSP_Architect_Exchange/acceptance/2026-09-08-metron-app2-final-integration-40b781c-review.md
  2672 / E470862F4E5139FD6BD6303DBB6DABC93B6C8E40CD6A551DB19EFEEFDF990756

Elenchos final attack
  MSSP_Architect_Exchange/acceptance/2026-09-08-elenchos-app2-final-40b781c-attack.md
  5763 / DC35F09F1BF2EAC32A0B4036F3C37329D9E12327300FA7B3CA3D2249C8432C66

Elenchos attestation
  MSSP_Architect_Exchange/attestations/2026-09-08-elenchos-app2-final-40b781c.md
  3060 / 391CA42C15E3AB777A37E9389C3B7F46E54398C8FFAB7722F7F8C9B4E8F0FC32
```

Final acceptance facts:

```text
full acceptance glob     47 / 47
default 40-ID matrix     40 / 40; open 0
matrix mutation drill    10 attacks / 0 green / 0 errors / 0 did not apply
comparator               5 / 5, separate evidence rather than a second measured test command
native recycle           Electron shell.trashItem plus independent $I/$R metadata and payload recovery
native directory picker  NotMeasured; the host lacked Trusted RPC and stubbed evidence stayed labelled stubbed
```

The first full-glob run had one dynamic-lock ready timeout before the product
callback began. Helper residue was zero. The exact standalone test then passed
2/2 and the default matrix reran it 2/2. This remains an environment/harness
observation, not a product failure and not a product pass inferred from the
timeout.

Fresh close-prep replay used the unchanged exact product worktree. `npm test`
passed 54/54 and `npm run build:check` exited 0. The ten author drills and the
acceptance matrix drill were run sequentially; controls restored green and the
worktree remained clean:

```text
npm-test                          54 tests / 0 failures
author-drill-directory-snapshot  6 attacks / 0 green / 0 errors / 0 did not apply
author-drill-dms-freshness        2 attacks / 0 green / 0 errors / 0 did not apply
author-drill-dms-projection       1 attacks / 0 green / 0 errors / 0 did not apply
author-drill-identity-and-name    6 attacks / 0 green / 0 errors / 0 did not apply
author-drill-mutations            10 attacks / 0 green / 0 errors / 0 did not apply
author-drill-preload-surface      5 attacks / 0 green / 0 errors / 0 did not apply
author-drill-readable-probe       1 attacks / 0 green / 0 errors / 0 did not apply
author-drill-root-picker-sequence 4 attacks / 0 green / 0 errors / 0 did not apply
author-drill-root-session         9 attacks / 0 green / 0 errors / 0 did not apply
author-drill-security             5 attacks / 0 green / 0 errors / 0 did not apply
acceptance-drill-matrix           10 attacks / 0 green / 0 errors / 0 did not apply
```

The close-prep worktree initially lacked both built artifacts and local
dependencies. Its first test attempt therefore failed at module loading and its
build attempt failed because `tsc` was absent; neither was a product result.
The replay above was performed on the separate clean exact-40b worktree whose
dependencies and generated artifacts already existed.

Default-main integration record:

```text
MSSP_Architect_Exchange/decisions/2026-09-08-app2-product-main-fast-forward.md
1894 / E19FA206AFCF8F0356111B8345201D5D4AF82D10BD52EC4F7FFC912B07DD5B5F
```

No release, deployment, publication or App 3 work is authorized or represented
by this close projection.
