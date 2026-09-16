import { dustLimitForAddress } from './dust';
import { encodeOpReturn } from './opreturn';
import { satRarity } from './rarity';
import { estimateComposeVBytes } from './size';
import type { ComposeUtxo, SatRangeView } from './types';

export interface ComposePlanInput {
  utxo: ComposeUtxo;
  role: 'spend' | 'fee';
}

export interface ComposePlanOutputRow {
  value: number;
  address: string;
}

export interface PlannedInscription {
  id: string;
  outputOffset: number;
}

export interface PlannedOutput {
  address: string;
  value: number;
  satStart: number;
  satEnd: number;
  inscriptions: PlannedInscription[];
  startsWithTaggedSat: boolean;
  ranges: SatRangeView[];
}

export interface ComposePlan {
  ok: boolean;
  error?: string;
  inputs: ComposePlanInput[];
  outputs: PlannedOutput[];
  fee: number;
  estimatedVBytes: number;
  opReturnScript?: Uint8Array;
}

function fail(error: string): ComposePlan {
  return { ok: false, error, inputs: [], outputs: [], fee: 0, estimatedVBytes: 0 };
}

interface LineRange {
  absStart: number;
  absEnd: number;
  start: bigint;
  endExclusive: bigint;
}

function lineRanges(ordered: ComposeUtxo[]): LineRange[] {
  const out: LineRange[] = [];
  let abs = 0;
  for (const u of ordered) {
    for (const r of u.satRanges ?? []) {
      out.push({
        absStart: abs + r.offset,
        absEnd: abs + r.offset + r.length,
        start: r.start,
        endExclusive: r.endExclusive,
      });
    }
    abs += u.value;
  }
  return out;
}

function sliceRanges(ranges: LineRange[], satStart: number, satEnd: number): SatRangeView[] {
  const views: SatRangeView[] = [];
  let offset = 0;
  for (const r of ranges) {
    const a = Math.max(r.absStart, satStart);
    const b = Math.min(r.absEnd, satEnd);
    if (a >= b) continue;
    const delta = BigInt(a - r.absStart);
    const length = b - a;
    const start = r.start + delta;
    views.push({
      start,
      endExclusive: start + BigInt(length),
      offset,
      length,
      rarityTags: [],
    });
    offset += length;
  }
  return views;
}

function satNumberAt(ranges: LineRange[], abs: number): bigint | null {
  for (const r of ranges) {
    if (abs >= r.absStart && abs < r.absEnd) return r.start + BigInt(abs - r.absStart);
  }
  return null;
}

export function planCompose(params: {
  inputs: ComposePlanInput[];
  outputRows: ComposePlanOutputRow[];
  feeRate: number;
  opReturnText?: string;
}): ComposePlan {
  const spend = params.inputs.filter((i) => i.role === 'spend');
  const feeInputs = params.inputs.filter((i) => i.role === 'fee');
  const ordered = [...spend, ...feeInputs];

  for (const item of ordered) {
    const { utxo, role } = item;
    if (!utxo.confirmed) return fail('Unconfirmed UTXOs cannot be composed.');
    if (utxo.kind === 'rune') return fail('Rune-bearing UTXOs cannot be spent in v1.');
    if (utxo.kind === 'unknown') return fail('Unknown UTXOs cannot be composed.');
    if (utxo.satRanges === null) return fail('UTXO is missing sat ranges from ord.');
    if (role === 'fee') {
      if (utxo.source !== 'payment' || utxo.kind !== 'plain') {
        return fail('Fee/padding inputs must be plain payment UTXOs.');
      }
    }
  }

  const spendTotal = spend.reduce((s, i) => s + i.utxo.value, 0);
  const totalIn = ordered.reduce((s, i) => s + i.utxo.value, 0);
  const ranges = lineRanges(ordered.map((i) => i.utxo));

  const inscriptions: Array<{ id: string; abs: number }> = [];
  let absCursor = 0;
  for (const item of ordered) {
    for (const a of item.utxo.assets) {
      if (a.kind === 'inscription') inscriptions.push({ id: a.id, abs: absCursor + a.offset });
    }
    absCursor += item.utxo.value;
  }

  let opReturnScript: Uint8Array | undefined;
  try {
    const encoded = encodeOpReturn(params.opReturnText ?? '');
    if (encoded) opReturnScript = encoded;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const outputs: PlannedOutput[] = [];
  let cursor = 0;
  for (const row of params.outputRows) {
    if (row.value < dustLimitForAddress(row.address)) {
      return fail(`Output of ${row.value} is below dust for that address.`);
    }
    if (cursor + row.value > spendTotal && feeInputs.length === 0) {
      return fail('This cut runs past spend inputs. Add a payment UTXO for postage/fee.');
    }
    if (cursor + row.value > totalIn) return fail('Outputs exceed inputs.');
    const satStart = cursor;
    const satEnd = cursor + row.value;
    const outInscriptions = inscriptions
      .filter((ins) => ins.abs >= satStart && ins.abs < satEnd)
      .map((ins) => ({ id: ins.id, outputOffset: ins.abs - satStart }));
    const firstSat = satNumberAt(ranges, satStart);
    const startsWithTaggedSat = outInscriptions.some((i) => i.outputOffset === 0)
      || (firstSat !== null && satRarity(firstSat) !== 'common');
    outputs.push({
      address: row.address,
      value: row.value,
      satStart,
      satEnd,
      inscriptions: outInscriptions,
      startsWithTaggedSat,
      ranges: sliceRanges(ranges, satStart, satEnd),
    });
    cursor = satEnd;
  }

  let taprootInputs = 0;
  let p2wpkhInputs = 0;
  let nestedInputs = 0;
  for (const item of ordered) {
    if (item.utxo.addressKind === 'taproot') taprootInputs++;
    else if (item.utxo.addressKind === 'p2sh-p2wpkh') nestedInputs++;
    else p2wpkhInputs++;
  }

  const estimatedVBytes = estimateComposeVBytes({
    taprootInputs,
    p2wpkhInputs,
    nestedInputs,
    satOutputs: outputs.length,
    opReturnScriptLen: opReturnScript ? opReturnScript.length : null,
  });
  if (estimatedVBytes > 100_000) return fail('Transaction exceeds the 100 kvB standard size limit.');

  const requiredFee = Math.ceil(estimatedVBytes * params.feeRate);
  const fee = totalIn - cursor;
  if (fee < requiredFee) return fail(`Unassigned tail ${fee} is below the required fee ${requiredFee}.`);
  if (fee > 0 && feeInputs.length === 0) return fail('A payment UTXO is required to pay the fee.');

  return { ok: true, inputs: ordered, outputs, fee, estimatedVBytes, opReturnScript };
}
