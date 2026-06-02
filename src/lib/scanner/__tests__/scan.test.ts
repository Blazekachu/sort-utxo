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
