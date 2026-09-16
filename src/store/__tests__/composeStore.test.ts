import { describe, it, expect, beforeEach } from 'vitest';
import { useComposeStore } from '../composeStore';
import type { ComposeUtxo } from '@/lib/compose/types';

const runeUtxo: ComposeUtxo = {
  txid: 'a'.repeat(64),
  vout: 0,
  value: 1000,
  confirmed: true,
  address: 'tb1ptest',
  addressKind: 'taproot',
  source: 'taproot',
  kind: 'rune',
  assets: [{ kind: 'rune', name: 'Z', amount: 1n, divisibility: 0 }],
  satRanges: [{ start: 0n, endExclusive: 1000n, offset: 0, length: 1000, rarityTags: [] }],
};

describe('composeStore', () => {
  beforeEach(() => {
    useComposeStore.getState().reset();
  });

  it('does not add rune UTXOs to spendKeys', () => {
    useComposeStore.getState().setUtxos([runeUtxo]);
    useComposeStore.getState().toggleSpend(`${runeUtxo.txid}:${runeUtxo.vout}`);
    expect(useComposeStore.getState().spendKeys.size).toBe(0);
  });
});
