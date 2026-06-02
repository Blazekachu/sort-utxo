# Sort UTXO — Redesign Design (testnet4-first, ord-authoritative, sat-aware)

- **Date:** 2026-06-02
- **Status:** Approved design — pending implementation plan
- **Scope:** Full redesign of the Sort UTXO tool (`F:\Users\akhil\Main\sort-utxo`)

---

## 1. Motivation

Sort UTXO sorts a wallet's UTXOs so that **assets land on the taproot (ordinals) address** and **plain BTC consolidates on the segwit (payment) address**. Live testing on 2026-06-02 exposed two fundamental defects:

1. **Detection is blind to transferred assets on testnet4.** The scanner has two paths: ord on mainnet, but a **mempool.space tx-decode** on testnet4 (`labelUtxoFromTx`). That decoder can only see an asset that is *born* in the immediate creating tx (a reveal envelope on vout 0, or a runestone output). An inscription that arrived by an ordinary key-path **transfer** leaves no envelope, so it is labeled `plain`. Concretely, parent inscription `7c16f5d1998b8eabb3f94fe8547a77c36d46c7d16fc8d766528d7bc6b31e38cci0` — stranded at offset ~4126 inside segwit UTXO `420acce8…:3` (13,685 sat) by a runes-etch Full reveal — is shown as **plain**. The tool cannot see the very thing it exists to rescue. Local testnet4 ord knows the truth: `/output/420acce8…:3` → `inscriptions:[7c16f5d1…i0]`.

2. **The tx builder is not sat-aware.** `computeDustOutputs` emits one 546 taproot output per asset but assumes the asset sits at **offset 0** and lands there via input ordering. For an asset at a non-zero offset, that dust output captures the wrong sats. This is the same unmodeled sat-flow class of bug that misdelivered the parent to segwit in runes-etch (#17 in that project's punch list).

The redesign makes **ord the single source of asset truth** and makes **sat-routing a first-class, unit-tested abstraction**.

## 2. Goals / Non-goals

**Goals (v1):**
- Authoritative asset detection via **ord** on both networks (no tx-decode fallback).
- Handle **inscriptions** (sat-surgery, any offset) **and runes** (runestone edicts) **and plain** (consolidation) in a **single atomic sort tx**.
- Bidirectional recommendations + **Select all / Deselect all recommended**.
- A **plan preview** that shows exactly where every sat goes before signing.
- First acceptance test: rescue the parent inscription off segwit to taproot on testnet4.

**Non-goals (v1):**
- No offline/local-Esplora data source (Esplora stays public with the existing emzy→memepool→mempool.space fallback).
- No batching across multiple wallets or multi-sig.
- No CPFP/RBF management beyond a single fee-rate selection.

## 3. Sequencing decision

**Full redesign first.** The parent rescue is not done as a one-off; it becomes the **first end-to-end validation** of the rebuilt tool. The parent is safe meanwhile (it is on the user's own segwit address; the only risk is spending that UTXO as fees, which we will not do).

## 4. Architecture & data sources

Two authoritative sources, cleanly separated (this **evolves** the existing codebase, following its patterns — it is not a from-scratch rewrite):

| Concern | Source | Module |
|---|---|---|
| UTXO enumeration, fee rates, tx lookup, **broadcast** | Esplora (emzy → memepool → mempool.space) | `lib/api/mempool.ts` *(multi-provider fallback already landed 2026-06-02)* |
| **Asset truth** — inscriptions, runes, sat offsets | ord: testnet4 **local (mandatory)**, mainnet **public** | `lib/api/ord.ts` *(reworked)* |
| ord health gate (testnet4) | ord `/status` | `lib/api/ordHealth.ts` *(new — ported from runes-etch)* |

**Ord policy (decided):**
- **testnet4** → local ord is **mandatory**; scanning/sorting is **health-gated** (healthy / lagging / wedged / unreachable). Wedge recovery is handled out-of-band by the user's existing ord backup/restore scripts — not the tool's concern.
- **mainnet** → public `ordinals.com`.
- **No tx-decode fallback** anywhere. The unreliable testnet4 decoder (`labelUtxoFromTx`, and the `inscription.ts` / `runestone.ts` *decoders*) is **deleted** — it is the code that mislabeled the parent.

**`ord.ts` rework:** per-network base via env (mirror runes-etch's `NEXT_PUBLIC_ORD_BASE_TESTNET` / `_MAINNET`, default `https://ordinals.com`), plus `getInscription(id)` so each inscription's **satpoint → offset within its output** can be read. Note the local-ord 0.27.1 quirk (the `output` field is absent; derive from `satpoint`) — same lesson as runes-etch #12.

**Data flow:** connect wallet → enumerate taproot + payment UTXOs (Esplora) → health-gate ord (testnet4) → label every UTXO via ord → recommend moves → user selects → **sat-ledger builder** → one PSBT → wallet signs → broadcast (Esplora).

## 5. Data model

The contract between scanner and builder:

```ts
interface LabeledUtxo {
  txid: string;
  vout: number;
  value: number;                 // sats
  source: 'taproot' | 'payment';
  assets: Asset[];               // [] === plain
}

type Asset =
  | { kind: 'inscription'; id: string; offset: number }   // offset = sats from output start
  | { kind: 'rune'; name: string; amount: bigint; divisibility: number };
```

A single UTXO may carry **multiple** assets (co-located rune + inscription, or several inscriptions). `offset` is what makes offset-aware extraction possible. A UTXO with `assets.length === 0` is plain.

## 6. Scanner (`lib/scanner/label.ts`, rewritten — ord-only, both networks)

For each UTXO:
1. `GET /output/<txid>:<vout>` → `inscriptions[]`, `runes{}`, `value`, `sat_ranges`.
2. For each inscription id, `GET /inscription/<id>` → `satpoint` → parse `txid:vout:offset` → `offset`.
3. Build `LabeledUtxo.assets`. Runes carry `amount`/`divisibility` from the `/output` `runes` map.
4. **Fail closed:** if ord cannot authoritatively answer (output not found, ord behind the UTXO's block, network error after retries), label the UTXO **`unknown`** (a distinct state) and exclude it from sorting — **never** silently downgrade to `plain`.

## 7. Sat-ledger builder (the heart)

Split into two units:
- **`planSatLedger()`** — a **pure** function (all sat math, no signing) → fully unit-testable.
- **`buildPsbt()`** — a thin assembler that turns the ledger into a bitcoinjs PSBT.

### 7.1 Core idea
Concatenating the ordered inputs forms one contiguous sat line `[0, totalIn)`. Each inscription's absolute position = `(sum of prior input values) + its offset`. Because **ordinals assign sats to outputs in order**, outputs are emitted in **sat-order** so each inscription sat lands on its intended output.

### 7.2 Input order
`[asset UTXOs] → [plain UTXOs] → [fee UTXOs]`. Fee UTXOs are appended **last**, so their sats fall in the tail (fee/change) and can never shift an inscription's absolute position.

### 7.3 Ledger walk
A cursor moves `0 → totalIn`, emitting in order:
- gap before the next inscription sat → **segwit** output (plain / pre-pad → payment address)
- the inscription sat → **546 taproot** output (asset → ordinals address)
- …repeat per inscription, sorted by absolute position…
- final remainder → **segwit** change; the unassigned tail = **fee**

### 7.4 Runes
An OP_RETURN **runestone** (0-value → it never disturbs sat math, can sit anywhere in the output order) carries explicit **edicts** `(runeId, amount → output index)` assigning each input rune balance to its taproot output. Edicts are computed **after** the output list (and therefore indices) are fixed. A co-located rune + inscription share one output. **Every** input rune balance must be covered by an explicit edict — no reliance on the runestone default output / pointer — so nothing is accidentally burned.

### 7.5 Worked example — the parent rescue
Input `420acce8…:3` (13,685 sat, inscription @ offset 4126), no rune:

| out | addr | sats | sat range | holds |
|---|---|---|---|---|
| 0 | segwit | 4,126 | [0, 4126) | pre-pad plain → back to segwit |
| 1 | **taproot** | 546 | [4126, 4672) | **parent `7c16f5d1…i0`** |
| 2 | segwit | 13,685 − 4126 − 546 − fee | [4672, …) | remaining plain → segwit |

No rune → no runestone. Parent cleanly on taproot, the rest back to segwit.

### 7.6 Edge cases (each gets a test)
- **offset 0** → no pre-pad output.
- **pre-pad or trailing < 546 (dust)** → fold those sats into the adjacent asset output rather than emit a sub-dust output (the inscription is tracked by sat, not by being first in its output, so folding is safe).
- **inscription near end-of-inputs without 546 of postage** → pull a fee/padding UTXO so the dust output is fundable.
- **reinscription (multiple inscriptions on one sat)** → one shared output.
- **rune-only UTXO** → a 546 taproot output created purely as an edict target (sat position irrelevant for runes).
- **co-located rune + inscription** → one output receives both (inscription by sat, rune by edict).

### 7.7 Fee handling
Fee is the unassigned tail; it reduces the final segwit change. If the selection's plain sats cannot cover dust + fee, pull additional **plain fee UTXOs** (largest-first), appended at the end of the input list. Reuse the existing `planSort` fee-selection logic, adapted to the ledger's output count.

## 8. Recommendation engine & UX

**Recommendation = "asset on the wrong address type"** (bidirectional — the missing direction is what hid the parent):

| UTXO state | Recommendation |
|---|---|
| inscription / rune on **segwit** | ⚠️ move → taproot |
| plain on **taproot** | ⚠️ move → segwit |
| asset already on taproot | ✅ no action |
| plain on segwit | ✅ no action |

**UX (`UtxoTable` + controls):**
- Row shows **source** (taproot/segwit), **asset chips** (inscription id / rune name), an **offset badge** ("inscription @ offset 4,126 — will be extracted") when offset > 0, and a **⚠ recommended** flag.
- **`Select all recommended`** / **`Deselect all recommended`** buttons — toggle exactly the flagged set, leaving manual picks alone.
- **Plan preview** before signing — render the exact sat-ledger output layout (`→ taproot: parent inscription (546) · → segwit: 4,126 + change · fee: 330`) so the user verifies routing **before** signing.
- **OrdHealthBanner** (testnet4) at top; scan/sort disabled while ord is wedged/unreachable.

**State (`sortStore`):** `labeledUtxos`, `recommended` set, `selected` set, computed `satLedgerPlan`, ord health. Select-all-recommended is a pure set operation over `recommended`.

## 9. Error handling — fail-closed on uncertainty

- **Ord health gate (testnet4):** scan/sort disabled while ord is wedged/unreachable; banner; no degraded path. Mainnet: surface ord errors with retry.
- **Labeling uncertainty:** ord can't authoritatively label → mark `unknown`, exclude from sort, never `plain`.
- **Sat-ledger guards:** sub-dust pre-pad/trailing → fold; insufficient funds for dust+fee → pull fee UTXO or error with exact shortfall; inscription lacking 546 postage to end-of-inputs → require padding UTXO.
- **Rune safety:** before building, validate every input rune balance is covered by an explicit edict; if a safe runestone cannot be constructed, **refuse to build** (never risk a cenotaph/burn).
- **Pre-broadcast:** the plan preview is the human gate; broadcast uses the existing provider fallback and surfaces the raw rejection reason.

## 10. Testing strategy

- **`planSatLedger` unit tests (crown jewel):** offset 0; mid-UTXO offset (the parent's 4126); multiple interleaved offset inscriptions; pre-pad < dust (fold); trailing < dust; inscription near end (padding UTXO); reinscription (shared sat); rune-only (edict target); co-located rune + inscription; multi-plain consolidation; fee-UTXO selection + exact-fee boundary. Assert output layout, sat ranges, edicts, and fee.
- **Runestone encoder tests:** edict encoding + decode round-trip + no-cenotaph validation.
- **ord client tests:** `/output` → label mapping; **satpoint → offset** parsing, explicitly mocking the local-ord 0.27.1 quirk (`output` absent → use `satpoint`).
- **Recommendation tests:** each of the 4 placement states → correct flag.
- **Integration / acceptance:** the **parent rescue on testnet4** — build → sign → broadcast → verify via ord that `7c16f5d1…i0` lands on the new taproot output. This is the acceptance test for the redesign.

## 11. Module change summary

| Module | Change |
|---|---|
| `lib/api/mempool.ts` | ✅ done — multi-provider Esplora fallback (emzy → memepool → mempool.space). |
| `lib/api/ord.ts` | Per-network base (env); add `getInscription` (satpoint→offset); keep `/output` label mapping. |
| `lib/api/ordHealth.ts` | **New** — port runes-etch health probe (healthy/lagging/wedged/unreachable). |
| `lib/scanner/label.ts` | Rewrite to ord-only (both networks); emit `assets[]` with offsets; fail-closed `unknown`. |
| `lib/scanner/inscription.ts`, `runestone.ts` (decoders) | **Delete** (tx-decode path) — but add a runestone **encoder** for the builder. |
| `lib/tx/satLedger.ts` | **New** — pure `planSatLedger()`. |
| `lib/tx/sort.ts` | Rework `buildPsbt()` to consume the ledger; keep fee-selection logic. |
| `lib/runes/runestone.ts` | **New** — runestone **encoder** + cenotaph-safety validation. |
| `components/UtxoTable.tsx` | Asset chips, offset badge, recommended flag, plan preview. |
| `components/` (controls) | Select all / Deselect all recommended; OrdHealthBanner. |
| `store/sortStore.ts` | `labeledUtxos`, `recommended`, `selected`, `satLedgerPlan`, ord health. |
| `next.config.ts` | ✅ done — CSP `connect-src` includes emzy + memepool; add testnet4 ord base if env-driven. |

## 12. Acceptance criteria

1. On testnet4 with local ord healthy, the parent UTXO `420acce8…:3` is labeled **inscription on segwit → recommend move to taproot** (not plain). **✅ VERIFIED 2026-06-02 (Plan 1, live):** after the ord-only scanner shipped, the tool detected the inscription, auto-selected it as misplaced, and built a sort tx for it (proving detection). That build also exposed that the *old* (non-sat-aware) builder routed the offset-4126 inscription into the segwit change output — caught at the wallet-sign preview before signing. An interim **offset guard** (`planSort` blocks offset>0 inscriptions, commit `0f7e73d`) now disables that path until Plan 2's sat-ledger builder ships.
2. `planSatLedger` produces the §7.5 layout for that UTXO; unit tests for all §7.6 edge cases pass.
3. A signed, broadcast sort tx places `7c16f5d1…i0` on a **taproot** output (verified via ord `/output/<new>:N`), with the remaining plain returned to segwit. **✅ VERIFIED 2026-06-02 (Plan 2, live):** sort tx `8c5fd50ce71a451d633cd14be1ce3c1f04fa43884881cabd0013e7833f312204` — vout0 4,126 segwit (plain), vout1 546 **taproot** holding `7c16f5d1…i0` (ord `/output/…:1` + `/inscription` satpoint `8c5fd50c…:1:0`, address `tb1p58h0wl…`), vout2 8,805 segwit change. The offset-4126 inscription is extracted to offset 0 of a clean taproot output. **The parent rescue — the goal of the whole redesign — is complete.**
4. Rune-bearing UTXOs are moved with a valid runestone (no cenotaph) or safely blocked if a valid runestone can't be built.
5. tsc clean; full test suite green.

## 13. Out of scope / future

- Local-Esplora (electrs) data source for full offline operation.
- RBF/CPFP fee bumping.
- Batch operations across wallets.
