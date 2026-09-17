import { it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { buildSortPsbtFromLedger, type LedgerInput, type LedgerOutput } from '../satLedger';
import { plannedTxid, serializeForTxid } from '@/lib/compose/txid';

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

it('nLockTime is hashed into planned TXID and ends the grind template', () => {
  const inputs: LedgerInput[] = [
    { txid: 'a'.repeat(64), vout: 0, value: 4000, source: 'payment', inscriptionOffsets: [] },
  ];
  const outputs: LedgerOutput[] = [{ address: SEGWIT, value: 3000, kind: 'change' }];
  const base = {
    inputs, outputs, internalPubkey: new Uint8Array(32).fill(2), network: bitcoin.networks.bitcoin,
    taprootAddress: TAPROOT, paymentAddress: SEGWIT,
  };
  const { psbt: unlocked } = buildSortPsbtFromLedger(base);
  const { psbt: locked } = buildSortPsbtFromLedger({ ...base, nLockTime: 0x01020304 });
  expect(plannedTxid(unlocked)).not.toBe(plannedTxid(locked));
  const template = serializeForTxid(locked);
  expect(template.slice(-4)).toEqual(Uint8Array.from([0x04, 0x03, 0x02, 0x01]));
  expect(locked.txInputs[0].sequence).toBe(0xffffffff);
});

it('rebuilding with a ground locktime yields a matching vanity planned TXID', () => {
  const inputs: LedgerInput[] = [
    { txid: 'c'.repeat(64), vout: 1, value: 5000, source: 'payment', inscriptionOffsets: [] },
  ];
  const outputs: LedgerOutput[] = [{ address: SEGWIT, value: 4000, kind: 'change' }];
  const base = {
    inputs, outputs, internalPubkey: new Uint8Array(32).fill(3), network: bitcoin.networks.bitcoin,
    taprootAddress: TAPROOT, paymentAddress: SEGWIT,
  };
  const prefix = 'a';
  let found: number | null = null;
  let foundTxid = '';
  for (let n = 0; n < 256; n++) {
    const { psbt } = buildSortPsbtFromLedger({ ...base, nLockTime: n });
    const id = plannedTxid(psbt);
    if (id.startsWith(prefix)) {
      found = n;
      foundTxid = id;
      break;
    }
  }
  expect(found).not.toBeNull();
  const { psbt: again } = buildSortPsbtFromLedger({ ...base, nLockTime: found! });
  expect(plannedTxid(again)).toBe(foundTxid);
  expect(foundTxid.startsWith(prefix)).toBe(true);
});
