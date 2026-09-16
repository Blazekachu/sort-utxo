import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setComposeMempoolNetwork, getComposeMempoolBases } from '../mempool';

afterEach(() => vi.unstubAllGlobals());

describe('setComposeMempoolNetwork', () => {
  it('selects signet bases, none of which contain testnet4', () => {
    setComposeMempoolNetwork('signet');
    const bases = getComposeMempoolBases();
    expect(bases.some((b) => b.includes('/signet/'))).toBe(true);
    expect(bases.some((b) => b.includes('testnet4'))).toBe(false);
  });
  it('selects mainnet bases', () => {
    setComposeMempoolNetwork('mainnet');
    const bases = getComposeMempoolBases();
    expect(bases.every((b) => !b.includes('/signet/') && !b.includes('testnet4'))).toBe(true);
  });
});

describe('isolation', () => {
  it('does not import Sort mempool', () => {
    const src = readFileSync(resolve(__dirname, '../mempool.ts'), 'utf8');
    expect(src).not.toMatch(/lib\/api\/mempool/);
    expect(src).not.toMatch(/setMempoolNetwork/);
  });
});
