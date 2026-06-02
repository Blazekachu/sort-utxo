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
