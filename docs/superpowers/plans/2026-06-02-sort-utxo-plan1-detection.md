# Sort UTXO Redesign — Plan 1: Detection Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ord the single, authoritative source of asset detection on both networks (testnet4 local + mainnet public), so transferred inscriptions/runes are correctly labeled with their sat offset — fixing the bug that mislabeled the stranded parent as "plain".

**Architecture:** Rewrite the scanner to query ord `/output` (+ `/inscription` for offsets) for every UTXO; delete the testnet4 tx-decode path entirely; add an `assets[]` field (with offsets) to `LabeledUtxo` additively, keeping the existing `label`/flags derived so `classifyPlacement`, `useSortPlan`, and the UI keep working unchanged. Fail closed: a UTXO ord cannot authoritatively label becomes `unknown` and is excluded from sorting — never silently `plain`.

**Tech Stack:** TypeScript, Next.js 16, Vitest, ord HTTP API, Esplora.

**This is Plan 1 of 3** (spec: `docs/superpowers/specs/2026-06-02-sort-utxo-redesign-design.md`):
- **Plan 1 — Detection Foundation** (this doc): authoritative `assets[]` labeling + offsets + fail-closed.
- **Plan 2 — Sat-ledger builder**: pure `planSatLedger()` + runestone encoder + `buildPsbt` rework (consumes `assets[]`/offsets).
- **Plan 3 — UX & wiring**: select/deselect-all-recommended, offset badges, plan preview, OrdHealthBanner, full type migration off legacy `label` fields.

**Reconciliation note (in-flight uncommitted work):** the working tree already has compatible edits — combined rune+inscription labeling (`hasInscription` flag, `OrdLabel` allowing both, "Rune + Inscription" in `UtxoTable`), the Xverse `wallet_connect` migration (KEEP — correct), and the already-applied `mempool.ts` multi-provider fallback + `next.config.ts` CSP. This plan's `assets[]` model supersedes the `hasInscription` flag but keeps it derived for now (Plan 3 removes it). Do NOT revert the Xverse or mempool changes.

---

## Task 1: Asset data model (additive) + `unknown` label

**Files:**
- Modify: `src/types/index.ts`
- Test: `src/types/__tests__/classifyPlacement.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/types/__tests__/classifyPlacement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyPlacement, type LabeledUtxo } from '..';

function utxo(partial: Partial<LabeledUtxo>): LabeledUtxo {
  return {
    txid: 'a'.repeat(64), vout: 0, value: 10000,
    status: { confirmed: true },
    label: 'plain', source: 'payment', assets: [],
    ...partial,
  };
}

describe('classifyPlacement', () => {
  it('asset on payment (segwit) is misplaced', () => {
    expect(classifyPlacement(utxo({ label: 'inscription', source: 'payment', assets: [{ kind: 'inscription', id: 'x'.repeat(64) + 'i0', offset: 4126 }] }))).toBe('misplaced');
  });
  it('asset on taproot is correct', () => {
    expect(classifyPlacement(utxo({ label: 'inscription', source: 'taproot' }))).toBe('correct');
  });
  it('plain on payment is correct', () => {
    expect(classifyPlacement(utxo({ label: 'plain', source: 'payment' }))).toBe('correct');
  });
  it('plain on taproot is misplaced', () => {
    expect(classifyPlacement(utxo({ label: 'plain', source: 'taproot' }))).toBe('misplaced');
  });
  it('unknown is never misplaced (excluded from sorting)', () => {
    expect(classifyPlacement(utxo({ label: 'unknown', source: 'payment' }))).toBe('correct');
    expect(classifyPlacement(utxo({ label: 'unknown', source: 'taproot' }))).toBe('correct');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /f/Users/akhil/Main/sort-utxo && npx vitest run src/types/__tests__/classifyPlacement.test.ts`
Expected: FAIL — `'unknown'` not assignable to `UtxoLabel`, and `assets` missing on `LabeledUtxo`.

- [ ] **Step 3: Write minimal implementation**

In `src/types/index.ts`, replace the `UtxoLabel` type, the `LabeledUtxo` interface, and `classifyPlacement`:

```ts
export type UtxoLabel = 'plain' | 'inscription' | 'rune' | 'unknown';

/** A single on-chain asset carried by a UTXO, as reported by ord. */
export type Asset =
  | { kind: 'inscription'; id: string; offset: number } // offset = sats from output start
  | { kind: 'rune'; name: string; amount: bigint; divisibility: number };

export interface LabeledUtxo extends Utxo {
  /**
   * Derived summary label for existing consumers (UI, fee planning).
   * 'plain' | 'inscription' | 'rune' | 'unknown'. Prefer `assets` for new code;
   * `label` is computed from `assets` (or 'unknown' on a labeling failure).
   */
  label: UtxoLabel;
  /** Which wallet address this UTXO belongs to */
  source: 'taproot' | 'payment';
  /** Authoritative asset list from ord. [] === plain. */
  assets: Asset[];
  /** Rune name if this UTXO carries a rune (derived from `assets`). */
  runeName?: string;
  /** Inscription ID if this UTXO carries one (derived from `assets`). */
  inscriptionId?: string;
  /** True when the UTXO carries an inscription (derived from `assets`). */
  hasInscription?: boolean;
}

export type UtxoPlacement = 'misplaced' | 'correct';

export function classifyPlacement(utxo: LabeledUtxo): UtxoPlacement {
  // Fail-closed: an unknown UTXO is never moved.
  if (utxo.label === 'unknown') return 'correct';
  if (utxo.label === 'plain') {
    return utxo.source === 'payment' ? 'correct' : 'misplaced';
  }
  return utxo.source === 'taproot' ? 'correct' : 'misplaced';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types/__tests__/classifyPlacement.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/types/__tests__/classifyPlacement.test.ts
git commit -m "feat(types): add assets[] + unknown label, fail-closed classifyPlacement"
```

---

## Task 2: Per-network ord base + health guard

**Files:**
- Modify: `src/lib/api/ord.ts`
- Modify: `next.config.ts` (CSP connect-src for local ord)
- Test: `src/lib/api/__tests__/ord.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/api/__tests__/ord.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setOrdNetwork, ordBase, parseOrdStatus } from '../ord';

afterEach(() => vi.restoreAllMocks());

describe('ord base routing', () => {
  it('uses local ord for a tb1 (testnet) address', () => {
    setOrdNetwork('tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph');
    expect(ordBase()).toBe('http://127.0.0.1:8080');
  });
  it('uses public ord for a bc1 (mainnet) address', () => {
    setOrdNetwork('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(ordBase()).toBe('https://ordinals.com');
  });
});

describe('parseOrdStatus', () => {
  it('flags wedged when unrecoverably_reorged', () => {
    expect(parseOrdStatus({ height: 137465, chain: 'testnet4', unrecoverably_reorged: true }))
      .toEqual({ ok: false, reason: 'wedged', height: 137465, chain: 'testnet4' });
  });
  it('reports healthy otherwise', () => {
    expect(parseOrdStatus({ height: 137465, chain: 'testnet4', unrecoverably_reorged: false }))
      .toEqual({ ok: true, height: 137465, chain: 'testnet4' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/__tests__/ord.test.ts`
Expected: FAIL — `setOrdNetwork`, `ordBase`, `parseOrdStatus` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/api/ord.ts`, replace the hardcoded `const ORD_BASE = 'https://ordinals.com';` block with per-network routing and add status helpers (keep the existing `fetchWithTimeout`, `fetchOrdOutput`, `labelFromOrdOutput`, `labelUtxosViaOrd`):

```ts
const PUBLIC_ORD_DEFAULT = 'https://ordinals.com';
const ORD_BASE_MAINNET = (process.env.NEXT_PUBLIC_ORD_BASE_MAINNET || PUBLIC_ORD_DEFAULT).replace(/\/+$/, '');
const ORD_BASE_TESTNET = (process.env.NEXT_PUBLIC_ORD_BASE_TESTNET || 'http://127.0.0.1:8080').replace(/\/+$/, '');

let _isTestnet = false;
export function setOrdNetwork(address: string): void {
  _isTestnet = address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n');
}
export function ordBase(): string {
  return _isTestnet ? ORD_BASE_TESTNET : ORD_BASE_MAINNET;
}
export function isOrdTestnet(): boolean {
  return _isTestnet;
}

export type OrdStatus =
  | { ok: true; height: number; chain: string }
  | { ok: false; reason: 'wedged'; height: number; chain: string };

export function parseOrdStatus(raw: { height: number; chain: string; unrecoverably_reorged: boolean }): OrdStatus {
  if (raw.unrecoverably_reorged) return { ok: false, reason: 'wedged', height: raw.height, chain: raw.chain };
  return { ok: true, height: raw.height, chain: raw.chain };
}

/** Throws a clear error if ord is unreachable or wedged. Call before a testnet4 scan. */
export async function assertOrdHealthy(): Promise<void> {
  let raw: { height: number; chain: string; unrecoverably_reorged: boolean };
  try {
    const res = await fetchWithTimeout(`${ordBase()}/status`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ord /status ${res.status}`);
    raw = await res.json();
  } catch (err) {
    throw new Error(`Local ord is unreachable at ${ordBase()} — start it (/btcfullord) before scanning. (${err instanceof Error ? err.message : String(err)})`);
  }
  const status = parseOrdStatus(raw);
  if (!status.ok) throw new Error(`Local ord is wedged on a reorg (block ${status.height}). Recover ord before scanning; its labels can't be trusted.`);
}
```

Update `fetchOrdOutput` to use `ordBase()` instead of the removed `ORD_BASE` constant:

```ts
export async function fetchOrdOutput(txid: string, vout: number): Promise<OrdOutputResponse> {
  if (!TXID_RE.test(txid)) throw new Error(`Invalid txid: ${txid}`);
  if (!Number.isInteger(vout) || vout < 0) throw new Error(`Invalid vout: ${vout}`);
  const res = await fetchWithTimeout(`${ordBase()}/output/${encodeURIComponent(txid)}:${vout}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Ord API error for ${txid}:${vout}: ${res.status}`);
  return res.json();
}
```

In `next.config.ts`, add the local ord origin to CSP `connect-src` (so the browser can reach it on testnet4):

```ts
"connect-src 'self' https://mempool.space https://*.mempool.space https://mempool.emzy.de https://memepool.space https://ordinals.com http://127.0.0.1:8080",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api/__tests__/ord.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/ord.ts src/lib/api/__tests__/ord.test.ts next.config.ts
git commit -m "feat(ord): per-network base + health guard (assertOrdHealthy)"
```

---

## Task 3: Inscription offset resolver + output→assets mapping

**Files:**
- Modify: `src/lib/api/ord.ts`
- Modify: `src/types/index.ts` (extend `OrdOutputResponse` with `runes` value shape if needed)
- Test: `src/lib/api/__tests__/ordAssets.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/api/__tests__/ordAssets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { offsetFromSatpoint, outputToAssets } from '../ord';

describe('offsetFromSatpoint', () => {
  it('parses txid:vout:offset', () => {
    expect(offsetFromSatpoint('ea1cf4c7586eb19171b5205c0827cc3fc905d5682267e84ebc2339ac9779c377:0:0')).toBe(0);
    expect(offsetFromSatpoint('420acce8...:3:4126')).toBe(4126);
  });
});

describe('outputToAssets', () => {
  it('maps an inscription with its offset', () => {
    const out = { value: 13685, inscriptions: ['7c16f5d1...i0'], runes: {} };
    const assets = outputToAssets(out, () => 4126);
    expect(assets).toEqual([{ kind: 'inscription', id: '7c16f5d1...i0', offset: 4126 }]);
  });
  it('maps a rune with amount + divisibility', () => {
    const out = { value: 546, inscriptions: [], runes: { DUMMY: { amount: 1000000000, divisibility: 0, symbol: 'd' } } };
    const assets = outputToAssets(out, () => 0);
    expect(assets).toEqual([{ kind: 'rune', name: 'DUMMY', amount: 1000000000n, divisibility: 0 }]);
  });
  it('maps a co-located rune + inscription', () => {
    const out = { value: 546, inscriptions: ['abc...i0'], runes: { PIZZA: { amount: 5, divisibility: 2, symbol: 'p' } } };
    const assets = outputToAssets(out, () => 0);
    expect(assets).toContainEqual({ kind: 'inscription', id: 'abc...i0', offset: 0 });
    expect(assets).toContainEqual({ kind: 'rune', name: 'PIZZA', amount: 5n, divisibility: 2 });
  });
  it('returns [] for a plain output', () => {
    expect(outputToAssets({ value: 10000, inscriptions: [], runes: {} }, () => 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api/__tests__/ordAssets.test.ts`
Expected: FAIL — `offsetFromSatpoint`, `outputToAssets` not exported.

- [ ] **Step 3: Write minimal implementation**

First ensure `OrdOutputResponse.runes` has a value shape in `src/types/index.ts` (find the existing `OrdOutputResponse` and set its `runes` type):

```ts
export interface OrdRuneBalance { amount: number; divisibility: number; symbol?: string }
export interface OrdOutputResponse {
  value: number;
  inscriptions: string[];
  runes: Record<string, OrdRuneBalance>;
  // ...keep any existing fields (address, spent, sat_ranges, etc.)
}
```

In `src/lib/api/ord.ts` add:

```ts
import type { Asset } from '@/types';

/** Parse the trailing offset from an ord satpoint `txid:vout:offset`. */
export function offsetFromSatpoint(satpoint: string): number {
  const parts = satpoint.split(':');
  const offset = Number(parts[parts.length - 1]);
  if (!Number.isFinite(offset) || offset < 0) throw new Error(`Bad satpoint offset: ${satpoint}`);
  return offset;
}

/** Resolve an inscription's offset within its current output via ord.
 *  NOTE local ord 0.27.1 omits `output`; derive from `satpoint` (runes-etch #12 lesson). */
export async function getInscriptionOffset(id: string): Promise<number> {
  const res = await fetchWithTimeout(`${ordBase()}/inscription/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ord /inscription/${id} ${res.status}`);
  const info = (await res.json()) as { satpoint: string };
  return offsetFromSatpoint(info.satpoint);
}

/** Map an ord output to the asset list. `resolveOffset(id)` supplies each inscription's offset. */
export function outputToAssets(
  output: { inscriptions: string[]; runes: Record<string, { amount: number; divisibility: number }> },
  resolveOffset: (id: string) => number,
): Asset[] {
  const assets: Asset[] = [];
  for (const id of output.inscriptions) {
    assets.push({ kind: 'inscription', id, offset: resolveOffset(id) });
  }
  for (const [name, bal] of Object.entries(output.runes)) {
    assets.push({ kind: 'rune', name, amount: BigInt(bal.amount), divisibility: bal.divisibility });
  }
  return assets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api/__tests__/ordAssets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/ord.ts src/lib/api/__tests__/ordAssets.test.ts src/types/index.ts
git commit -m "feat(ord): inscription offset resolver + outputToAssets mapping"
```

---

## Task 4: Rewrite the scanner to ord-only (both networks), fail-closed

**Files:**
- Modify: `src/lib/scanner/label.ts`
- Test: `src/lib/scanner/__tests__/scan.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/scanner/__tests__/scan.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ord from '@/lib/api/ord';
import { scanAndLabelUtxos } from '../label';
import type { Utxo } from '@/types';

function u(txid: string, vout: number, value: number, source: 'taproot' | 'payment'): Utxo & { source: 'taproot' | 'payment' } {
  return { txid, vout, value, status: { confirmed: true }, source };
}

beforeEach(() => vi.restoreAllMocks());

describe('scanAndLabelUtxos (ord-only)', () => {
  it('labels a transferred inscription on a payment UTXO with its offset (the parent case)', async () => {
    vi.spyOn(ord, 'assertOrdHealthy').mockResolvedValue();
    vi.spyOn(ord, 'fetchOrdOutput').mockResolvedValue({ value: 13685, inscriptions: ['7c16f5d1...i0'], runes: {} } as never);
    vi.spyOn(ord, 'getInscriptionOffset').mockResolvedValue(4126);

    const [labeled] = await scanAndLabelUtxos([u('420acce8'.padEnd(64, '0'), 3, 13685, 'payment')], true);

    expect(labeled.label).toBe('inscription');
    expect(labeled.source).toBe('payment');
    expect(labeled.assets).toEqual([{ kind: 'inscription', id: '7c16f5d1...i0', offset: 4126 }]);
    expect(labeled.inscriptionId).toBe('7c16f5d1...i0');
  });

  it('fails closed to unknown when ord errors on a UTXO', async () => {
    vi.spyOn(ord, 'assertOrdHealthy').mockResolvedValue();
    vi.spyOn(ord, 'fetchOrdOutput').mockRejectedValue(new Error('ord 500'));
    const [labeled] = await scanAndLabelUtxos([u('b'.repeat(64), 0, 5000, 'payment')], true);
    expect(labeled.label).toBe('unknown');
    expect(labeled.assets).toEqual([]);
  });

  it('throws before scanning when ord is wedged (testnet)', async () => {
    vi.spyOn(ord, 'assertOrdHealthy').mockRejectedValue(new Error('Local ord is wedged'));
    await expect(scanAndLabelUtxos([u('c'.repeat(64), 0, 5000, 'payment')], true)).rejects.toThrow('wedged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scanner/__tests__/scan.test.ts`
Expected: FAIL — scanner still uses the tx-decode path / does not call ord helpers.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/lib/scanner/label.ts` with:

```ts
import type { Utxo, LabeledUtxo, UtxoLabel, Asset } from '@/types';
import {
  assertOrdHealthy, fetchOrdOutput, getInscriptionOffset, outputToAssets, isOrdTestnet,
} from '@/lib/api/ord';

/** Derive the summary `label` from an asset list. */
function deriveLabel(assets: Asset[]): UtxoLabel {
  if (assets.length === 0) return 'plain';
  if (assets.some((a) => a.kind === 'inscription')) return 'inscription';
  return 'rune';
}

/**
 * Scan + label every UTXO authoritatively via ord (both networks). On testnet4,
 * ord must be healthy first (fail-closed). A per-UTXO ord failure yields the
 * `unknown` label (excluded from sorting) — never a silent `plain`.
 */
export async function scanAndLabelUtxos(
  utxos: Array<Utxo & { source: 'taproot' | 'payment' }>,
  isTestnet: boolean,
  onProgress?: (scanned: number, total: number) => void,
): Promise<LabeledUtxo[]> {
  if (isTestnet) await assertOrdHealthy();

  const total = utxos.length;
  const labeled: LabeledUtxo[] = [];
  let scanned = 0;

  for (const utxo of utxos) {
    let assets: Asset[] = [];
    let label: UtxoLabel;
    try {
      const output = await fetchOrdOutput(utxo.txid, utxo.vout);
      const offsets = new Map<string, number>();
      for (const id of output.inscriptions) offsets.set(id, await getInscriptionOffset(id));
      assets = outputToAssets(output, (id) => offsets.get(id) ?? 0);
      label = deriveLabel(assets);
    } catch {
      assets = [];
      label = 'unknown';
    }

    const inscription = assets.find((a) => a.kind === 'inscription');
    const rune = assets.find((a) => a.kind === 'rune');
    labeled.push({
      ...utxo,
      label,
      assets,
      runeName: rune && rune.kind === 'rune' ? rune.name : undefined,
      inscriptionId: inscription && inscription.kind === 'inscription' ? inscription.id : undefined,
      hasInscription: inscription ? true : undefined,
    });

    scanned++;
    onProgress?.(scanned, total);
  }

  return labeled;
}

// isOrdTestnet re-exported usage note: callers set the network via setOrdNetwork
// before scanning; isTestnet is also passed in for the health gate.
void isOrdTestnet;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/scanner/__tests__/scan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scanner/label.ts src/lib/scanner/__tests__/scan.test.ts
git commit -m "feat(scanner): ord-only labeling on both networks, fail-closed unknown"
```

---

## Task 5: Delete the dead tx-decode path + reconcile callers

**Files:**
- Delete: `src/lib/scanner/inscription.ts`, `src/lib/scanner/__tests__/inscription.test.ts`
- Delete: `src/lib/scanner/runestone.ts`, `src/lib/scanner/__tests__/runestone.test.ts`
- Delete: `src/lib/scanner/__tests__/label.test.ts` (tested the removed decode path, incl. the in-flight additions)
- Modify: `src/app/page.tsx` (call `setOrdNetwork` before scan), `src/components/useSortPlan.ts` (relax the now-obsolete testnet fee floor)

- [ ] **Step 1: Delete the decoder modules and their tests**

```bash
cd /f/Users/akhil/Main/sort-utxo
git rm src/lib/scanner/inscription.ts src/lib/scanner/__tests__/inscription.test.ts \
       src/lib/scanner/runestone.ts src/lib/scanner/__tests__/runestone.test.ts \
       src/lib/scanner/__tests__/label.test.ts
```

- [ ] **Step 2: Set ord network at scan time**

In `src/app/page.tsx`, find where the scan begins (near `setMempoolNetwork(w.paymentAddress)`) and add the ord network call alongside it:

```ts
import { setOrdNetwork } from '@/lib/api/ord';
// ...inside the scan handler, right after setMempoolNetwork(w.paymentAddress):
setOrdNetwork(w.paymentAddress);
```

- [ ] **Step 3: Relax the obsolete testnet fee floor**

In `src/components/useSortPlan.ts`, detection is now authoritative on testnet4, so the heuristic small-UTXO exclusion is no longer a safety requirement. Replace the testnet floor guard with an asset-aware guard (never spend an asset-bearing or unknown UTXO as fee):

```ts
  const availableFeeUtxos = utxos.filter((u) => {
    if (classifyPlacement(u) !== 'correct' || u.label !== 'plain') return false;
    if (selectedKeys.has(`${u.txid}:${u.vout}`)) return false;
    return true;
  });
```

Remove the now-unused `TESTNET_SAFE_FEE_UTXO_MIN` constant and `isTestnetAddress` helper if nothing else references them (check with the grep below).

- [ ] **Step 4: Verify nothing references the deleted modules**

Run: `grep -rn "scanner/inscription\|scanner/runestone\|labelUtxoFromTx\|hasInscriptionEnvelope\|isRunestoneOutput\|TESTNET_SAFE_FEE_UTXO_MIN" src`
Expected: no output (all references removed).

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all tests pass (the deleted decode-path tests are gone; new ord-based tests pass).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(scanner): delete dead tx-decode path; wire setOrdNetwork; ord-authoritative fee floor"
```

---

## Task 6: End-to-end detection check against the live parent

**Files:** none (manual verification with the running stack)

- [ ] **Step 1: Confirm stack health**

Run: `& 'F:\Users\akhil\Main\testnet4\verify.ps1'` — ord at tip, `unrecoverably_reorged: false`.

- [ ] **Step 2: Confirm `.env.local` points testnet ord at the local node**

Ensure `F:\Users\akhil\Main\sort-utxo\.env.local` contains `NEXT_PUBLIC_ORD_BASE_TESTNET=http://127.0.0.1:8080` and `NEXT_PUBLIC_CSP_DEV=1`. Restart the dev server (`:3001`) if changed (env + next.config changes need a restart).

- [ ] **Step 3: Browser check**

Connect the testnet4 wallet on `http://localhost:3001`, scan. Verify the segwit UTXO `420acce8…:3` now shows **Inscription (7c16f5d1…)** on the **payment** row and is flagged **misplaced / recommended to move to taproot** (auto-selected). Before this plan it showed as **Plain**.

- [ ] **Step 4: Record the result**

Append a one-line note to `docs/superpowers/specs/2026-06-02-sort-utxo-redesign-design.md` §12 acceptance criteria #1: "✅ verified <date> — parent labels as inscription-on-segwit." Commit:

```bash
git add docs/superpowers/specs/2026-06-02-sort-utxo-redesign-design.md
git commit -m "docs: mark detection acceptance #1 verified"
```

---

## Plan-level Definition of Done

- `tsc --noEmit` clean; `vitest run` all green.
- The testnet4 scanner queries ord only; the tx-decode path and its modules are deleted.
- A transferred inscription/rune on a segwit UTXO is correctly labeled (with offset in `assets`) and flagged misplaced.
- ord unreachable/wedged on testnet4 blocks the scan with a clear message; a per-UTXO ord error yields `unknown` (excluded), never `plain`.
- The stranded parent `7c16f5d1…i0` is visible and recommended for the move — unblocking Plan 2 (the sat-ledger builder) to actually rescue it.
