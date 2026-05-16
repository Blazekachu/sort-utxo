import { describe, it, expect } from 'vitest';
import { labelUtxoFromTx } from '../label';

function mockRuneTx(pointerVout: number): Record<string, unknown> {
  const pointerPayload = [0x16, pointerVout];
  const pushLen = pointerPayload.length;
  const scriptHex = '6a5d' + pushLen.toString(16).padStart(2, '0') + pointerPayload.map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    txid: 'a'.repeat(64),
    vout: [
      { scriptpubkey: '5120' + 'aa'.repeat(32), value: 546, scriptpubkey_type: 'v1_p2tr' },
      { scriptpubkey: scriptHex, value: 0, scriptpubkey_type: 'op_return' },
      { scriptpubkey: '0014' + 'bb'.repeat(20), value: 50000, scriptpubkey_type: 'v0_p2wpkh' },
    ],
    vin: [{ witness: ['deadbeef', 'cafebabe'] }],
  };
}

function mockInscriptionTx(): Record<string, unknown> {
  const scriptWithEnvelope = '20' + 'aa'.repeat(32) + 'ac' + '0063036f7264' + '0101' + '09746578742f706c61696e' + '0005' + '68656c6c6f' + '68';
  return {
    txid: 'b'.repeat(64),
    vout: [
      { scriptpubkey: '5120' + 'cc'.repeat(32), value: 546, scriptpubkey_type: 'v1_p2tr' },
      { scriptpubkey: '0014' + 'dd'.repeat(20), value: 40000, scriptpubkey_type: 'v0_p2wpkh' },
    ],
    vin: [{ witness: ['deadbeef', scriptWithEnvelope, 'c0' + 'ee'.repeat(32)] }],
  };
}

function mockPlainTx(): Record<string, unknown> {
  return {
    txid: 'c'.repeat(64),
    vout: [
      { scriptpubkey: '0014' + 'ff'.repeat(20), value: 100000, scriptpubkey_type: 'v0_p2wpkh' },
    ],
    vin: [{ witness: ['3044' + 'aa'.repeat(30), '02' + 'bb'.repeat(33)] }],
  };
}

describe('labelUtxoFromTx', () => {
  it('labels UTXO as rune when vout matches Runestone pointer', () => {
    const tx = mockRuneTx(0);
    const result = labelUtxoFromTx(tx, 0);
    expect(result.label).toBe('rune');
  });

  it('labels UTXO as plain when vout does not match pointer', () => {
    const tx = mockRuneTx(0);
    const result = labelUtxoFromTx(tx, 2);
    expect(result.label).toBe('plain');
  });

  it('labels UTXO as inscription when witness has envelope and vout is 0', () => {
    const tx = mockInscriptionTx();
    const result = labelUtxoFromTx(tx, 0);
    expect(result.label).toBe('inscription');
  });

  it('labels UTXO as plain from a normal TX', () => {
    const tx = mockPlainTx();
    const result = labelUtxoFromTx(tx, 0);
    expect(result.label).toBe('plain');
  });
});
