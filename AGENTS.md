# AGENTS.md — sort-utxo

Full context: `F:\Users\akhil\Main\AI_HANDOVER\projects\sort-utxo\` and `AI_HANDOVER\AI_OPERATOR_MANUAL.md`.

## What this is
Self-custodial, client-side-only web tool: sort/separate a wallet's UTXOs (segwit vs taproot) with rune/inscription detection, rebuilt in a single transaction. Next.js 16 / React 19 / TS / Vitest. **Local-only repo (no remote).**

## Rules
- 📌 **Never bump `bitcoinjs-lib`** off exact `7.0.1` (breaks vanity/TX caching across the BTC-tool family).
- Self-custodial invariant: never move a private key/seed off the client.
- Sensitive area: `src/lib/tx/` offset / sat-ledger logic — add edge-case tests when changing.
- Xverse uses `wallet_connect` (not `getAddresses`, which 2.3+ rejects); keep CSP allowing `fonts.googleapis.com`.

## Run / test (from the F:\ path)
- `npm run dev` · `npm run build` · `npm test` (vitest). Prove TX changes on regtest → testnet4 before claiming done.
- Central logic: `src/components/useSortPlan.ts`, `src/lib/scanner/`, `src/lib/tx/`.
- Commit as `Blazekachu <237100058+Blazekachu@users.noreply.github.com>`; one fix = one commit.
