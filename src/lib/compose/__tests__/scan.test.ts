import { describe, it, expect } from 'vitest';
import { mapOrdOutputToCompose } from '../scan';
import type { ComposeOrdOutput } from '../ord';

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

  it('treats omitted inscriptions and runes as empty', () => {
    const u = mapOrdOutputToCompose({
      txid, vout: 0, value: 1000, confirmed: true,
      address: 'tb1qsegwit', source: 'payment',
      output: {} as ComposeOrdOutput,
      inscriptionOffsets: new Map(),
    });
    expect(u.kind).toBe('plain');
    expect(u.satRanges).toBeNull();
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
