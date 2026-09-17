import { describe, it, expect } from 'vitest';
import { parseComposeOrdStatus } from '../ord';

describe('parseComposeOrdStatus', () => {
  it('records sat_index from /status', () => {
    expect(parseComposeOrdStatus({
      height: 322429,
      chain: 'signet',
      unrecoverably_reorged: false,
      sat_index: false,
    })).toEqual({ ok: true, height: 322429, chain: 'signet', satIndex: false });
  });

  it('treats missing sat_index as false', () => {
    expect(parseComposeOrdStatus({
      height: 1,
      chain: 'signet',
      unrecoverably_reorged: false,
    })).toMatchObject({ ok: true, satIndex: false });
  });
});
