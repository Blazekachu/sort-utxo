import { dustLimitForAddress } from './dust';
import { encodeOpReturn } from './opreturn';
import { satRarity } from './rarity';
import { composeOutputVBytes, estimateComposeVBytes } from './size';
import type { ComposeUtxo, SatRangeView } from './types';

export interface ComposePlanInput {
  utxo: ComposeUtxo;
  role: 'spend' | 'fee';
}

export function orderComposeInputs(
  utxos: ComposeUtxo[],
  inputOrder: string[],
): ComposePlanInput[] {
  const byKey = new Map(utxos.map((u) => [`${u.txid}:${u.vout}`, u]));
  const ordered: ComposePlanInput[] = [];
  for (let i = 0; i < inputOrder.length; i++) {
    const u = byKey.get(inputOrder[i]);
    if (!u) continue;
    const isLast = i === inputOrder.length - 1;
    ordered.push({ utxo: u, role: isLast ? 'fee' : 'spend' });
  }
  return ordered;
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
  isChange?: boolean;
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

function isPlainPayment(u: ComposeUtxo): boolean {
  return u.source === 'payment' && u.kind === 'plain';
}

function feeTailUsesNonPayment(ordered: ComposePlanInput[], tailStart: number, totalIn: number): boolean {
  if (tailStart >= totalIn) return false;
  let abs = 0;
  for (const item of ordered) {
    const start = abs;
    const end = abs + item.utxo.value;
    abs = end;
    const a = Math.max(start, tailStart);
    const b = Math.min(end, totalIn);
    if (a < b && !isPlainPayment(item.utxo)) return true;
  }
  return false;
}

export function planCompose(params: {
  inputs: ComposePlanInput[];
  outputRows: ComposePlanOutputRow[];
  feeRate: number;
  opReturnText?: string;
  changeAddress?: string;
}): ComposePlan {
  if (params.inputs.length === 0) return fail('Select at least one input.');

  for (const item of params.inputs) {
    const { utxo } = item;
    if (!utxo.confirmed) return fail('Unconfirmed UTXOs cannot be composed.');
    if (utxo.kind === 'rune') return fail('Rune-bearing UTXOs cannot be spent in v1.');
    if (utxo.kind === 'unknown') return fail('Unknown UTXOs cannot be composed.');
  }

  const last = params.inputs[params.inputs.length - 1];
  if (!isPlainPayment(last.utxo) || last.role !== 'fee') {
    return fail('The last input must be a plain payment UTXO (pays fee and receives change).');
  }

  const spend = params.inputs.filter((i) => i.role === 'spend');
  const feeInputs = params.inputs.filter((i) => i.role === 'fee');
  const ordered = [...params.inputs];

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

  const opReturnLen = opReturnScript ? opReturnScript.length : null;
  const userOutVb = outputs.reduce((s, o) => s + composeOutputVBytes(o.address), 0);
  const changeAddress = (params.changeAddress ?? '').trim();

  const vbytesFor = (outputVBytes: number) => estimateComposeVBytes({
    taprootInputs,
    p2wpkhInputs,
    nestedInputs,
    satOutputs: 0,
    satOutputVBytes: outputVBytes,
    opReturnScriptLen: opReturnLen,
  });

  let estimatedVBytes = vbytesFor(userOutVb);
  if (estimatedVBytes > 100_000) return fail('Transaction exceeds the 100 kvB standard size limit.');

  if (params.outputRows.length === 0) return fail('Add at least one output row.');

  const assigned = cursor;
  let fee = 0;
  if (changeAddress) {
    const dust = dustLimitForAddress(changeAddress);
    const vbWithChange = vbytesFor(userOutVb + composeOutputVBytes(changeAddress));
    const feeWithChange = Math.ceil(vbWithChange * params.feeRate);
    const changeValue = totalIn - assigned - feeWithChange;
    if (changeValue >= dust) {
      if (assigned + changeValue > totalIn) return fail('Outputs exceed inputs.');
      const satStart = cursor;
      const satEnd = cursor + changeValue;
      const outInscriptions = inscriptions
        .filter((ins) => ins.abs >= satStart && ins.abs < satEnd)
        .map((ins) => ({ id: ins.id, outputOffset: ins.abs - satStart }));
      const firstSat = satNumberAt(ranges, satStart);
      outputs.push({
        address: changeAddress,
        value: changeValue,
        satStart,
        satEnd,
        inscriptions: outInscriptions,
        startsWithTaggedSat: outInscriptions.some((i) => i.outputOffset === 0)
          || (firstSat !== null && satRarity(firstSat) !== 'common'),
        ranges: sliceRanges(ranges, satStart, satEnd),
        isChange: true,
      });
      cursor = satEnd;
      estimatedVBytes = vbWithChange;
      fee = totalIn - cursor;
    } else {
      const feeNoChange = Math.ceil(estimatedVBytes * params.feeRate);
      const leftover = totalIn - assigned - feeNoChange;
      if (leftover < 0) return fail(`Unassigned tail ${totalIn - assigned} is below the required fee ${feeNoChange}.`);
      if (leftover > 0) {
        return fail(`Change ${leftover} is below dust (${dust}) for the payment address. Increase an output or lower the fee rate.`);
      }
      fee = leftover === 0 ? feeNoChange : totalIn - assigned;
    }
  } else {
    const requiredFee = Math.ceil(estimatedVBytes * params.feeRate);
    fee = totalIn - assigned;
    if (fee < requiredFee) return fail(`Unassigned tail ${fee} is below the required fee ${requiredFee}.`);
    if (fee > requiredFee) {
      return fail('A payment change address is required so leftover sats are not dumped as fee.');
    }
  }

  if (estimatedVBytes > 100_000) return fail('Transaction exceeds the 100 kvB standard size limit.');
  if (fee > 0 && feeTailUsesNonPayment(ordered, cursor, totalIn)) {
    return fail('A payment UTXO is required to pay the fee.');
  }

  return { ok: true, inputs: ordered, outputs, fee, estimatedVBytes, opReturnScript };
}
