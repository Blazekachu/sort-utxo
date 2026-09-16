import { describe, it, expect } from 'vitest';
import { verifySignedTx } from '../signVerify';

describe('verifySignedTx', () => {
  it('throws when signed txid does not match planned', () => {
    expect(() => verifySignedTx({
      signedTxid: 'aa'.repeat(32),
      plannedTxid: 'bb'.repeat(32),
    })).toThrow(/not broadcasting/i);
  });

  it('throws when vanity target mismatches', () => {
    expect(() => verifySignedTx({
      signedTxid: 'aa'.repeat(32),
      plannedTxid: 'aa'.repeat(32),
      vanityTarget: { prefix: 'dead', suffix: '' },
    })).toThrow(/not broadcasting/i);
  });

  it('accepts a matching txid', () => {
    expect(() => verifySignedTx({
      signedTxid: 'aa'.repeat(32),
      plannedTxid: 'aa'.repeat(32),
    })).not.toThrow();
  });
});
