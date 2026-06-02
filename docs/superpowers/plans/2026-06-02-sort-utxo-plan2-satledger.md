# Sort UTXO Redesign — Plan 2: Sat-Ledger Builder (inscriptions + plain)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, sat-aware transaction builder that extracts an inscription at *any* offset onto its own 546 taproot output while returning plain sats to segwit — the fix that rescues the stranded parent.

**Architecture:** A pure `planSatLedger()` concatenates the ordered inputs into one sat line and emits outputs in **sat order** (segwit pre-pad → 546 taproot at each inscription sat → segwit change; fee = unassigned tail). `buildSortPsbtFromLedger()` assembles a PSBT from that layout. A `planLedgerSort()` wrapper selects fee UTXOs and orders inputs. The interim offset guard is removed; rune-bearing UTXOs are blocked (deferred to Plan 2b).

**Tech Stack:** TypeScript, bitcoinjs-lib 7.0.1 (pinned), Vitest.

**Plan 2 of the 3-plan redesign** (spec: `docs/superpowers/specs/2026-06-02-sort-utxo-redesign-design.md` §7). Plan 1 (detection) is DONE on `master` (commits `86f6a91`..`0f7e73d`): `LabeledUtxo.assets: Asset[]` where `Asset = {kind:'inscription',id,offset} | {kind:'rune',name,amount:bigint,divisibility}`; `planSort` has an interim offset guard.

**Deferred to Plan 2b:** runestone *encoder* (resolve RuneId via ord `/rune/<name>`, LEB128 delta-sorted edicts, cenotaph-safety) + rune-move integration. Plan 2 **blocks** selected rune UTXOs so they're never mis-routed.

**Key existing code** (`src/lib/tx/sort.ts`): `DUST_LIMIT = 546n`; fee constants `TX_OVERHEAD_VB 10.5 / P2TR_INPUT_VB 57.5 / P2WPKH_INPUT_VB 68 / OUTPUT_VB 43`; `estimateVBytes(taprootInputs, segwitInputs, outputs)` (currently un-exported); `planSort` / `buildSortPsbt` / `computeDustOutputs`.

---

## Task 1: `planSatLedger` core — single inscription, offset extraction

**Files:**
- Modify: `src/lib/tx/sort.ts` (export `estimateVBytes`)
- Create: `src/lib/tx/satLedger.ts`
- Test: `src/lib/tx/__tests__/satLedger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tx/__tests__/satLedger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planSatLedger, type LedgerInput } from '../satLedger';

const TAPROOT = 'tb1ptaproot';
const SEGWIT = 'tb1qsegwit';

function input(partial: Partial<LedgerInput> & Pick<LedgerInput, 'value' | 'source'>): LedgerInput {
  return { txid: 'a'.repeat(64), vout: 0, inscriptionOffsets: [], ...partial };
}

describe('planSatLedger — single inscription', () => {
  it('extracts the parent: pre-pad segwit, 546 taproot at the inscription sat, segwit change', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 13685, source: 'payment', inscriptionOffsets: [4126] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs).toEqual([
      { address: SEGWIT, value: 4126, kind: 'prepad' },
      { address: TAPROOT, value: 546, kind: 'inscription' },
      { address: SEGWIT, value: 13685 - 4126 - 546 - plan.fee, kind: 'change' },
    ]);
    expect(plan.assetOutputIndices).toEqual([1]);
    // conservation: inputs - outputs === fee
    const out = plan.outputs.reduce((s, o) => s + o.value, 0);
    expect(13685 - out).toBe(plan.fee);
  });

  it('offset 0 needs no pre-pad: 546 taproot then segwit change', () => {
    const plan = planSatLedger({
      inputs: [
        input({ value: 546, source: 'payment', inscriptionOffsets: [0] }),
        input({ value: 50000, source: 'payment', txid: 'b'.repeat(64) }),
      ],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs[0]).toEqual({ address: TAPROOT, value: 546, kind: 'inscription' });
    expect(plan.outputs[1].kind).toBe('change');
    expect(plan.assetOutputIndices).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Users/akhil/Main/sort-utxo && npx vitest run src/lib/tx/__tests__/satLedger.test.ts`
Expected: FAIL — module `../satLedger` not found.

- [ ] **Step 3a: Export `estimateVBytes` from `sort.ts`**

In `src/lib/tx/sort.ts`, change the declaration so the ledger can reuse it (keep the body identical):

```ts
export function estimateVBytes(taprootInputs: number, segwitInputs: number, outputs: number): number {
```

- [ ] **Step 3b: Create `src/lib/tx/satLedger.ts`**

```ts
import { estimateVBytes } from './sort';

const DUST = 546;

export interface LedgerInput {
  txid: string;
  vout: number;
  value: number;
  source: 'taproot' | 'payment';
  /** sat offsets of inscriptions within THIS utxo (need not be sorted). [] if none. */
  inscriptionOffsets: number[];
}

export type LedgerOutputKind = 'prepad' | 'inscription' | 'change';

export interface LedgerOutput {
  address: string;
  value: number;
  kind: LedgerOutputKind;
}

export interface SatLedgerPlan {
  ok: boolean;
  error?: string;
  outputs: LedgerOutput[];
  fee: number;
  estimatedVBytes: number;
  /** indices into `outputs` carrying an inscription (taproot) — rune-edict targets in Plan 2b. */
  assetOutputIndices: number[];
}

/**
 * Plan a sort transaction's outputs by walking the concatenated input sat line.
 * Inputs MUST already be ordered (caller's responsibility): typically
 * [asset UTXOs, plain UTXOs, fee UTXOs]. Outputs are emitted in sat order so
 * each inscription's sat lands on its own 546 taproot output; plain sats (pre-pad
 * + leftover) return to segwit; the fee is the unassigned tail.
 */
export function planSatLedger(params: {
  inputs: LedgerInput[];
  taprootAddress: string;
  paymentAddress: string;
  feeRate: number;
}): SatLedgerPlan {
  const { inputs, taprootAddress, paymentAddress, feeRate } = params;

  const fail = (error: string): SatLedgerPlan =>
    ({ ok: false, error, outputs: [], fee: 0, estimatedVBytes: 0, assetOutputIndices: [] });

  if (inputs.length === 0) return fail('No inputs.');

  // 1. Absolute inscription positions across the concatenated input sat line.
  const positions: number[] = [];
  let start = 0;
  for (const inp of inputs) {
    for (const offset of inp.inscriptionOffsets) positions.push(start + offset);
    start += inp.value;
  }
  const totalIn = start;
  const sortedPositions = [...new Set(positions)].sort((a, b) => a - b);

  // 2. Walk the sat line, emitting outputs in sat order.
  const outputs: LedgerOutput[] = [];
  const assetOutputIndices: number[] = [];
  let cursor = 0;
  for (const p of sortedPositions) {
    if (p < cursor) return fail('Overlapping inscription postage — cannot isolate cleanly.');
    const gap = p - cursor;
    let dustStart = p;
    if (gap >= DUST) {
      outputs.push({ address: paymentAddress, value: gap, kind: 'prepad' });
      cursor = p;
    } else if (gap > 0) {
      // Sub-dust pre-pad: fold it into the inscription output (a few plain sats
      // ride to taproot rather than emit an invalid <546 output).
      dustStart = cursor;
    }
    outputs.push({ address: taprootAddress, value: (p + DUST) - dustStart, kind: 'inscription' });
    assetOutputIndices.push(outputs.length - 1);
    cursor = p + DUST;
  }

  if (cursor > totalIn) {
    return fail('Inscription lacks 546 sats of postage to end-of-inputs. Add a funding/padding UTXO.');
  }

  // 3. Fee (sized assuming one change output) + final change.
  const taprootInputs = inputs.filter((u) => u.source === 'taproot').length;
  const segwitInputs = inputs.length - taprootInputs;
  const estimatedVBytes = estimateVBytes(taprootInputs, segwitInputs, outputs.length + 1);
  const fee = Math.ceil(estimatedVBytes * feeRate);
  const finalChange = totalIn - cursor - fee;

  if (finalChange < 0) return fail(`Not enough sats to cover postage + fee. Need ~${-finalChange} more sats.`);
  if (finalChange >= DUST) {
    outputs.push({ address: paymentAddress, value: finalChange, kind: 'change' });
  } else if (finalChange > 0) {
    if (assetOutputIndices.length === 0) return fail('Sub-dust change with no asset output to fold into.');
    outputs[assetOutputIndices[assetOutputIndices.length - 1]].value += finalChange;
  }
  // finalChange === 0: exact, no change output.

  return { ok: true, outputs, fee, estimatedVBytes, assetOutputIndices };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tx/__tests__/satLedger.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tx/sort.ts src/lib/tx/satLedger.ts src/lib/tx/__tests__/satLedger.test.ts
git commit -m "feat(satLedger): sat-aware output planner — offset inscription extraction"
```

---

## Task 2: `planSatLedger` edge cases — folds, postage, overlap

**Files:**
- Test: `src/lib/tx/__tests__/satLedger.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/tx/__tests__/satLedger.test.ts`:

```ts
describe('planSatLedger — edge cases', () => {
  it('folds a sub-dust pre-pad into the inscription output (offset 300)', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 50000, source: 'payment', inscriptionOffsets: [300] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    // No standalone pre-pad output; the inscription output starts at sat 0 and
    // is 300 + 546 = 846 sats.
    expect(plan.outputs[0]).toEqual({ address: TAPROOT, value: 846, kind: 'inscription' });
    expect(plan.outputs.every((o) => o.kind !== 'prepad')).toBe(true);
  });

  it('folds sub-dust leftover change into the last inscription output', () => {
    // Choose totals so the final change lands in (0, 546).
    const plan = planSatLedger({
      inputs: [input({ value: 1300, source: 'payment', inscriptionOffsets: [0] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs).toHaveLength(1); // dust only, leftover folded in
    expect(plan.outputs[0].kind).toBe('inscription');
    // inputs - outputs === fee, output value >= 546
    expect(plan.outputs[0].value).toBeGreaterThanOrEqual(546);
    expect(1300 - plan.outputs[0].value).toBe(plan.fee);
  });

  it('deduplicates two inscriptions on the same sat (reinscription) to one output', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 50000, source: 'payment', inscriptionOffsets: [0, 0] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.assetOutputIndices).toHaveLength(1);
  });

  it('fails when the inscription lacks 546 sats of postage to end-of-inputs', () => {
    // Inscription at offset 13684 of a 13685-sat UTXO: only 1 sat after it.
    const plan = planSatLedger({
      inputs: [input({ value: 13685, source: 'payment', inscriptionOffsets: [13684] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/postage/i);
  });

  it('fails when funds cannot cover postage + fee', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 600, source: 'payment', inscriptionOffsets: [0] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 50,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/cover postage/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/tx/__tests__/satLedger.test.ts -t "edge cases"`
Expected: most pass already (the core handles them), but confirm RED→GREEN: if any fail, the implementation is wrong — fix `satLedger.ts`, do not change the test to match a bug.

- [ ] **Step 3: Verify behavior / fix only if a test fails**

The Task 1 implementation already covers these. If the "sub-dust leftover" test fails because `finalChange` lands outside (0,546) for `value:1300`, recompute: `estimateVBytes(0,1,2)=ceil(10.5+68+86)=165` (with change) → fee 165; `finalChange = 1300 - 546 - 165 = 589` ≥ 546 → it would emit a change output, not fold. Adjust the test input to force the fold: change `value: 1300` to **`value: 800`** (`finalChange = 800 - 546 - ceil((10.5+68+86))=800-546-165 = 89`, in (0,546) → folds). Update the test value and re-run.

- [ ] **Step 4: Run to verify all pass**

Run: `npx vitest run src/lib/tx/__tests__/satLedger.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tx/__tests__/satLedger.test.ts
git commit -m "test(satLedger): cover pre-pad/trailing folds, reinscription, postage limits"
```

---

## Task 3: `planSatLedger` — multi-input, plain consolidation, interleaved inscriptions

**Files:**
- Test: `src/lib/tx/__tests__/satLedger.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
describe('planSatLedger — multi-input', () => {
  it('consolidates multiple plain inputs into one segwit change', () => {
    const plan = planSatLedger({
      inputs: [
        input({ value: 20000, source: 'taproot', inscriptionOffsets: [0] }),
        input({ value: 30000, source: 'payment', txid: 'b'.repeat(64) }),
        input({ value: 10000, source: 'payment', txid: 'c'.repeat(64) }),
      ],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    // one inscription dust + one consolidated change
    expect(plan.outputs.filter((o) => o.kind === 'inscription')).toHaveLength(1);
    expect(plan.outputs.filter((o) => o.kind === 'change')).toHaveLength(1);
  });

  it('handles two inscriptions in different inputs, interleaving pre-pad + dust', () => {
    const plan = planSatLedger({
      inputs: [
        input({ value: 10000, source: 'payment', inscriptionOffsets: [5000] }),
        input({ value: 10000, source: 'payment', txid: 'b'.repeat(64), inscriptionOffsets: [2000] }),
      ],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    // positions: 5000 (input0) and 10000+2000=12000 (input1) → two dust outputs
    expect(plan.assetOutputIndices).toHaveLength(2);
    plan.assetOutputIndices.forEach((i) => {
      expect(plan.outputs[i].address).toBe(TAPROOT);
      expect(plan.outputs[i].kind).toBe('inscription');
    });
  });
});
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run src/lib/tx/__tests__/satLedger.test.ts -t "multi-input"`
Expected: PASS (the Task 1 implementation already handles these). If RED, fix `satLedger.ts`.

- [ ] **Step 3: (only if a test failed) fix `satLedger.ts`** — no change expected; the walk is input-count-agnostic.

- [ ] **Step 4: Full ledger suite**

Run: `npx vitest run src/lib/tx/__tests__/satLedger.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tx/__tests__/satLedger.test.ts
git commit -m "test(satLedger): multi-input plain consolidation + interleaved inscriptions"
```

---

## Task 4: `buildSortPsbtFromLedger` — assemble the PSBT

**Files:**
- Modify: `src/lib/tx/satLedger.ts` (add the PSBT assembler)
- Test: `src/lib/tx/__tests__/buildLedgerPsbt.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/tx/__tests__/buildLedgerPsbt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { buildSortPsbtFromLedger, type LedgerInput, type LedgerOutput } from '../satLedger';

// BIP86/BIP84 mainnet test vectors (valid addresses for output scripts).
const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

it('assembles inputs (tapInternalKey for taproot) and outputs from the ledger', () => {
  const inputs: LedgerInput[] = [
    { txid: 'a'.repeat(64), vout: 3, value: 13685, source: 'payment', inscriptionOffsets: [4126] },
  ];
  const outputs: LedgerOutput[] = [
    { address: SEGWIT, value: 4126, kind: 'prepad' },
    { address: TAPROOT, value: 546, kind: 'inscription' },
    { address: SEGWIT, value: 8800, kind: 'change' },
  ];
  const { psbt, inputsToSign } = buildSortPsbtFromLedger({
    inputs, outputs, internalPubkey: new Uint8Array(32).fill(2), network: bitcoin.networks.bitcoin,
    taprootAddress: TAPROOT, paymentAddress: SEGWIT,
  });
  expect(psbt.txInputs).toHaveLength(1);
  expect(psbt.txOutputs.map((o) => o.value)).toEqual([4126n, 546n, 8800n]);
  expect(psbt.txOutputs[1].address).toBe(TAPROOT);
  expect(inputsToSign).toEqual([{ index: 0, address: SEGWIT }]);
});

it('throws if outputs exceed inputs (negative fee)', () => {
  const inputs: LedgerInput[] = [{ txid: 'a'.repeat(64), vout: 0, value: 500, source: 'payment', inscriptionOffsets: [] }];
  const outputs: LedgerOutput[] = [{ address: SEGWIT, value: 1000, kind: 'change' }];
  expect(() => buildSortPsbtFromLedger({
    inputs, outputs, internalPubkey: new Uint8Array(32).fill(2), network: bitcoin.networks.bitcoin,
    taprootAddress: TAPROOT, paymentAddress: SEGWIT,
  })).toThrow(/exceed/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/tx/__tests__/buildLedgerPsbt.test.ts`
Expected: FAIL — `buildSortPsbtFromLedger` not exported.

- [ ] **Step 3: Add the assembler to `src/lib/tx/satLedger.ts`**

First add these two imports at the **top** of the file (alongside the existing `import { estimateVBytes } from './sort';`):

```ts
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
```

Then **append** to the end of the file (the `initEccLib` call is a module-level statement, fine after the imports):

```ts
bitcoin.initEccLib(ecc);

/**
 * Assemble a PSBT from a sat-ledger layout. The `inputs` MUST be the SAME ordered
 * list passed to planSatLedger (sat positions depend on input order). Outputs are
 * added verbatim; the fee is implicit (sum(inputs) - sum(outputs)).
 */
export function buildSortPsbtFromLedger(params: {
  inputs: LedgerInput[];
  outputs: LedgerOutput[];
  taprootAddress: string;
  paymentAddress: string;
  internalPubkey: Uint8Array;
  network: bitcoin.Network;
}): { psbt: bitcoin.Psbt; inputsToSign: Array<{ index: number; address: string }> } {
  const { inputs, outputs, taprootAddress, paymentAddress, internalPubkey, network } = params;

  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0);
  if (totalOut > totalIn) throw new Error(`Outputs (${totalOut}) exceed inputs (${totalIn}).`);

  const psbt = new bitcoin.Psbt({ network });
  const inputsToSign: Array<{ index: number; address: string }> = [];

  for (let i = 0; i < inputs.length; i++) {
    const u = inputs[i];
    const address = u.source === 'taproot' ? taprootAddress : paymentAddress;
    const isTaproot = address.startsWith('bc1p') || address.startsWith('tb1p');
    const psbtInput: Record<string, unknown> = {
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: bitcoin.address.toOutputScript(address, network), value: BigInt(u.value) },
    };
    if (isTaproot) psbtInput.tapInternalKey = internalPubkey;
    psbt.addInput(psbtInput as unknown as Parameters<typeof psbt.addInput>[0]);
    inputsToSign.push({ index: i, address });
  }

  for (const o of outputs) {
    psbt.addOutput({ address: o.address, value: BigInt(o.value) });
  }

  return { psbt, inputsToSign };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/tx/__tests__/buildLedgerPsbt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tx/satLedger.ts src/lib/tx/__tests__/buildLedgerPsbt.test.ts
git commit -m "feat(satLedger): buildSortPsbtFromLedger PSBT assembler"
```

---

## Task 5: `planLedgerSort` — fee-UTXO selection, input ordering, rune guard

**Files:**
- Create: `src/lib/tx/ledgerSort.ts`
- Test: `src/lib/tx/__tests__/ledgerSort.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tx/__tests__/ledgerSort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planLedgerSort } from '../ledgerSort';
import type { LabeledUtxo } from '@/types';

const TAPROOT = 'tb1ptaproot';
const SEGWIT = 'tb1qsegwit';

function utxo(p: Partial<LabeledUtxo> & Pick<LabeledUtxo, 'label' | 'source' | 'value'>): LabeledUtxo {
  return { txid: 'a'.repeat(64), vout: 0, status: { confirmed: true }, assets: [], ...p };
}

describe('planLedgerSort', () => {
  it('plans the parent rescue and pulls a fee UTXO if needed', () => {
    const parent = utxo({
      label: 'inscription', source: 'payment', value: 13685, txid: 'd'.repeat(64), vout: 3,
      assets: [{ kind: 'inscription', id: '7c16f5d1'.repeat(8) + 'i0', offset: 4126 }],
    });
    const res = planLedgerSort({
      selectedUtxos: [parent], availableFeeUtxos: [], feeRate: 1,
      taprootAddress: TAPROOT, paymentAddress: SEGWIT,
    });
    expect(res.ok).toBe(true);
    expect(res.ledger.assetOutputIndices).toEqual([1]);
    expect(res.ledger.outputs[1]).toEqual({ address: TAPROOT, value: 546, kind: 'inscription' });
  });

  it('blocks selected rune UTXOs (deferred to Plan 2b)', () => {
    const rune = utxo({
      label: 'rune', source: 'payment', value: 546,
      assets: [{ kind: 'rune', name: 'DUMMY', amount: 1000n, divisibility: 0 }],
    });
    const res = planLedgerSort({
      selectedUtxos: [rune], availableFeeUtxos: [], feeRate: 1,
      taprootAddress: TAPROOT, paymentAddress: SEGWIT,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rune/i);
  });

  it('orders inputs [assets, plain, fee] and appends fee UTXOs last', () => {
    const insc = utxo({
      label: 'inscription', source: 'payment', value: 600, txid: 'd'.repeat(64),
      assets: [{ kind: 'inscription', id: 'a'.repeat(64) + 'i0', offset: 0 }],
    });
    const fee = utxo({ label: 'plain', source: 'payment', value: 50000, txid: 'e'.repeat(64) });
    const res = planLedgerSort({
      selectedUtxos: [insc], availableFeeUtxos: [fee], feeRate: 1,
      taprootAddress: TAPROOT, paymentAddress: SEGWIT,
    });
    expect(res.ok).toBe(true);
    expect(res.inputs[0].txid).toBe('d'.repeat(64)); // asset first
    expect(res.inputs[res.inputs.length - 1].txid).toBe('e'.repeat(64)); // fee last
    expect(res.feeUtxos).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/tx/__tests__/ledgerSort.test.ts`
Expected: FAIL — module `../ledgerSort` not found.

- [ ] **Step 3: Create `src/lib/tx/ledgerSort.ts`**

```ts
import type { LabeledUtxo } from '@/types';
import { planSatLedger, type LedgerInput, type SatLedgerPlan } from './satLedger';

export interface LedgerSortResult {
  ok: boolean;
  error?: string;
  /** Ordered inputs used (same order the ledger assumed). */
  inputs: LedgerInput[];
  /** Plain UTXOs pulled in purely to fund the fee. */
  feeUtxos: LabeledUtxo[];
  ledger: SatLedgerPlan;
}

function toLedgerInput(u: LabeledUtxo): LedgerInput {
  return {
    txid: u.txid, vout: u.vout, value: u.value, source: u.source,
    inscriptionOffsets: u.assets.filter((a) => a.kind === 'inscription').map((a) => (a as { offset: number }).offset),
  };
}

const EMPTY_LEDGER: SatLedgerPlan = { ok: false, outputs: [], fee: 0, estimatedVBytes: 0, assetOutputIndices: [] };

/**
 * Select fee UTXOs and order inputs for a sat-aware sort, then plan the ledger.
 * Inputs are ordered [asset UTXOs, plain selected, fee UTXOs]; fee UTXOs are
 * appended largest-first until the ledger is fundable. Rune-bearing selections
 * are blocked here (deferred to Plan 2b) so a rune is never mis-routed.
 */
export function planLedgerSort(params: {
  selectedUtxos: LabeledUtxo[];
  availableFeeUtxos: LabeledUtxo[];
  feeRate: number;
  taprootAddress: string;
  paymentAddress: string;
}): LedgerSortResult {
  const { selectedUtxos, availableFeeUtxos, feeRate, taprootAddress, paymentAddress } = params;

  const fail = (error: string): LedgerSortResult =>
    ({ ok: false, error, inputs: [], feeUtxos: [], ledger: EMPTY_LEDGER });

  if (selectedUtxos.length === 0) return fail('No UTXOs selected.');

  // Plan 2 scope: block runes (Plan 2b adds runestone edicts).
  const runeUtxo = selectedUtxos.find((u) => u.assets.some((a) => a.kind === 'rune'));
  if (runeUtxo) {
    return fail('Moving rune-bearing UTXOs is not supported yet (needs runestone edicts — Plan 2b). Deselect rune UTXOs.');
  }

  const assetUtxos = selectedUtxos.filter((u) => u.assets.length > 0);
  const plainSelected = selectedUtxos.filter((u) => u.assets.length === 0);
  const sortedFeeUtxos = [...availableFeeUtxos].sort((a, b) => b.value - a.value);

  const chosenFee: LabeledUtxo[] = [];
  for (let i = 0; ; i++) {
    const ordered = [...assetUtxos, ...plainSelected, ...chosenFee];
    const inputs = ordered.map(toLedgerInput);
    const ledger = planSatLedger({ inputs, taprootAddress, paymentAddress, feeRate });
    if (ledger.ok) {
      return { ok: true, inputs, feeUtxos: [...chosenFee], ledger };
    }
    const next = sortedFeeUtxos[i];
    if (!next) {
      return { ok: false, error: ledger.error ?? 'Cannot fund the sort.', inputs, feeUtxos: [...chosenFee], ledger };
    }
    chosenFee.push(next);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/tx/__tests__/ledgerSort.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tx/ledgerSort.ts src/lib/tx/__tests__/ledgerSort.test.ts
git commit -m "feat(ledgerSort): fee-UTXO selection + input ordering + rune guard"
```

---

## Task 6: Wire the UI to the ledger; remove the interim offset guard

**Files:**
- Modify: `src/components/useSortPlan.ts`
- Modify: `src/components/SortButton.tsx`
- Modify: `src/lib/tx/sort.ts` (remove the offset guard)
- Modify: `src/lib/tx/__tests__/sort.test.ts` (drop the offset-guard tests)

- [ ] **Step 1: Read the current SortButton to find the build/sign call**

Run: `sed -n '1,90p' src/components/SortButton.tsx` and locate where it calls `planSort` + `buildSortPsbt` and obtains `internalPubkey`/addresses/network. Note the exact symbols (do not guess).

- [ ] **Step 2: Point `useSortPlan` at the ledger**

Replace the body of `useSortPlan` in `src/components/useSortPlan.ts` so the view is derived from `planLedgerSort`. Keep the `SortPlanView` shape additive — add the ledger result:

```ts
import { useSortStore } from '@/store/sortStore';
import { classifyPlacement } from '@/types';
import type { LabeledUtxo } from '@/types';
import { planLedgerSort, type LedgerSortResult } from '@/lib/tx/ledgerSort';

export interface SortPlanView {
  result: LedgerSortResult;
  selectedUtxos: LabeledUtxo[];
  /** `txid:vout` keys of UTXOs consumed purely to fund the fee. */
  feeUtxoKeys: Set<string>;
}

export function useSortPlan(): SortPlanView {
  const wallet = useSortStore((s) => s.wallet);
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const feeRate = useSortStore((s) => s.selectedFeeRate);

  const selectedUtxos = utxos.filter((u) => selectedKeys.has(`${u.txid}:${u.vout}`));
  const availableFeeUtxos = utxos.filter((u) => {
    if (classifyPlacement(u) !== 'correct' || u.label !== 'plain') return false;
    if (selectedKeys.has(`${u.txid}:${u.vout}`)) return false;
    return true;
  });

  const result = planLedgerSort({
    selectedUtxos, availableFeeUtxos, feeRate,
    taprootAddress: wallet.taprootAddress, paymentAddress: wallet.paymentAddress,
  });
  const feeUtxoKeys = new Set(result.feeUtxos.map((u) => `${u.txid}:${u.vout}`));
  return { result, selectedUtxos, feeUtxoKeys };
}
```

- [ ] **Step 3: Update `SortButton` to build from the ledger**

In `src/components/SortButton.tsx`, replace the `planSort` + `buildSortPsbt` usage with `useSortPlan()`'s `result` and `buildSortPsbtFromLedger`. The button is disabled when `!result.ok` and shows `result.error`. On click:

```ts
import { buildSortPsbtFromLedger } from '@/lib/tx/satLedger';
// ...
const { result } = useSortPlan();
// disabled={!result.ok}; show result.error when present
// on build:
const { psbt, inputsToSign } = buildSortPsbtFromLedger({
  inputs: result.inputs,
  outputs: result.ledger.outputs,
  taprootAddress: wallet.taprootAddress,
  paymentAddress: wallet.paymentAddress,
  internalPubkey,   // same source the old buildSortPsbt used
  network,          // same source the old buildSortPsbt used
});
// ...then the existing sign + broadcast path, unchanged.
```

Adapt the exact `internalPubkey`/`network`/wallet variable names to whatever Step 1 found. Keep the existing sign/broadcast code below this verbatim.

- [ ] **Step 4: Remove the interim offset guard from `planSort`**

In `src/lib/tx/sort.ts`, delete the offset-guard block (the `for (const u of selectedUtxos) { for (const a of u.assets) { if (a.kind === 'inscription' && a.offset > 0) ... } }` added in commit `0f7e73d`). The ledger now handles offsets, so the guard is obsolete. (Leave `planSort`/`computeDustOutputs`/`buildSortPsbt` otherwise intact for now — they are no longer used by the UI but other tests reference them; a later cleanup task can remove them once nothing imports them.)

- [ ] **Step 5: Drop the offset-guard tests**

In `src/lib/tx/__tests__/sort.test.ts`, delete the entire `describe('planSort offset guard', ...)` block (added in `0f7e73d`) — it asserts behavior we just removed.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all tests pass. If `SortButton`/`useSortPlan` consumers reference the old `plan`/`SortPlan` shape, update them to the new `result` shape until tsc is clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): build sorts from the sat-ledger; remove interim offset guard"
```

---

## Task 7: Live acceptance — rescue the parent on testnet4

**Files:** none (manual, with the running stack)

- [ ] **Step 1: Stack + server**

Confirm ord healthy (`& 'F:\Users\akhil\Main\testnet4\verify.ps1'`). Ensure the dev server on `:3001` is running the latest build (restart if needed).

- [ ] **Step 2: Build the sort (do NOT sign yet)**

Connect the testnet4 wallet, scan, select the parent UTXO `420acce8…:3`. Click build and inspect the wallet preview. **Verify the outputs are:**
- a **segwit** output of ~**4,126** sats (pre-pad) to `tb1q…e5ph`
- a **546** sat **taproot** output to `tb1p…dvtg` (the inscription)
- a **segwit** change output for the remainder
This is the layout that was WRONG before (single 546 taproot + 12,974 segwit). If the preview matches the three-output layout, the offset is being handled.

- [ ] **Step 3: Sign + broadcast**

Sign and broadcast. Record the sort txid.

- [ ] **Step 4: Verify on ord (after 1 confirmation)**

Run (PowerShell), substituting `<SORTTXID>`:

```powershell
$ord='http://127.0.0.1:8080'
1..2 | ForEach-Object {
  $v = $_ - 1
  try { $o = Invoke-RestMethod "$ord/output/<SORTTXID>:$v" -Headers @{Accept='application/json'} } catch { return }
  Write-Output ("vout$v $($o.value) sat $($o.address) inscriptions=$($o.inscriptions -join ',')")
}
```

Expected: the **taproot** output (the 546 one, `tb1p58h0wl…`) lists `7c16f5d1…i0`; the segwit outputs do not. The parent is rescued to taproot.

- [ ] **Step 5: Record the result**

Append to spec `§12` acceptance #3: "✅ verified <date> — parent rescued to taproot via sat-ledger, sort txid `<SORTTXID>`." Commit.

---

## Plan-level Definition of Done

- `tsc --noEmit` clean; `vitest run` all green.
- `planSatLedger` extracts an inscription at any offset onto a 546 taproot output, returns plain to segwit, and the full edge-case matrix passes.
- The UI builds sorts from the ledger; the interim offset guard is gone; rune UTXOs are blocked with a clear message (Plan 2b).
- **Live:** the stranded parent `7c16f5d1…i0` is moved onto a taproot output, verified via ord — the rescue the whole redesign was for.
- Follow-on: **Plan 2b** (runestone encoder + rune moves), then **Plan 3** (UX: select/deselect-all, offset badges, plan preview, OrdHealthBanner).
