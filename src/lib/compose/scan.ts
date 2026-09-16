import type { Asset, Utxo } from '@/types';
import type { ComposeChain } from './network';
import { tagsInRange } from './rarity';
import {
  assertComposeOrdHealthy,
  fetchComposeOrdOutput,
  getComposeInscriptionOffset,
  type ComposeOrdOutput,
} from './ord';
import type { AddressKind, ComposeUtxo, ComposeUtxoKind, SatRangeView } from './types';

export function classifyAddressKind(address: string): AddressKind {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) return 'taproot';
  if (address.startsWith('3') || address.startsWith('2')) return 'p2sh-p2wpkh';
  return 'p2wpkh';
}

function deriveKind(output: ComposeOrdOutput): ComposeUtxoKind {
  if (Object.keys(output.runes).length > 0) return 'rune';
  if (output.inscriptions.length > 0) return 'inscription';
  return 'plain';
}

function toAssets(output: ComposeOrdOutput, inscriptionOffsets: Map<string, number>): Asset[] {
  const assets: Asset[] = [];
  for (const id of output.inscriptions) {
    assets.push({ kind: 'inscription', id, offset: inscriptionOffsets.get(id) ?? 0 });
  }
  for (const [name, bal] of Object.entries(output.runes)) {
    assets.push({ kind: 'rune', name, amount: BigInt(bal.amount), divisibility: bal.divisibility });
  }
  return assets;
}

function toSatRanges(ranges: [number, number][] | null | undefined): SatRangeView[] | null {
  if (!ranges) return null;
  const views: SatRangeView[] = [];
  let offset = 0;
  for (const pair of ranges) {
    const start = BigInt(pair[0]);
    const endExclusive = BigInt(pair[1]);
    const length = Number(endExclusive - start);
    views.push({
      start,
      endExclusive,
      offset,
      length,
      rarityTags: tagsInRange(start, endExclusive),
    });
    offset += length;
  }
  return views;
}

export function mapOrdOutputToCompose(params: {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  address: string;
  source: 'taproot' | 'payment';
  output: ComposeOrdOutput;
  inscriptionOffsets: Map<string, number>;
}): ComposeUtxo {
  const { txid, vout, value, confirmed, address, source, output, inscriptionOffsets } = params;
  return {
    txid,
    vout,
    value,
    confirmed,
    address,
    addressKind: classifyAddressKind(address),
    source,
    kind: deriveKind(output),
    assets: toAssets(output, inscriptionOffsets),
    satRanges: toSatRanges(output.sat_ranges),
  };
}

export async function scanComposeUtxos(
  utxos: Array<Utxo & { address: string; source: 'taproot' | 'payment' }>,
  chain: ComposeChain,
  onProgress?: (scanned: number, total: number) => void,
): Promise<ComposeUtxo[]> {
  await assertComposeOrdHealthy(chain);
  const labeled: ComposeUtxo[] = [];
  let scanned = 0;
  for (const utxo of utxos) {
    try {
      const output = await fetchComposeOrdOutput(chain, utxo.txid, utxo.vout);
      const inscriptionOffsets = new Map<string, number>();
      for (const id of output.inscriptions) {
        inscriptionOffsets.set(id, await getComposeInscriptionOffset(chain, id));
      }
      labeled.push(mapOrdOutputToCompose({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        confirmed: utxo.status.confirmed,
        address: utxo.address,
        source: utxo.source,
        output,
        inscriptionOffsets,
      }));
    } catch {
      labeled.push({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        confirmed: utxo.status.confirmed,
        address: utxo.address,
        addressKind: classifyAddressKind(utxo.address),
        source: utxo.source,
        kind: 'unknown',
        assets: [],
        satRanges: null,
      });
    }
    scanned++;
    onProgress?.(scanned, utxos.length);
  }
  return labeled;
}
