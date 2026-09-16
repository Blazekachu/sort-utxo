import { describe, it, expect } from 'vitest';
import { satRarity, tagsInRange } from '../rarity';

describe('satRarity', () => {
  it('tags sat 0 as mythic', () => {
    expect(satRarity(0n)).toBe('mythic');
  });
  it('tags a non-first sat of block 0 as common', () => {
    expect(satRarity(1n)).toBe('common');
  });
  it('tags the first sat of block 1 as uncommon (50 BTC coinbase)', () => {
    expect(satRarity(5_000_000_000n)).toBe('uncommon');
  });
  it('does not tag the second sat of block 1 as uncommon', () => {
    expect(satRarity(5_000_000_001n)).toBe('common');
  });
});

describe('tagsInRange', () => {
  it('finds an uncommon sat inside a longer common range', () => {
    const tags = tagsInRange(4_999_999_990n, 5_000_000_010n);
    expect(tags.some((t) => t.sat === 5_000_000_000n && t.rarity === 'uncommon')).toBe(true);
  });
});
