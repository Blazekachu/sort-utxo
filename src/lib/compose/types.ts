import type { Asset } from '@/types';
import type { RarityTag } from './rarity';

export type ComposeUtxoKind = 'plain' | 'inscription' | 'rune' | 'unknown';
export type AddressKind = 'taproot' | 'p2wpkh' | 'p2sh-p2wpkh';

export interface SatRangeView {
  start: bigint;
  endExclusive: bigint;
  offset: number;
  length: number;
  rarityTags: RarityTag[];
}

export interface ComposeUtxo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  address: string;
  addressKind: AddressKind;
  source: 'taproot' | 'payment';
  kind: ComposeUtxoKind;
  assets: Asset[];
  satRanges: SatRangeView[] | null;
}
