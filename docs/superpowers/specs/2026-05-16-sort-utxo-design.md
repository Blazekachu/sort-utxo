# Sort UTXO — Design Spec

**Date:** 2026-05-16
**Project:** sort-utxo (standalone)
**Location:** `C:\Users\akhil\Main\sort-utxo`

## Purpose

A self-custodial tool that scans a user's Bitcoin wallet and moves UTXOs to the correct address type:
- Rune and inscription UTXOs on segwit → move to taproot
- Plain sat UTXOs on taproot → move to segwit

The tool recommends which UTXOs are misplaced and lets the user sort them in a single transaction.

## Stack

- Next.js 16 + React 19 + Tailwind 4
- Zustand (state management)
- bitcoinjs-lib 7.0.1 (pinned, no caret)
- sats-connect + Leather (wallet integration)
- tiny-secp256k1
- No backend — fully client-side

## Network Support

- Mainnet and Testnet4
- Auto-detected from wallet address prefix (`bc1`/`tb1`)
- All mempool links use correct network URL

## Architecture

Single page app at `/`. No routing needed.

### Core Modules

```
src/
  lib/
    wallet/xverse.ts        — wallet connect/sign (Xverse + Leather)
    api/mempool.ts           — UTXO fetch, fee rates, broadcast, TX fetch
    api/ord.ts               — mainnet UTXO labeling via ordinals.com
    scanner/label.ts         — labeling orchestrator (ord on mainnet, TX decode on testnet4)
    scanner/runestone.ts     — lightweight Runestone OP_RETURN decoder (extract pointer)
    scanner/inscription.ts   — witness inscription envelope detector
    tx/sort.ts               — builds sort PSBT (mixed inputs, outputs to correct address)
  store/sortStore.ts         — Zustand store
  components/
    WalletBar.tsx            — connect/disconnect, show addresses
    UtxoTable.tsx            — UTXO list with status, type, recommendation, checkboxes
    FeeSelector.tsx          — fee rate picker (fast/medium/economy)
    SortButton.tsx           — build + sign + broadcast
    ScanProgress.tsx         — scanning progress bar
    StatusBanner.tsx         — success/error/info banners
  app/
    page.tsx                 — single page layout
    layout.tsx               — root layout, dark theme
```

## Data Flow

```
Connect Wallet
  → Get taprootAddress + paymentAddress + publicKey
  ↓
Fetch UTXOs from both addresses (mempool.space API)
  ↓
Label each UTXO:
  Mainnet:  ord API → ordinals.com/output/{txid}:{vout}
            Returns inscriptions[] and runes{} for each output
  Testnet4: fetch creating TX via mempool API
            Decode OP_RETURN for Runestone pointer field
            Check witness data for inscription envelope
  ↓
If ANY UTXO fails labeling → BLOCK
  Show error: "Could not identify {n} UTXOs. {reason}. Come back later."
  No proceed button.
  ↓
All labeled → classify:
  "misplaced": rune/inscription on segwit, OR plain on taproot
  "correct":   rune/inscription on taproot, OR plain on segwit
  ↓
Show UTXO table with recommendations
  ↓
User selects misplaced UTXOs to move (all selected by default)
  ↓
Build single PSBT:
  Inputs:  selected misplaced UTXOs (mixed segwit + taproot)
  Outputs: each rune/inscription UTXO → 546 sats to taprootAddress
           each plain UTXO → value to paymentAddress
           change → paymentAddress (segwit)
  Fee deducted from largest plain UTXO or separate funding UTXO
  ↓
Wallet signs (sats-connect or Leather) → broadcast → show TXID
```

## UTXO Labeling

### Mainnet — Ord API

For each UTXO, query `https://ordinals.com/output/{txid}:{vout}`:
- Response includes `inscriptions[]` and `runes{}` fields
- If `inscriptions` is non-empty → label "inscription"
- If `runes` is non-empty → label "rune"
- If both inscriptions and runes present → label "inscription" (treat as inscription, it stays on taproot either way)
- If both empty → label "plain"
- Rate limit: 100ms delay between calls to avoid throttling

### Testnet4 — TX Decode

No ord indexer available. For each UTXO, fetch the creating transaction from `mempool.space/testnet4/api/tx/{txid}`:

**Rune detection:**
1. Check if TX has an OP_RETURN output starting with `OP_13` (0x5d) — Runestone marker
2. Decode the Runestone varint fields to extract the `pointer` value
3. If the UTXO's vout matches the pointer → label "rune"

**Inscription detection:**
1. Check the witness data of the TX input that created the UTXO
2. Look for inscription envelope pattern: `OP_FALSE OP_IF OP_PUSH "ord" ... OP_ENDIF`
3. If found and output index matches → label "inscription"

**Fallback:** If decode fails for any UTXO → block the entire operation.

## Transaction Building

### Single TX Strategy

One PSBT handles all movements in both directions:

**Inputs:**
- All selected misplaced UTXOs (mixed P2WPKH + P2TR inputs)
- One additional plain UTXO for fee funding if needed

**Outputs:**
- For each rune/inscription UTXO being moved: 546 sats to `taprootAddress`
- For each plain UTXO being moved: full value to `paymentAddress`
- Change output to `paymentAddress` (segwit) if change >= 546 sats

**Important rules:**
- Never consolidate rune/inscription dust UTXOs — each gets its own 546-sat output to preserve the asset binding
- Plain UTXOs can be consolidated into fewer outputs
- Fee is deducted from plain sat value (never from dust outputs)
- If not enough plain sats to cover fee → error, don't proceed

**Input signing:**
- P2WPKH inputs: signed with `paymentAddress`
- P2TR inputs: signed with `taprootAddress` using `tapInternalKey`
- sats-connect `signInputs` map groups indexes by address

## UI Layout

Single page, dark theme (consistent with runes-etch).

### Sections (top to bottom)

**Header:**
- "Sort UTXO" title
- Network badge (Mainnet / Testnet4)

**Wallet Bar:**
- Connect button (Xverse / Leather picker)
- After connect: shows taproot + segwit addresses, disconnect button

**Scan Section:**
- Auto-scans on wallet connect
- Progress bar: "Scanning {n}/{total} UTXOs..."
- On failure: red banner with reason, no proceed button

**UTXO Table:**

| Status | UTXO | Type | Current | Should Be | Value |
|--------|------|------|---------|-----------|-------|
| Misplaced | `abc...def:0` | Rune (RUNENAME) | Segwit | Taproot | 546 sats |
| Misplaced | `xyz...123:2` | Plain | Taproot | Segwit | 50,000 sats |
| Correct | `aaa...bbb:1` | Inscription | Taproot | Taproot | 546 sats |

- Misplaced rows: checkbox (checked by default), highlighted
- Correct rows: dimmed, no checkbox
- Rune UTXOs show rune name
- Inscription UTXOs show inscription ID (truncated)

**Fee Section:**
- Appears only when >= 1 UTXO selected
- Fee rate selector: Fast / Medium / Economy
- Total fee estimate in sats
- Warning if fee environment is high (>500 sat/vB)

**Sort Button:**
- "Sort {n} UTXOs" → triggers PSBT build + wallet sign
- Loading state during signing
- Success: green banner with TXID linked to correct mempool URL
- Error: red banner with message

**Status Banners:**
- All sorted: "All UTXOs are already sorted correctly!"
- Empty wallet: "No UTXOs found."
- Unconfirmed skipped: "{n} unconfirmed UTXOs skipped — wait for confirmation."
- Scan failure: "Could not identify {n} UTXOs — {reason}. Come back later."

## Edge Cases

1. **Dust preservation:** Rune/inscription UTXOs are 546 sats. Each gets its own output — never consolidate.
2. **Fee funding:** Fee deducted from largest plain UTXO. If only dust UTXOs selected with no plain sats, show error.
3. **No misplaced UTXOs:** Green banner, no action needed.
4. **Unconfirmed UTXOs:** Excluded from scan. Note shown if any exist.
5. **Empty wallet:** "No UTXOs found" message.
6. **Rate limiting (mainnet):** 100ms delay between ord API calls.
7. **Unknown UTXOs:** If any UTXO can't be labeled, block entire operation with explanation.
8. **Wallet without taproot (Leather testnet):** Handle gracefully — show warning that sorting requires both address types.
9. **Mempool link correctness:** All TX links use testnet4 URL for testnet addresses.

## Wallet Integration

Copied from runes-etch with adaptations:
- Xverse via sats-connect v4.2.1 (`getAddresses`, `signPsbt`)
- Leather via `window.LeatherProvider` JSON-RPC
- Provider stored in localStorage
- Address validation on connect
- Public key validation (32-33 byte hex)

## API Endpoints

| Service | Endpoint | Purpose |
|---------|----------|---------|
| mempool.space | `GET /api/address/{addr}/utxo` | Fetch UTXOs |
| mempool.space | `GET /api/v1/fees/recommended` | Fee rates |
| mempool.space | `GET /api/tx/{txid}` | TX data for testnet labeling |
| mempool.space | `POST /api/tx` | Broadcast signed TX |
| ordinals.com | `GET /output/{txid}:{vout}` | UTXO labeling (mainnet) |

Testnet4 base: `mempool.space/testnet4/api`
