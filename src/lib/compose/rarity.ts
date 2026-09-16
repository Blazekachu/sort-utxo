export type RarityName = 'mythic' | 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common';

export interface RarityTag {
  sat: bigint;
  rarity: RarityName;
}

const COIN = 100_000_000n;
const HALVING_INTERVAL = 210_000;
const DIFFCHANGE_INTERVAL = 2016;
const CYCLE_BLOCKS = 1_260_000;

function subsidy(epoch: number): bigint {
  if (epoch >= 64) return 0n;
  return (50n * COIN) >> BigInt(epoch);
}

function satToHeightOffset(sat: bigint): { height: number; offset: number } {
  let remaining = sat;
  for (let epoch = 0; epoch < 64; epoch++) {
    const sub = subsidy(epoch);
    if (sub === 0n) break;
    const epochSats = sub * BigInt(HALVING_INTERVAL);
    if (remaining < epochSats) {
      const heightInEpoch = Number(remaining / sub);
      const offset = Number(remaining % sub);
      return { height: epoch * HALVING_INTERVAL + heightInEpoch, offset };
    }
    remaining -= epochSats;
  }
  throw new Error(`sat beyond last subsidy: ${sat}`);
}

function firstSatOfBlock(height: number): bigint {
  let sat = 0n;
  const epoch = Math.floor(height / HALVING_INTERVAL);
  for (let e = 0; e < epoch; e++) {
    sat += subsidy(e) * BigInt(HALVING_INTERVAL);
  }
  const heightInEpoch = height - epoch * HALVING_INTERVAL;
  sat += subsidy(epoch) * BigInt(heightInEpoch);
  return sat;
}

export function satRarity(sat: bigint): RarityName {
  if (sat === 0n) return 'mythic';
  const { height, offset } = satToHeightOffset(sat);
  if (offset !== 0) return 'common';
  if (height % CYCLE_BLOCKS === 0) return 'legendary';
  if (height % HALVING_INTERVAL === 0) return 'epic';
  if (height % DIFFCHANGE_INTERVAL === 0) return 'rare';
  return 'uncommon';
}

export function tagsInRange(start: bigint, endExclusive: bigint): RarityTag[] {
  const tags: RarityTag[] = [];
  if (endExclusive <= start) return tags;

  const seen = new Set<string>();
  const push = (sat: bigint) => {
    const rarity = satRarity(sat);
    if (rarity === 'common') return;
    const key = sat.toString();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push({ sat, rarity });
  };

  push(start);

  const { height: h0 } = satToHeightOffset(start);
  const { height: h1 } = satToHeightOffset(endExclusive - 1n);
  for (let h = h0; h <= h1; h++) {
    const first = firstSatOfBlock(h);
    if (first >= start && first < endExclusive) push(first);
  }
  return tags;
}
