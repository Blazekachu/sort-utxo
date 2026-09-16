# UTXO Composer — Design

- **Date:** 2026-09-16
- **Status:** Ready for user review — implementation starts only after this spec is approved
- **Scope:** New `/compose` page in `F:\Users\akhil\Main\sort-utxo`
- **Isolation:** Sort (`/`) and Consolidate (`/consolidate`) stay as they are. Compose does not call their planners (`planSatLedger`, `planLedgerSort`, `planSort`, `planConsolidation`) and does not change their UI behavior.

---

## 1. Motivation

Sort extracts misplaced inscriptions onto 546-sat taproot outputs. It does not let you choose cuts, postage, fee source, or output layout. The need is a **blank, sat-aware composer**: inspect every wallet UTXO (sat ranges, address kind, outpoint, Plain / Inscription / Rune, rarity tags), pick inputs, then define outputs by value and destination, with a live FIFO preview.

First real job: split a mixed UTXO (e.g. ~62k sats with several rarity ranges) so chosen sats land at **offset 0** of new outputs with **330** (`1+329`) or **546** (`1+545`) postage, fee paid only from a **payment** UTXO.

---

## 2. Goals / Non-goals

**Goals (v1):**
- Scan all wallet UTXOs with every sat range, even when many ranges sit in one UTXO.
- Label each UTXO Plain / Inscription-bearing / Rune-bearing / unknown, with inscription offsets and rarity tags on ranges.
- Blank composer: user picks every input and every output row.
- Fee and end-of-line postage padding from **payment UTXOs only**, appended last (native P2WPKH or nested P2SH-P2WPKH).
- Live sat-line preview before sign.
- Optional 0-value OP_RETURN message (≤ 80 bytes, standard).
- Optional vanity TXID grind (nLockTime, sequences final), copied from runes-etch — not imported across repos.
- Signet + mainnet. Chain from wallet `network.bitcoin.name`, not from `tb1` prefix.
- Self-custodial: keys never leave the client. Xverse popup shows every input and output. Default SIGHASH_ALL. Compose signs with `broadcast: false`, verifies, then broadcasts itself.

**Non-goals (v1):**
- Do not change Sort or Consolidate flows, tests, or planners.
- Do not spend rune-bearing UTXOs (no runestone / edicts). They remain visible in the picker.
- Do not emit 1-sat or other sub-dust outputs. Sequential-sat peeling into N UTXOs with each sat at offset 0 is **v2** (policy dust is not consensus; collections sometimes use miner-submit / pointers). v2 may cap N by standard tx weight and optionally allow nonstandard mode.
- Do not auto-slice by rarity. Rarity is a label; cuts are manual.
- Do not put payment inputs in the middle of the sat line (no custom fee-input order).
- Do not use testnet4. Compose never selects Sort’s testnet4 Esplora list.
- No CPFP/RBF management, no multisig, no offline Esplora.

---

## 3. Isolation and module map

New code lives under compose-specific paths. Shared files may gain **additive** fields only.

| Path | Role |
|---|---|
| `src/app/compose/page.tsx` | Composer page |
| `src/store/composeStore.ts` | Compose state only |
| `src/components/compose/*` | Picker, output rows, preview, OP_RETURN, vanity, sign |
| `src/lib/compose/network.ts` | `mainnet` \| `signet` from wallet network name |
| `src/lib/compose/mempool.ts` | Signet/mainnet Esplora; **does not** call `src/lib/api/mempool.ts` `setMempoolNetwork` |
| `src/lib/compose/ord.ts` | Compose ord client (sat_ranges, health, inscriptions) |
| `src/lib/compose/scan.ts` | Scan + label for compose only |
| `src/lib/compose/rarity.ts` | Local ordinals rarity from sat numbers |
| `src/lib/compose/dust.ts` | Policy dust by script type |
| `src/lib/compose/plan.ts` | Pure FIFO planner + gates |
| `src/lib/compose/psbt.ts` | PSBT assembler (taproot / native / nested) |
| `src/lib/compose/opreturn.ts` | OP_RETURN encode + 80-byte gate |
| `src/lib/compose/vanity/*` | Web Worker locktime grind (copy runes-etch pattern) |

**Allowed shared edits (additive, Sort-compatible):**
- `src/lib/wallet/xverse.ts`: optional `paymentPublicKey` and `network` on `WalletState`, filled from existing `wallet_connect`. Same purposes: Ordinals + Payment. `signPsbt` used by Sort stays `broadcast: true`. New `signPsbtForCompose` with `broadcast: false`.
- `src/types/index.ts`: optional compose fields on shared types **or** compose-local types that do not strip existing `LabeledUtxo` fields. Prefer **compose-local types** so Sort’s scanner is untouched.
- `src/app/page.tsx`: one nav link to `/compose`, same pattern as Consolidate. No scan/sort logic change.
- `next.config.ts`: add CSP `connect-src` origins Compose needs (e.g. `https://blockstream.info`, local signet ord if not already `http://127.0.0.1:8080`). Do not remove existing origins.

**Forbidden:** edits to `src/lib/tx/satLedger.ts`, `ledgerSort.ts`, `sort.ts`, `consolidate.ts`, Sort `UtxoTable` / `useSortPlan` / `sortStore` behavior, Consolidate UI.

`bitcoinjs-lib` stays exact **7.0.1**.

---

## 4. Networks and data sources

`tb1` is shared by signet and legacy testnet4. Compose **must not** infer chain from address prefix.

| Wallet `network.bitcoin.name` | Chain | Esplora | ord |
|---|---|---|---|
| `Signet` (and legacy `Testnet4` / `Testnet` if a wallet still reports them) | signet | emzy → memepool → mempool.space → blockstream, all `/signet/api` | local, env `NEXT_PUBLIC_ORD_BASE_SIGNET` (fallback `NEXT_PUBLIC_ORD_BASE_TESTNET`, then `http://127.0.0.1:8080`) |
| `Mainnet` | mainnet | existing mainnet mirrors | `NEXT_PUBLIC_ORD_BASE_MAINNET` or `https://ordinals.com` |
| `Regtest` | out of v1 | — | — |

bitcoinjs network for signet is `bitcoin.networks.testnet` (same as runes-etch).

**Ord policy:** signet local ord is **mandatory** and health-gated (`/status`: unreachable / wedged → scan disabled). Mainnet: public ord; per-UTXO failure → `unknown`, never silent Plain.

**UTXO enumeration:** Esplora `/address/:a/utxo` for taproot and payment. Unconfirmed UTXOs are listed but **not selectable**.

---

## 5. Inventory model

Compose scan does **not** go through `scanAndLabelUtxos` in `src/lib/scanner/label.ts` (that path stays Sort/Consolidate). Compose calls ord `/output/<txid>:<vout>` itself and maps:

```ts
type ComposeUtxoKind = 'plain' | 'inscription' | 'rune' | 'unknown';

type AddressKind = 'taproot' | 'p2wpkh' | 'p2sh-p2wpkh';

interface SatRangeView {
  start: bigint;          // inclusive sat number
  endExclusive: bigint;   // ord-style [start, end)
  offset: number;         // sats from start of this UTXO
  length: number;
  rarityTags: RarityTag[]; // ordinals rarity on the range start and any special sat inside
}

interface ComposeUtxo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  address: string;
  addressKind: AddressKind;
  source: 'taproot' | 'payment';
  kind: ComposeUtxoKind;  // rune if any rune present (even with inscriptions)
  assets: Asset[];        // existing Asset union: inscription {id, offset} | rune {name, amount, divisibility}
  satRanges: SatRangeView[] | null; // null => missing from ord; cannot compose
}
```

**Kind rules:**
- ord error → `unknown` (not Plain).
- any rune in `/output.runes` → `rune` (inscriptions still listed in `assets`).
- else any inscription → `inscription`.
- else → `plain`.

**Rarity:** compute locally from sat number (mythic / legendary / epic / rare / uncommon / common). Do **not** call `/sat` per range (too slow). Tag the range start and any first-sat-of-block (etc.) that falls inside `[start, end)`. Palindrome/alpha names are not v1.

**Picker display:** `txid:vout`, address kind, source, kind chips, value, every sat range with offsets and rarity tags, inscription ids + offsets.

---

## 6. Composer rules

### 6.1 Inputs (order = sat line)

Two groups; a UTXO cannot be in both.

**Spend inputs** (first on the sat line), user order, visible reorder: any confirmed UTXO with sat ranges that is not `rune` or `unknown`. This includes rare/inscription UTXOs on the **payment** address — those are spend inputs, not the fee slot.

**Fee/padding inputs** (always last): additional UTXOs with `source === 'payment'` and `kind === 'plain'` only. Native (`bc1q` / `tb1q`) and nested (`3…` / `2…`) are both allowed. Taproot cannot occupy this slot.

Cannot add to either group: `rune`, `unknown`, `satRanges === null`, unconfirmed.

Inscription-bearing **can** be a spend input; preview must show each inscription’s absolute offset on the concatenated line.

FIFO constraint (show in UI copy): you cannot insert payment sats between sat *N* and *N+1* of the same input. A 330 output starting at offset 6000 of a 62k UTXO is sats 6000–6329 of **that** UTXO. Payment padding only works when the target sat is at or near the **end** of the asset inputs; then payment UTXOs appended last continue the line.

### 6.2 Output rows (source of truth)

Each row: `value` (presets 330 and 546, or custom) + `address` (wallet taproot, wallet payment, or paste, same chain).

Outputs fill from the concatenated input sat line in order. Planner maps each output to:
- sat ranges that land there
- inscriptions with **output-local offset** (0 means the inscription sat is first)
- rarity tags
- `startsWithTaggedSat: boolean` — true when the first sat of that output is an inscription sat or has a non-common rarity tag (this is the “offset 0” check in the preview)

**Fee** = `sum(inputs) - sum(sat outputs)`. There is no fee row. OP_RETURN is 0-value and is not in that sum. `estimatedVBytes` **includes** the OP_RETURN output when present. Chosen fee rate only tells the user how large the unassigned tail must be: `feeSats = ceil(estimatedVBytes * feeRate)`.

### 6.3 OP_RETURN (optional, off by default)

- At most one.
- Value **0**.
- UTF-8 payload, **≤ 80 bytes** (Bitcoin Core standard datacarrier). Empty string → omit the output.
- Does not consume sats; FIFO unchanged wherever it sits in vout order.
- Pinned **after all sat outputs** (last vout) so it is not mistaken for a slice.
- Not a runestone. Changing the message clears a vanity nonce.

### 6.4 Gates (refuse to build)

| Condition | Action |
|---|---|
| Any selected input `kind === 'rune'` | refuse |
| Any selected input missing sat ranges / unknown | refuse |
| Output below policy dust for its script (P2TR **330**, P2WPKH **294**, P2SH-P2WPKH **546**) | refuse |
| Sat output would consume past the end of **spend** inputs | refuse until a **fee/padding** payment UTXO is appended; then those payment sats appear on the line and must be assigned to postage/change rows |
| `sum(sat outputs) > sum(inputs)` | refuse |
| Unassigned tail `<` required fee at selected rate | refuse |
| Required fee `> 0` and no payment input | refuse |
| Estimated vbytes `> 100_000` (standard tx weight 400,000) | refuse |
| OP_RETURN payload `> 80` bytes or more than one OP_RETURN | refuse |
| Nested payment input without payment pubkey | refuse (do not widen wallet connect) |
| 10 000×1-sat (or any all-sub-dust) plan | refuse (v2) |

v1 does **not** auto-select a payment UTXO. The user must pick it.

---

## 7. PSBT, wallet, vanity

### 7.1 Wallet connection (do not weaken)

- Same `wallet_connect` request: purposes **Ordinals** and **Payment** only.
- No extra RPCs, no message signing, no new purposes.
- Optional fields from the same result: payment address pubkey, `network.bitcoin.name`.
- If nested-segwit redeem data is required and payment pubkey is absent: **refuse to build**, do not prompt a different connect.

### 7.2 PSBT shape

Every input has `witnessUtxo`. Taproot inputs have `tapInternalKey`. Nested P2SH-P2WPKH inputs have `redeemScript` derived from the payment pubkey (same construction as runes-etch `buildFundingPsbtInput`; copy, do not import). All sat outputs and the OP_RETURN are in the PSBT **before** sign. `signInputs` lists **every** wallet-owned input index. Sighash **ALL** only (no NONE/SINGLE/ANYONECANPAY).

Xverse’s popup therefore lists every input and every output, including 0-sat OP_RETURN.

### 7.3 Sign and broadcast

Compose calls `signPsbtForCompose` (`broadcast: false`). After the popup:
1. Finalize/extract the signed tx.
2. Assert txid matches the pre-sign txid (segwit/taproot: witness is not in txid).
3. If vanity was locked, assert txid matches the grind target; **mismatch → do not broadcast**.
4. Assert extracted output values/scripts match the plan.
5. Broadcast hex via **Compose** Esplora. Never Sort’s testnet4 list.

### 7.4 Vanity (optional)

- Vary **nLockTime** only; every input `nSequence = 0xffffffff` (locktime not enforced; still hashed into txid).
- Prefix and/or suffix, max **6 hex** characters.
- Web Worker; UI stays usable; Stop supported.
- Freeze inputs, output rows, fee rate, and OP_RETURN when a match is found. Any edit clears the nonce.
- After sign, refuse broadcast on target mismatch.
- `bitcoinjs-lib` **7.0.1** (vanity serialization must stay family-compatible).

---

## 8. UX

Route `/compose`. Header: title, Signet/Mainnet badge from **wallet network**, links back to Sort and to Consolidate.

1. Connect (WalletBar pattern; Compose store).
2. Scan (progress + ord health banner on signet).
3. Input table: checkboxes with gates above; fee/payment slot separate and payment-only.
4. Output editor: add/remove rows, 330/546/custom, destination.
5. Fee rate selector (Compose mempool fees).
6. Optional OP_RETURN text field with live byte count.
7. Optional vanity prefix/suffix + grind/stop + difficulty estimate.
8. Sat-line preview: outputs in order, ranges, inscriptions, rarity, offset-0 flag, fee tail, OP_RETURN note.
9. Build disabled while any gate fails (message names the gate).
10. Sign → Xverse popup → verify → broadcast → txid link on signet (or mainnet) explorer.

Connect may reuse the existing Leather helper, but the I/O-visible sign requirement is specified for **Xverse**. If Leather is used and cannot show full outputs, Compose still builds the same complete PSBT; we do not add Leather-specific sign flags.

---

## 9. Error handling

Fail closed. No degraded “treat as Plain.” No silent payment-input reorder. No wallet broadcast of an unverified signed tx.

Surfaces: ord unreachable/wedged; Esplora failover exhausted; nested pubkey missing; vanity mismatch; user rejected sign; broadcast rejection text from Esplora.

---

## 10. Testing

Vitest, compose modules only, plus a check that Sort/Consolidate tests still pass unchanged.

**Planner:** offset-0 extract; mid-UTXO sat (6000) postage from following sats of the **same** UTXO, not from payment; near-end sat blocked without payment UTXO last, then payment sats on the line; OP_RETURN 0-value does not shift inscription offsets; fee = unassigned tail.

**Gates:** rune refuse; missing ranges refuse; dust by script; no payment when fee needed; tail < fee; vbytes cap; 1-sat rows refuse; OP_RETURN 81 bytes refuse.

**PSBT:** taproot key; native witness UTXO; nested redeem; every input in `signInputs`; OP_RETURN present; no non-ALL sighash.

**Network:** `Signet` → signet providers; `Mainnet` → mainnet; `tb1` prefix does not select testnet4; Compose does not call Sort `setMempoolNetwork`.

**Rarity:** uncommon first-of-block inside a longer range is tagged.

**Vanity:** sequences remain final; editing an output clears nonce.

**Live signet acceptance (local ord running):**
1. Scan a mixed UTXO: all ranges, kinds, rarity, outpoint, address kind.
2. Split so a chosen sat is offset 0 on a 330 or 546 taproot output; fee from payment last (native or nested).
3. Near-end sat: build blocked until payment UTXO added; preview shows payment sats.
4. Rune UTXO not selectable for spend.
5. OP_RETURN visible in Xverse popup as 0-sat; inscription offsets unchanged.
6. Vanity: signed txid matches; mismatch not broadcast.
7. Xverse popup lists every input and output.

Prove on **signet** (not testnet4) before claiming done.

---

## 11. Future (not this spec)

- Sequential-sat splitter: N outputs with consecutive sats at offset 0, capped by standard weight; optional nonstandard/miner-submit for sub-dust (policy, not consensus).
- Runestone edicts so rune UTXOs can be spent safely.
- Auto rarity-template that pre-fills output rows (still editable).
- Palindrome / named-sat tags.
- Custom input order (payment in the middle) — rejected for v1 because it can shove rare sats off offset 0.

---

## 12. Acceptance checklist

- [ ] `/compose` works on signet with local ord; Sort and Consolidate still behave as today.
- [ ] Inventory shows all sat ranges and kinds; unknown never shown as Plain.
- [ ] Blank output rows + FIFO preview; 330/546 presets; payment-fee last and gated.
- [ ] Rune inputs cannot be built.
- [ ] Optional OP_RETURN and vanity as specified; Xverse shows full I/O; keys stay client-side.
- [ ] Unit tests for planner, gates, PSBT, network; existing Sort/Consolidate tests green.
- [ ] Live signet acceptance items in §10.
