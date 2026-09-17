import { describe, it, expect, beforeEach } from 'vitest';
import { useComposeStore } from '../composeStore';
import type { ComposeUtxo } from '@/lib/compose/types';

function plain(txid: string, vout: number, value: number, source: 'taproot' | 'payment' = 'payment'): ComposeUtxo {
  return {
    txid,
    vout,
    value,
    confirmed: true,
    address: source === 'taproot' ? 'tb1ptest' : 'tb1qpay',
    addressKind: source === 'taproot' ? 'taproot' : 'p2wpkh',
    source,
    kind: 'plain',
    assets: [],
    satRanges: null,
  };
}

const runeUtxo: ComposeUtxo = {
  ...plain('a'.repeat(64), 0, 1000, 'taproot'),
  kind: 'rune',
  assets: [{ kind: 'rune', name: 'Z', amount: 1n, divisibility: 0 }],
};

describe('composeStore input order', () => {
  beforeEach(() => {
    useComposeStore.getState().reset();
  });

  it('does not add rune UTXOs', () => {
    useComposeStore.getState().setUtxos([runeUtxo]);
    useComposeStore.getState().toggleInput(`${runeUtxo.txid}:${runeUtxo.vout}`);
    expect(useComposeStore.getState().inputOrder).toEqual([]);
  });

  it('appends on select so click order becomes vin order', () => {
    const upper = plain('aa'.repeat(32), 0, 4590);
    const lower = plain('bb'.repeat(32), 1, 4000);
    useComposeStore.getState().setUtxos([upper, lower]);
    useComposeStore.getState().toggleInput(`${lower.txid}:${lower.vout}`);
    useComposeStore.getState().toggleInput(`${upper.txid}:${upper.vout}`);
    expect(useComposeStore.getState().inputOrder).toEqual([
      `${lower.txid}:${lower.vout}`,
      `${upper.txid}:${upper.vout}`,
    ]);
  });

  it('moves a selected input up and down', () => {
    const a = plain('aa'.repeat(32), 0, 1000);
    const b = plain('bb'.repeat(32), 1, 2000);
    useComposeStore.getState().setUtxos([a, b]);
    useComposeStore.getState().toggleInput(`${a.txid}:${a.vout}`);
    useComposeStore.getState().toggleInput(`${b.txid}:${b.vout}`);
    useComposeStore.getState().moveInput(`${b.txid}:${b.vout}`, 'up');
    expect(useComposeStore.getState().inputOrder[0]).toBe(`${b.txid}:${b.vout}`);
    useComposeStore.getState().moveInput(`${b.txid}:${b.vout}`, 'down');
    expect(useComposeStore.getState().inputOrder[1]).toBe(`${b.txid}:${b.vout}`);
  });
});
