import { describe, it, expect } from 'vitest';
import { dustLimitForAddress } from '../dust';

describe('dustLimitForAddress', () => {
  it('uses 330 for taproot', () => {
    expect(dustLimitForAddress('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr')).toBe(330);
  });
  it('uses 294 for native segwit', () => {
    expect(dustLimitForAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(294);
  });
  it('uses 546 for nested p2sh-p2wpkh', () => {
    expect(dustLimitForAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(546);
  });
});
