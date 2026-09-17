# UTXO Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a blank sat-aware UTXO composer at `/compose` so a user can inspect wallet UTXOs (ranges, kinds, rarity), pick spend and payment-fee inputs, define output rows (330/546/custom), preview FIFO sat flow, optionally add OP_RETURN and vanity TXID, then sign in Xverse (full I/O visible) and broadcast on signet or mainnet.

**Architecture:** Compose-only modules under `src/lib/compose/`, `src/store/composeStore.ts`, `src/app/compose/`, `src/components/compose/`. Sort and Consolidate planners and pages are not used. Compose has its own Esplora/ord session (signet from wallet network name, never Sort’s testnet4 list). A pure `planCompose()` walks the concatenated input sat line into user-defined output rows; `buildComposePsbt()` assembles a complete PSBT; sign uses `broadcast: false`, then Compose broadcasts after verification.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, bitcoinjs-lib **7.0.1**, tiny-secp256k1, sats-connect, zustand.

**Spec:** `docs/superpowers/specs/2026-09-16-utxo-composer-design.md`

## Global Constraints

- `bitcoinjs-lib` stays exact `7.0.1`.
- Keys never leave the client. `wallet_connect` purposes remain Ordinals + Payment only.
- Sort (`/`) and Consolidate (`/consolidate`) behavior stays unchanged. Do not edit `src/lib/tx/satLedger.ts`, `ledgerSort.ts`, `sort.ts`, `consolidate.ts`, Sort `UtxoTable` / `useSortPlan` / `sortStore` logic, or Consolidate UI.
- Compose must not call `src/lib/api/mempool.ts` `setMempoolNetwork`.
- Chain from wallet `network.bitcoin.name`, not `tb1` prefix. No testnet4 providers in Compose.
- SIGHASH_ALL only. Compose signs with `broadcast: false`.
- Rune-bearing UTXOs cannot be spent in v1.
- Policy dust: P2TR 330, P2WPKH 294, P2SH-P2WPKH 546. No 1-sat outputs.
- OP_RETURN: one, 0-value, UTF-8 ≤ 80 bytes.
- Vanity: nLockTime grind, all nSequence final, max 6 hex chars.
- Prove TX changes on **signet** (local ord), not testnet4.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/compose/types.ts` | ComposeUtxo, plan/input/output types |
| `src/lib/compose/network.ts` | Wallet name → `mainnet` \| `signet`; bitcoinjs network; explorer tx base |
| `src/lib/compose/mempool.ts` | Compose Esplora providers, fetch UTXOs/fees/broadcast |
| `src/lib/compose/rarity.ts` | Local ordinals rarity from sat number |
| `src/lib/compose/ord.ts` | Compose ord client: health, `/output` with sat_ranges, inscription offsets |
| `src/lib/compose/scan.ts` | Map Esplora UTXOs + ord → ComposeUtxo[] |
| `src/lib/compose/dust.ts` | Policy dust by address |
| `src/lib/compose/opreturn.ts` | Encode OP_RETURN; 80-byte gate |
| `src/lib/compose/size.ts` | vbyte estimate including nested inputs + OP_RETURN |
| `src/lib/compose/plan.ts` | `planCompose()` FIFO + gates |
| `src/lib/compose/psbt.ts` | `buildComposePsbt()` |
| `src/lib/compose/vanity/*` | Copy runes-etch grinder/worker; compose types |
| `src/store/composeStore.ts` | Compose zustand store |
| `src/app/compose/page.tsx` | Page |
| `src/components/compose/*` | Picker, rows, preview, OP_RETURN, vanity, sign |
| `src/lib/wallet/xverse.ts` | Additive `paymentPublicKey`, `network`; `signPsbtForCompose` |
| `src/types/index.ts` | Optional fields on `WalletState` only |
| `src/app/page.tsx` | Nav link to `/compose` only |
| `next.config.ts` | Additive CSP origins if missing |

---

### Task 1: Compose network (signet vs mainnet, never testnet4)

**Files:**
- Create: `src/lib/compose/network.ts`
- Test: `src/lib/compose/__tests__/network.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `ComposeChain`, `parseWalletNetworkName(name, address?)`, `bitcoinNetworkForChain(chain)`, `mempoolExplorerTxBase(chain)`, `ordChainName(chain)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  parseWalletNetworkName,
  bitcoinNetworkForChain,
  mempoolExplorerTxBase,
} from '../network';

describe('parseWalletNetworkName', () => {
  it('maps Signet from wallet name', () => {
    expect(parseWalletNetworkName('Signet', 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
  });
  it('maps Mainnet from wallet name', () => {
    expect(parseWalletNetworkName('Mainnet', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBe('mainnet');
  });
  it('routes legacy Testnet4 and Testnet wallet names to signet', () => {
    expect(parseWalletNetworkName('Testnet4', 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
    expect(parseWalletNetworkName('Testnet', 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
  });
  it('does not treat tb1 prefix alone as a chain id — missing name + tb1 still signet (dev default), never a testnet4 token', () => {
    expect(parseWalletNetworkName(undefined, 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
  });
});

describe('bitcoinNetworkForChain', () => {
  it('uses bitcoinjs testnet params for signet', () => {
    expect(bitcoinNetworkForChain('signet')).toBe(bitcoin.networks.testnet);
    expect(bitcoinNetworkForChain('mainnet')).toBe(bitcoin.networks.bitcoin);
  });
});

describe('mempoolExplorerTxBase', () => {
  it('uses signet explorer, not testnet4', () => {
    expect(mempoolExplorerTxBase('signet')).toBe('https://mempool.space/signet/tx');
    expect(mempoolExplorerTxBase('mainnet')).toBe('https://mempool.space/tx');
    expect(mempoolExplorerTxBase('signet')).not.toMatch(/testnet4/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/compose/__tests__/network.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
import * as bitcoin from 'bitcoinjs-lib';

export type ComposeChain = 'mainnet' | 'signet';

export function parseWalletNetworkName(name: string | undefined, address?: string): ComposeChain {
  if (name === 'Mainnet') return 'mainnet';
  if (name === 'Signet' || name === 'Testnet4' || name === 'Testnet') return 'signet';
  if (address && (address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n'))) {
    return 'signet';
  }
  return 'mainnet';
}

export function bitcoinNetworkForChain(chain: ComposeChain): bitcoin.Network {
  return chain === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

export function mempoolExplorerTxBase(chain: ComposeChain): string {
  return chain === 'signet' ? 'https://mempool.space/signet/tx' : 'https://mempool.space/tx';
}

export function ordChainName(chain: ComposeChain): 'bitcoin' | 'signet' {
  return chain === 'signet' ? 'signet' : 'bitcoin';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/compose/__tests__/network.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/compose/network.ts src/lib/compose/__tests__/network.test.ts
git commit -m "feat(compose): signet/mainnet from wallet name, never testnet4"
```

---

### Task 2: Compose Esplora client (does not touch Sort mempool)

**Files:**
- Create: `src/lib/compose/mempool.ts`
- Test: `src/lib/compose/__tests__/mempool.test.ts`

**Interfaces:**
- Consumes: `ComposeChain` from Task 1
- Produces: `setComposeMempoolNetwork(chain)`, `getComposeMempoolBases()`, `fetchComposeUtxos`, `fetchComposeFeeRates`, `broadcastComposeTx`

Provider lists (copy runes-etch order):

```ts
const PROVIDERS = {
  mainnet: [
    'https://mempool.emzy.de/api',
    'https://memepool.space/api',
    'https://mempool.space/api',
    'https://blockstream.info/api',
  ],
  signet: [
    'https://mempool.emzy.de/signet/api',
    'https://memepool.space/signet/api',
    'https://mempool.space/signet/api',
    'https://blockstream.info/signet/api',
  ],
};
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setComposeMempoolNetwork, getComposeMempoolBases } from '../mempool';

afterEach(() => vi.unstubAllGlobals());

describe('setComposeMempoolNetwork', () => {
  it('selects signet bases, none of which contain testnet4', () => {
    setComposeMempoolNetwork('signet');
    const bases = getComposeMempoolBases();
    expect(bases.some((b) => b.includes('/signet/'))).toBe(true);
    expect(bases.some((b) => b.includes('testnet4'))).toBe(false);
  });
  it('selects mainnet bases', () => {
    setComposeMempoolNetwork('mainnet');
    const bases = getComposeMempoolBases();
    expect(bases.every((b) => !b.includes('/signet/') && !b.includes('testnet4'))).toBe(true);
  });
});
```

Also add a test that `src/lib/api/mempool.ts` is **not imported** from `mempool.ts` (read the source in the test or simply do not import it). Do not call Sort `setMempoolNetwork`.

Copy `tryProviders` / `fetchUtxos` / `fetchFeeRates` / `broadcastTx` validation from `src/lib/api/mempool.ts` into this file, switching on `activeBases` from `PROVIDERS[chain]`. Export `fetchComposeUtxos`, `fetchComposeFeeRates`, `broadcastComposeTx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/compose/__tests__/mempool.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/lib/compose/mempool.ts`** as specified (failover, 15s timeout, 4xx returned as-is, 5xx/network advances). `getComposeMempoolBases()` returns the active list.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/compose/__tests__/mempool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/compose/mempool.ts src/lib/compose/__tests__/mempool.test.ts
git commit -m "feat(compose): signet/mainnet Esplora client isolated from Sort"
```

---

### Task 3: Ordinals rarity from sat number

**Files:**
- Create: `src/lib/compose/rarity.ts`
- Test: `src/lib/compose/__tests__/rarity.test.ts`

**Interfaces:**
- Produces: `RarityName`, `satRarity(sat: bigint)`, `tagsInRange(start, endExclusive)`

Subsidy: 50 BTC genesis, halve every 210_000 blocks. Uncommon = first sat of a block (`offset === 0`). Rare = first sat of a 2016-block period. Epic = first sat of a 210_000-block epoch. Legendary = first sat of a 1_260_000-block cycle. Mythic = sat 0.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { satRarity, tagsInRange } from '../rarity';

describe('satRarity', () => {
  it('tags sat 0 as mythic', () => {
    expect(satRarity(0n)).toBe('mythic');
  });
  it('tags a non-first sat of block 0 as common', () => {
    expect(satRarity(1n)).toBe('common');
  });
  it('tags the first sat of block 1 as uncommon (50 BTC coinbase)', () => {
    expect(satRarity(5_000_000_000n)).toBe('uncommon');
  });
  it('does not tag the second sat of block 1 as uncommon', () => {
    expect(satRarity(5_000_000_001n)).toBe('common');
  });
});

describe('tagsInRange', () => {
  it('finds an uncommon sat inside a longer common range', () => {
    const tags = tagsInRange(4_999_999_990n, 5_000_000_010n);
    expect(tags.some((t) => t.sat === 5_000_000_000n && t.rarity === 'uncommon')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/compose/__tests__/rarity.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `rarity.ts`**

Walk epochs with closed form: epoch `e` has `210_000` blocks of subsidy `(50n * 100_000_000n) >> e`. Convert sat → `{ height, offset }`. Then:

```ts
export type RarityName = 'mythic' | 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common';

export function satRarity(sat: bigint): RarityName {
  if (sat === 0n) return 'mythic';
  const { height, offset } = satToHeightOffset(sat);
  if (offset !== 0) return 'common';
  if (height % 1_260_000 === 0) return 'legendary';
  if (height % 210_000 === 0) return 'epic';
  if (height % 2016 === 0) return 'rare';
  return 'uncommon';
}
```

`tagsInRange`: if the range is small (`< 20_000_000` sats) scan block boundaries that fall inside by converting start/end to heights and tagging `firstSatOfBlock(h)` when it lies in `[start, end)`. If the range is huge, only tag `satRarity(start)` plus block-first sats between `height(start)` and `height(endExclusive-1)` — still height iteration, not per-sat.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/compose/rarity.ts src/lib/compose/__tests__/rarity.test.ts
git commit -m "feat(compose): local ordinals rarity tags from sat numbers"
```

---

### Task 4: Types, ord output mapping, scan

**Files:**
- Create: `src/lib/compose/types.ts`
- Create: `src/lib/compose/ord.ts`
- Create: `src/lib/compose/scan.ts`
- Test: `src/lib/compose/__tests__/scan.test.ts`

**Interfaces:**
- Consumes: rarity, compose chain
- Produces: `ComposeUtxo`, `outputToComposePartial`, `scanComposeUtxos`

`types.ts` matches spec §5 (`ComposeUtxo`, `SatRangeView`, `ComposeUtxoKind`, `AddressKind`). Reuse `Asset` from `@/types`.

Ord base:

```ts
export function composeOrdBase(chain: ComposeChain): string {
  if (chain === 'signet') {
    return (process.env.NEXT_PUBLIC_ORD_BASE_SIGNET
      || process.env.NEXT_PUBLIC_ORD_BASE_TESTNET
      || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_ORD_BASE_MAINNET || 'https://ordinals.com').replace(/\/+$/, '');
}
```

`assertComposeOrdHealthy(chain)`: on signet, GET `/status`, fail if unreachable or `unrecoverably_reorged`. Copy `parseOrdStatus` logic from `src/lib/api/ord.ts` (do not import Sort ord if that file’s `setOrdNetwork` is address-prefix based — **copy** the status parse, keep a compose-local `_chain`).

`fetchComposeOrdOutput(txid, vout)` returns JSON including `inscriptions`, `runes`, `value`, `sat_ranges?: [number, number][]`.

Pure mapper (test this, not fetch):

```ts
export function classifyAddressKind(address: string): AddressKind {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) return 'taproot';
  if (address.startsWith('3') || address.startsWith('2')) return 'p2sh-p2wpkh';
  return 'p2wpkh';
}

export function mapOrdOutputToCompose(params: {
  txid: string; vout: number; value: number; confirmed: boolean;
  address: string; source: 'taproot' | 'payment';
  output: {
    inscriptions: string[];
    runes: Record<string, { amount: number; divisibility: number }>;
    sat_ranges?: [number, number][] | null;
  };
  inscriptionOffsets: Map<string, number>;
}): ComposeUtxo
```

Kind: ord missing ranges → still set kind from inscriptions/runes, `satRanges: null` if `sat_ranges` absent. Kind `unknown` is for fetch throw (scan loop). If runes nonempty → `rune`; else inscriptions → `inscription`; else `plain`.

Build `satRanges` by walking `[start,end)` arrays, accumulating `offset` by each range length; `length = end-start`; attach `tagsInRange`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mapOrdOutputToCompose } from '../scan';

const txid = 'a'.repeat(64);

describe('mapOrdOutputToCompose', () => {
  it('keeps multiple sat ranges with offsets', () => {
    const u = mapOrdOutputToCompose({
      txid, vout: 1, value: 1000, confirmed: true,
      address: 'tb1ptaprootxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      source: 'taproot',
      output: { inscriptions: [], runes: {}, sat_ranges: [[10, 510], [8000, 8500]] },
      inscriptionOffsets: new Map(),
    });
    expect(u.kind).toBe('plain');
    expect(u.satRanges).not.toBeNull();
    expect(u.satRanges![0]).toMatchObject({ offset: 0, length: 500 });
    expect(u.satRanges![1]).toMatchObject({ offset: 500, length: 500 });
  });

  it('labels rune even when an inscription is also present', () => {
    const u = mapOrdOutputToCompose({
      txid, vout: 0, value: 546, confirmed: true,
      address: 'tb1qsegwit', source: 'payment',
      output: {
        inscriptions: ['abci0'],
        runes: { Z: { amount: 1, divisibility: 0 } },
        sat_ranges: [[0, 546]],
      },
      inscriptionOffsets: new Map([['abci0', 0]]),
    });
    expect(u.kind).toBe('rune');
    expect(u.assets.some((a) => a.kind === 'inscription' && a.offset === 0)).toBe(true);
  });

  it('sets satRanges null when ord omits them', () => {
    const u = mapOrdOutputToCompose({
      txid, vout: 0, value: 1000, confirmed: true,
      address: 'tb1qsegwit', source: 'payment',
      output: { inscriptions: [], runes: {}, sat_ranges: null },
      inscriptionOffsets: new Map(),
    });
    expect(u.kind).toBe('plain');
    expect(u.satRanges).toBeNull();
  });
});
```

Use a realistic-length taproot in the test if `classifyAddressKind` only checks prefixes (`tb1p` is enough).

- [ ] **Step 2: FAIL then implement types + mapper in `scan.ts`; ord fetch in `ord.ts`**

`scanComposeUtxos(utxos, chain, onProgress)`: signet → `assertComposeOrdHealthy`. Per UTXO try fetch output + inscription offsets; on throw push `kind: 'unknown', satRanges: null, assets: []`.

- [ ] **Step 3: PASS + commit**

```bash
git add src/lib/compose/types.ts src/lib/compose/ord.ts src/lib/compose/scan.ts src/lib/compose/__tests__/scan.test.ts
git commit -m "feat(compose): ord scan with sat ranges and kind labels"
```

---

### Task 5: Dust, OP_RETURN, vbyte size

**Files:**
- Create: `src/lib/compose/dust.ts`
- Create: `src/lib/compose/opreturn.ts`
- Create: `src/lib/compose/size.ts`
- Test: `src/lib/compose/__tests__/dust.test.ts`, `opreturn.test.ts`, `size.test.ts`

**Interfaces:**
- Produces: `dustLimitForAddress(address)`, `encodeOpReturn(utf8)`, `estimateComposeVBytes(...)`

Dust: taproot/`tb1p`/`bc1p` → 330; nested `3`/`2` → 546; else P2WPKH → 294.

OP_RETURN: `Buffer.from(text, 'utf8')`; if length 0 return `null`; if length > 80 throw; `bitcoin.payments.embed({ data: [payload] }).output`.

Size: copy Sort constants plus nested input **91** vB and OP_RETURN output vbytes = `Math.ceil((8 + 1 + script.length) )` wait: non-witness bytes = 8 (value) + compactSize(script) + script; vbytes = that amount (weight/4 = bytes for non-witness). Use `8 + 1 + script.length` when script.length < 253.

`estimateComposeVBytes({ taprootInputs, p2wpkhInputs, nestedInputs, satOutputs, opReturnScriptLen: number | null })`

- [ ] **Step 1: Failing tests**

```ts
// dust.test.ts
expect(dustLimitForAddress('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr')).toBe(330);
expect(dustLimitForAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(294);
expect(dustLimitForAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(546);

// opreturn.test.ts
expect(encodeOpReturn('')).toBeNull();
expect(encodeOpReturn('hello')!.length).toBeGreaterThan(2);
expect(() => encodeOpReturn('x'.repeat(81))).toThrow(/80/);

// size.test.ts
const a = estimateComposeVBytes({ taprootInputs: 1, p2wpkhInputs: 1, nestedInputs: 0, satOutputs: 2, opReturnScriptLen: null });
const b = estimateComposeVBytes({ taprootInputs: 1, p2wpkhInputs: 1, nestedInputs: 0, satOutputs: 2, opReturnScriptLen: 10 });
expect(b).toBeGreaterThan(a);
expect(a).toBeLessThanOrEqual(100_000);
```

- [ ] **Step 2–4: FAIL / implement / PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/compose/dust.ts src/lib/compose/opreturn.ts src/lib/compose/size.ts src/lib/compose/__tests__/dust.test.ts src/lib/compose/__tests__/opreturn.test.ts src/lib/compose/__tests__/size.test.ts
git commit -m "feat(compose): dust limits, OP_RETURN encoder, vbyte estimate"
```

---

### Task 6: `planCompose` FIFO + gates

**Files:**
- Create: `src/lib/compose/plan.ts`
- Test: `src/lib/compose/__tests__/plan.test.ts`

**Interfaces:**
- Consumes: types, dust, size, opreturn
- Produces: `planCompose(params): ComposePlan`

```ts
export interface ComposePlanInput {
  utxo: ComposeUtxo;
  role: 'spend' | 'fee';
}

export interface ComposePlanOutputRow {
  value: number;
  address: string;
}

export interface ComposePlan {
  ok: boolean;
  error?: string;
  inputs: ComposePlanInput[]; // spend first, fee last
  outputs: Array<{
    address: string;
    value: number;
    satStart: number; // offset on concatenated line
    satEnd: number;   // exclusive
    inscriptions: Array<{ id: string; outputOffset: number }>;
    startsWithTaggedSat: boolean;
    ranges: SatRangeView[];
  }>;
  fee: number;
  estimatedVBytes: number;
  opReturnScript?: Uint8Array;
}
```

Algorithm:
1. Validate each input: fee role ⇒ `source === 'payment'` && `kind === 'plain'`; spend/fee: not rune/unknown, confirmed. Missing satRanges is allowed (signet sat_index off).
2. Order: spend in given order, then fee.
3. Concatenate sat line; assign absolute inscription positions.
4. Walk output rows in order; cursor starts 0; each row consumes `value` sats from the line; if cursor+value > totalIn → fail. Slice ranges/inscriptions into the output. `startsWithTaggedSat` if an inscription lands at outputOffset 0 or a non-common rarity tag includes the first sat.
5. If a row would start at cursor >= spendTotal and there is no fee input, fail with message requiring a payment UTXO (spec: past end of **spend** inputs).
6. Dust: each row `value >= dustLimitForAddress(address)`.
7. OP_RETURN via `encodeOpReturn`.
8. `estimatedVBytes` from actual input kinds + satOutputs + optional OP_RETURN. `requiredFee = ceil(vbytes * feeRate)`. `fee = totalIn - sum(rows)`. If `fee < requiredFee` fail. If `fee > 0` and no fee-role input fail.
9. If vbytes > 100_000 fail.

Helper for tests: `makeUtxo(partial)`.

- [ ] **Step 1: Write failing tests (all in one file)**

```ts
describe('planCompose', () => {
  it('puts a mid-UTXO sat at output offset 0 when the pre-pad row equals that offset', () => {
    // 62000 spend UTXO, inscription at 6000; rows: 6000 payment, 330 taproot, rest-fee to payment
    // use feeRate 1 and a large fee UTXO last
  });
  it('does not use payment sats as postage for offset 6000 when following sats exist in the same UTXO', () => {
    // 330 output starting at 6000 must cover sats 6000-6329 of the spend UTXO
  });
  it('refuses a near-end extract that runs past spend inputs until a fee UTXO is appended', () => {});
  it('after a fee UTXO is appended, payment sats continue the line', () => {});
  it('OP_RETURN does not shift inscription output offsets', () => {});
  it('refuses rune spend inputs', () => {});
  it('plans by offset when satRanges are missing (signet sat_index off)', () => {});
  it('refuses a 1-sat taproot output', () => {});
  it('refuses taproot in the fee role', () => {});
  it('fee equals unassigned tail', () => {});
});
```

Fill each test with concrete numbers. For the mid-UTXO case:

Spend value 62000, inscription offset 6000. Rows: `{ value: 6000, address: SEGWIT }`, `{ value: 330, address: TAPROOT }`, `{ value: 55000, address: SEGWIT }` plus a fee UTXO of 20000. Fee rate 1. Assert output[1] inscription `outputOffset === 0`. Assert output[1] sat slice is from the spend utxo not the fee utxo (absolute satStart 6000, satEnd 6330).

Near-end: spend 62000, extract 330 starting at 61900 (rows: 61900 + 330) without fee input → fail. With fee 10000 after → ok, 330 row overlaps into payment sats.

- [ ] **Step 2: FAIL, implement `plan.ts`, PASS**

- [ ] **Step 3: Commit**

```bash
git add src/lib/compose/plan.ts src/lib/compose/__tests__/plan.test.ts
git commit -m "feat(compose): FIFO planner with payment-last fee and dust gates"
```

---

### Task 7: PSBT assembler (taproot, native, nested, OP_RETURN, SIGHASH_ALL)

**Files:**
- Create: `src/lib/compose/psbt.ts`
- Test: `src/lib/compose/__tests__/psbt.test.ts`

**Interfaces:**
- Consumes: plan outputs, keys
- Produces: `buildComposePsbt({ inputs, outputs, opReturnScript, taprootInternalKey, paymentPublicKey, network, nLockTime, nSequence })` → `{ psbt, inputsToSign }`

Copy nested construction from `F:\Users\akhil\Main\runes-etch\src\lib\runes\psbtInputs.ts` `buildFundingPsbtInput` (do not import across repos). Every input `witnessUtxo`. Taproot `tapInternalKey`. Nested requires `paymentPublicKey` else throw. All `inputsToSign` indexes. Default nSequence `0xffffffff`, nLockTime `0`. Add sat outputs then OP_RETURN output `{ script, value: 0n }`. Do not set sighash type (bitcoinjs default ALL). Throw if sum(out) > sum(in).

Use BIP86/84 vectors from `src/lib/tx/__tests__/buildLedgerPsbt.test.ts`:

```ts
const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
```

- [ ] **Step 1: Failing tests**

```ts
it('adds tapInternalKey on taproot inputs and lists every input in inputsToSign', () => {});
it('adds redeemScript for nested p2sh-p2wpkh when payment pubkey is present', () => {});
it('throws on nested input without payment pubkey', () => {});
it('includes a 0-value OP_RETURN as the last output', () => {});
it('does not set sighash type on inputs (ALL default)', () => {
  expect(psbt.data.inputs[0].sighashType).toBeUndefined();
});
```

For nested: `bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.bitcoin }) })` and use that address as the input address.

- [ ] **Step 2–4: FAIL / implement / PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/compose/psbt.ts src/lib/compose/__tests__/psbt.test.ts
git commit -m "feat(compose): complete PSBT with nested payment and OP_RETURN"
```

---

### Task 8: Wallet additive fields + compose sign (broadcast false)

**Files:**
- Modify: `src/types/index.ts` (`WalletState` optional `paymentPublicKey?: string`, `network?: 'mainnet' | 'signet'`)
- Modify: `src/lib/wallet/xverse.ts`
- Test: `src/lib/wallet/__tests__/xverseCompose.test.ts` if mocking is heavy, instead test a tiny helper `export function signPsbtForCompose(...)` is a one-liner calling `signPsbtWithBroadcast(..., false)` — `signPsbtForConsolidation` already exists; **add** `signPsbtForCompose` as:

```ts
export async function signPsbtForCompose(
  psbtBase64: string,
  inputsToSign: Array<{ index: number; address: string }>,
): Promise<SignResult> {
  return signPsbtForConsolidation(psbtBase64, inputsToSign);
}
```

Do **not** change `signPsbt` (still broadcast true). Still only request `AddressPurpose.Ordinals` and `AddressPurpose.Payment`.

In `connectWallet` after addresses: `paymentPublicKey: paymentAddr.publicKey`, `network: parseWalletNetworkName` — **import parseWalletNetworkName from `@/lib/compose/network`**. If that creates a Sort→Compose dependency from wallet (Sort also uses connectWallet), that is OK: optional fields, same purposes. If `paymentAddr.publicKey` is missing, leave `paymentPublicKey` undefined (do not throw — Sort must still connect). Nested compose build already refuses without it.

- [ ] **Step 1: Add a unit test for parse already done; add:**

```ts
import { describe, it, expect } from 'vitest';
import type { WalletState } from '@/types';

it('WalletState optional compose fields are additive', () => {
  const w: WalletState = { connected: false, taprootAddress: '', paymentAddress: '', publicKey: '' };
  expect(w.paymentPublicKey).toBeUndefined();
  expect(w.network).toBeUndefined();
});
```

Put in `src/types/__tests__/walletState.test.ts`.

- [ ] **Step 2–4: implement types + xverse extras + alias**

- [ ] **Step 5: Run full `npm test` to ensure Sort/Consolidate still pass, then commit**

```bash
git add src/types/index.ts src/types/__tests__/walletState.test.ts src/lib/wallet/xverse.ts
git commit -m "feat(wallet): additive payment pubkey and compose sign-without-broadcast"
```

---

### Task 9: Vanity grind (copy runes-etch worker; locktime only)

**Files:**
- Create: `src/lib/compose/vanity/worker.ts` — copy `F:\Users\akhil\Main\runes-etch\src\lib\vanity\worker.ts`
- Create: `src/lib/compose/vanity/grinder.ts` — copy `F:\Users\akhil\Main\runes-etch\src\lib\vanity\grinder.ts`, point worker URL at compose worker
- Create: `src/lib/compose/vanity/locktime.ts` — apply nLockTime to unsigned tx hex/template
- Test: `src/lib/compose/vanity/__tests__/locktime.test.ts`

**Interfaces:**
- Produces: `assertVanityHex(prefix, suffix)` max 6 hex each; `withLocktime(psbt, locktime)`; grind clears when plan hash changes

- [ ] **Step 1: Tests**

```ts
it('rejects prefix longer than 6 hex chars', () => {
  expect(() => assertVanityHex('abcdef0', '')).toThrow(/6/);
});
it('buildComposePsbt nSequence is 0xffffffff on every input', () => {
  // use Task 7 builder
});
```

- [ ] **Step 2: Copy worker/grinder; implement `assertVanityHex`**

When wiring UI (Task 11): freeze plan; grind locktime; on found store nonce; any input/output/fee/OP_RETURN change clears nonce. After sign, extract txid, if vanity target set and mismatch throw and do not broadcast.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compose/vanity
git commit -m "feat(compose): locktime vanity grind copied from runes-etch"
```

---

### Task 10: Compose store, page shell, CSP, nav link

**Files:**
- Create: `src/store/composeStore.ts`
- Create: `src/app/compose/page.tsx` (shell: title, network badge, links to `/` and `/consolidate`, WalletBar-like connect using compose store)
- Create: `src/components/compose/ComposeWalletBar.tsx` — copy pattern from `src/components/WalletBar.tsx` but `useComposeStore`; on connect call `setComposeMempoolNetwork(parseWalletNetworkName(wallet.network, wallet.paymentAddress))` and compose ord chain
- Modify: `src/app/page.tsx` — add `<Link href="/compose">` next to Consolidate (navigation only)
- Modify: `next.config.ts` — add `https://blockstream.info` to `connect-src` if missing; keep `http://127.0.0.1:8080` and existing mempool hosts

Store fields: wallet, utxos, spendKeys, feeKeys, outputRows, opReturnText, feeRate, feeRates, scanStatus, plan, vanity, status.

- [ ] **Step 1: Store unit test** — selecting a rune key into spendKeys is prevented by the setter (ignore / no-op).

```ts
it('does not add rune UTXOs to spendKeys', () => {
  useComposeStore.setState({ utxos: [runeUtxo] });
  useComposeStore.getState().toggleSpend(`${runeUtxo.txid}:${runeUtxo.vout}`);
  expect(useComposeStore.getState().spendKeys.size).toBe(0);
});
```

- [ ] **Step 2: Implement store + page shell + CSP + nav**

- [ ] **Step 3: `npm test` still green**

- [ ] **Step 4: Commit**

```bash
git add src/store/composeStore.ts src/store/__tests__/composeStore.test.ts src/app/compose/page.tsx src/components/compose/ComposeWalletBar.tsx src/app/page.tsx next.config.ts
git commit -m "feat(compose): page shell, store, nav link, CSP for signet Esplora"
```

---

### Task 11: Scan UI, picker, output rows, preview, sign flow

**Files:**
- Create: `src/components/compose/UtxoPicker.tsx` — columns: select (spend vs fee slot), outpoint, address kind, source, kind chip, value, sat ranges + rarity, inscription offsets. Unconfirmed listed disabled. Rune/unknown/null ranges not selectable.
- Create: `src/components/compose/OutputRows.tsx` — add/remove, presets 330/546, custom, destination taproot/payment/paste
- Create: `src/components/compose/SatPreview.tsx` — from `planCompose`
- Create: `src/components/compose/OpReturnField.tsx` — live byte count
- Create: `src/components/compose/VanityField.tsx`
- Create: `src/components/compose/ComposeSignButton.tsx` — build PSBT, `signPsbtForCompose`, verify txid + outputs, `broadcastComposeTx`
- Modify: `src/app/compose/page.tsx` to mount them
- Test: `src/lib/compose/__tests__/signVerify.test.ts` for the **pure** verify helper used by the button:

```ts
export function verifySignedTx(params: {
  signedTxid: string;
  plannedTxid: string;
  vanityTarget?: { prefix: string; suffix: string };
}): void
```

Mismatch vanity or planned txid throws `/not broadcasting/i`.

Scan on connect: `fetchComposeUtxos` both addresses, `scanComposeUtxos`, `fetchComposeFeeRates`.

Preview recomputes `planCompose` when spendKeys, feeKeys, rows, feeRate, opReturn change; clears vanity nonce.

Sign path: if `!plan.ok` disable. Build PSBT with payment pubkey from wallet. Sign broadcast false. Extract tx, compare txid to unsigned txid, vanity check, output values, then broadcast. Link `mempoolExplorerTxBase(chain)/${txid}`.

- [ ] **Step 1: verifySignedTx tests FAIL/PASS**

- [ ] **Step 2: Implement components; keep styling consistent with Sort (dark, orange accents, `max-w-2xl` or slightly wider for ranges)**

- [ ] **Step 3: `npm test` && `npx tsc --noEmit`**

- [ ] **Step 4: Commit**

```bash
git add src/components/compose src/app/compose/page.tsx src/lib/compose/signVerify.ts src/lib/compose/__tests__/signVerify.test.ts
git commit -m "feat(compose): picker, output rows, sat preview, sign-and-verify broadcast"
```

---

### Task 12: Live signet acceptance (manual)

Do not claim done until these pass on **signet** with local ord (`NEXT_PUBLIC_ORD_BASE_SIGNET` or `:8080`).

- [ ] Scan shows mixed UTXO: all sat ranges, kind, rarity, outpoint, address kind
- [ ] Split: chosen sat at offset 0 on 330 or 546 taproot; fee from payment last
- [ ] Near-end sat blocked until payment UTXO added
- [ ] Rune UTXO not selectable for spend
- [ ] OP_RETURN visible as 0-sat in Xverse popup; inscriptions unmoved
- [ ] Vanity: signed txid matches; do not broadcast on mismatch
- [ ] Xverse popup lists every input and output
- [ ] Sort `/` and Consolidate still load and scan as before

- [ ] **Commit nothing unless a bugfix is required; if so, one fix = one commit**

---

## Self-review (author)

Spec coverage: inventory (T3–4, T11), blank rows + FIFO (T6), payment fee last (T6), rune refuse (T6, T10), OP_RETURN (T5, T7, T11), vanity (T9, T11), Xverse I/O + broadcast false (T7–8, T11), signet isolation (T1–2), Sort/Consolidate untouched (global + T10 nav-only). Sequential 1-sat splitter is not a task (v2).

No Sort mempool `setMempoolNetwork`. Dust values copied from spec. `signPsbt` remains broadcast true.
