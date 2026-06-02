import { it, expect } from 'vitest';
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
