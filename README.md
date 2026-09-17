# Sort UTXO

A browser app for Bitcoin Ordinals users who need to **inspect**, **rearrange**, and **compose** UTXOs safely — with wallet signing in Xverse (or Leather) and **no private keys in the app**.

Connect once. Use **Sorting** or **Compose** from the footer. The app builds a PSBT, you approve every input and output in your wallet, then the app verifies the signed transaction against the plan and broadcasts it.

---

## What you can do

| Feature | Status | What it does |
| --- | --- | --- |
| **Sorting** | Live | Finds inscription/rune-bearing UTXOs that are on the wrong address type and builds a sat-aware sort transaction so assets land on clean taproot outputs. |
| **Compose** | Live | Blank UTXO composer: pick spend (and fee) UTXOs, define outputs, preview FIFO sat flow, optional OP_RETURN and vanity TXID, then sign and broadcast. |
| **Consolidation** | Not live | Multi-account consolidation UI is present but not enabled yet. |

### Sorting (home page)

Use this when inscriptions (or other assets) ended up on payment/segwit UTXOs and you want them isolated on taproot with a clear fee path.

1. Connect your wallet (Ordinals + Payment addresses).
2. Wait for the scan to label UTXOs (misplaced vs correct).
3. Select which UTXOs to sort (misplaced ones are pre-selected).
4. Pick a fee rate.
5. Optionally grind a **vanity TXID** (prefix/suffix) — this locks an `nLockTime` into the same plan.
6. Click **Sort**, review the full transaction in your wallet, approve.
7. The app checks that the signed TXID and outputs match the plan, then broadcasts.

### Compose (`/compose`)

Use this when you want full control over a spend: which UTXOs go in, which outputs come out, and how sats flow.

1. Connect the same shared wallet.
2. Scan inventory (signet or mainnet, matching the wallet).
3. Choose spend inputs and payment-fee inputs (fee input is last).
4. Add output rows (amounts and destinations).
5. Optionally add OP_RETURN text and/or grind a vanity TXID.
6. Preview the FIFO sat layout.
7. Sign in the wallet (`broadcast: false`), then the app verifies and broadcasts.

**Compose refuses rune-bearing spends** so runes are not silently burned or mis-routed.

---

## Security model (read this)

- **Private keys never leave your wallet.** The app only sees addresses and public keys.
- Signing uses the wallet PSBT APIs. For Sorting and Compose, the wallet is asked to **sign without broadcasting**.
- After you sign, the app:
  - compares the signed TXID to the planned unsigned TXID,
  - checks vanity targets when locked,
  - checks output values against the plan,
  - then broadcasts the hex itself via public Esplora/mempool APIs.
- Default sighash is **SIGHASH_ALL** (bitcoinjs-lib default; no custom sighash is set).
- Vanity grinding only varies **nLockTime** on an unsigned template (inputs stay final so locktime is not consensus-enforced). Changing selection, fee, or outputs clears a locked vanity.

You are still spending real coins. Review the wallet prompt carefully before approving. Prefer **signet** while learning the tool.

---

## Networks

- **Sorting** follows the connected wallet (mainnet vs testnet-style addresses).
- **Compose** is oriented around **signet** and **mainnet** (not testnet4).
- Chain data comes from public Esplora/mempool endpoints; Ordinals labeling uses an ord HTTP API where configured.

---

## Quick start

Requirements: Node.js 20+ (recommended), npm, and a Bitcoin wallet extension such as **Xverse** (Leather is also supported).

```bash
git clone https://github.com/Blazekachu/sort-utxo.git
cd sort-utxo
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run unit tests |
| `npm run lint` | ESLint |

Optional env (Compose / local ord):

- `NEXT_PUBLIC_ORD_BASE_SIGNET` — base URL for a signet ord instance (local default often `http://127.0.0.1:8080`).

---

## How a transaction flows

```text
Plan (sat ledger / compose planner)
        ↓
Build PSBT  (+ optional vanity nLockTime)
        ↓
Wallet signs  (broadcast = false)
        ↓
Verify TXID + outputs (+ vanity)
        ↓
Broadcast hex via Esplora
```

If verification fails, nothing is broadcast.

---

## Stack

- Next.js + React + TypeScript + Tailwind
- bitcoinjs-lib `7.0.1`, sats-connect, Zustand

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE).

MIT fits this codebase: it is original application software distributed with source, and you (and others) may use, modify, and redistribute it under the MIT terms. Dependencies keep their own licenses; the MIT grant covers **this repository’s** code.

---

## Disclaimer

This software is provided **as is**, with no warranty. Bitcoin transactions are irreversible. Use at your own risk. The authors are not responsible for lost funds, mis-signed transactions, or network/API outages.
