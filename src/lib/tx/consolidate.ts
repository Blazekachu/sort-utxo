import * as bitcoin from 'bitcoinjs-lib';
import { planSatLedger, type LedgerOutput, type SatLedgerPlan } from './satLedger';
import { estimateVBytes } from './sort';

const DUST = 546;

export interface ConsolidationInput {
  txid: string;
  vout: number;
  value: number;
  source: 'taproot' | 'payment';
  sourceAddress: string;
  accountId: string;
  inscriptionOffsets: number[];
  hasRunes: boolean;
  /** x-only BIP86 internal key, required for taproot inputs. */
  internalPubkey?: Uint8Array;
}

export type ConsolidationOutput = LedgerOutput | {
  address: string;
  value: number;
  kind: 'rune-anchor';
};

export interface ConsolidationPlan {
  ok: boolean;
  error?: string;
  inputs: ConsolidationInput[];
  outputs: ConsolidationOutput[];
  excluded: Array<{ input: ConsolidationInput; reason: string }>;
  fee: number;
  estimatedVBytes: number;
}

function isTaprootAddress(address: string): boolean {
  return address.startsWith('bc1p') || address.startsWith('tb1p');
}

export function validateAccountNetworks(addresses: string[]): void {
  if (addresses.length === 0) return;
  const testnet = addresses[0].startsWith('tb1') || addresses[0].startsWith('2') || addresses[0].startsWith('m') || addresses[0].startsWith('n');
  if (addresses.some((address) => (
    address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n')
  ) !== testnet)) {
    throw new Error('All collected accounts must be on the same network.');
  }
}

/**
 * A no-runestone transaction sends all input runes to its first non-OP_RETURN
 * output. Rune UTXOs therefore become a leading taproot "anchor" output. A
 * UTXO carrying both a rune and an inscription is excluded: placing its
 * inscription at a separate postage output would move the rune to a different
 * output, while keeping it in the anchor cannot guarantee inscription postage.
 */
export function planConsolidation(params: {
  inputs: ConsolidationInput[];
  feeRate: number;
  taprootAddress: string;
  paymentAddress: string;
}): ConsolidationPlan {
  const { inputs, feeRate, taprootAddress, paymentAddress } = params;
  const excluded: ConsolidationPlan['excluded'] = [];
  const usable = inputs.filter((input) => {
    if (input.hasRunes && input.inscriptionOffsets.length > 0) {
      excluded.push({
        input,
        reason: 'Rune + inscription UTXOs are excluded because they cannot be consolidated safely without a runestone.',
      });
      return false;
    }
    return true;
  });

  if (usable.length === 0) {
    return { ok: false, error: 'No safely consolidatable UTXOs.', inputs: [], outputs: [], excluded, fee: 0, estimatedVBytes: 0 };
  }

  const runeInputs = usable.filter((input) => input.hasRunes);
  const remainder = usable.filter((input) => !input.hasRunes);
  const ordered = [...runeInputs, ...remainder];
  const runeValue = runeInputs.reduce((sum, input) => sum + input.value, 0);

  if (remainder.length === 0) {
    return {
      ok: false,
      error: runeInputs.length > 0
        ? 'Rune inputs need separate plain sats to fund the fee without reducing the rune anchor.'
        : 'No inputs.',
      inputs: ordered,
      outputs: [],
      excluded,
      fee: 0,
      estimatedVBytes: 0,
    };
  }

  const totalTaprootInputs = ordered.filter((input) => input.source === 'taproot').length;
  const totalSegwitInputs = ordered.length - totalTaprootInputs;
  const anchorOutputs: ConsolidationOutput[] = runeInputs.length > 0
    ? [{ address: taprootAddress, value: runeValue, kind: 'rune-anchor' }]
    : [];

  const ledger = planSatLedger({
    inputs: remainder.map((input) => ({
      txid: input.txid,
      vout: input.vout,
      value: input.value,
      source: input.source,
      inscriptionOffsets: input.inscriptionOffsets,
    })),
    taprootAddress,
    paymentAddress,
    feeRate,
    feeInputCounts: { taproot: totalTaprootInputs, segwit: totalSegwitInputs },
    additionalOutputCount: anchorOutputs.length,
  });

  if (!ledger.ok) {
    return {
      ok: false,
      error: ledger.error,
      inputs: ordered,
      outputs: [],
      excluded,
      fee: ledger.fee,
      estimatedVBytes: ledger.estimatedVBytes,
    };
  }

  return {
    ok: true,
    inputs: ordered,
    outputs: [...anchorOutputs, ...ledger.outputs],
    excluded,
    fee: ledger.fee,
    estimatedVBytes: ledger.estimatedVBytes,
  };
}

export function validateConsolidationDestinations(params: {
  paymentAddress: string;
  taprootAddress: string;
  network: bitcoin.Network;
}): void {
  const { paymentAddress, taprootAddress, network } = params;
  try {
    bitcoin.address.toOutputScript(paymentAddress, network);
    bitcoin.address.toOutputScript(taprootAddress, network);
  } catch {
    throw new Error('Destination address format or network does not match the collected accounts.');
  }
  if (isTaprootAddress(paymentAddress)) throw new Error('The payment destination must not be a taproot address.');
  if (!isTaprootAddress(taprootAddress)) throw new Error('The ordinals destination must be a taproot address.');
}

export interface ConsolidationSigningInput {
  index: number;
  address: string;
  accountId: string;
}

export function buildConsolidationPsbt(params: {
  inputs: ConsolidationInput[];
  outputs: ConsolidationOutput[];
  network: bitcoin.Network;
}): { psbt: bitcoin.Psbt; inputsToSign: ConsolidationSigningInput[] } {
  const { inputs, outputs, network } = params;
  const totalIn = inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOut = outputs.reduce((sum, output) => sum + output.value, 0);
  if (totalOut > totalIn) throw new Error(`Outputs (${totalOut}) exceed inputs (${totalIn}).`);

  const psbt = new bitcoin.Psbt({ network });
  const inputsToSign: ConsolidationSigningInput[] = [];
  inputs.forEach((input, index) => {
    const psbtInput: Record<string, unknown> = {
      hash: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(input.sourceAddress, network),
        value: BigInt(input.value),
      },
    };
    if (input.source === 'taproot') {
      if (!input.internalPubkey || input.internalPubkey.length !== 32) {
        throw new Error(`Taproot input ${index} is missing its account internal public key.`);
      }
      psbtInput.tapInternalKey = input.internalPubkey;
    }
    psbt.addInput(psbtInput as unknown as Parameters<typeof psbt.addInput>[0]);
    inputsToSign.push({ index, address: input.sourceAddress, accountId: input.accountId });
  });
  outputs.forEach((output) => psbt.addOutput({ address: output.address, value: BigInt(output.value) }));
  return { psbt, inputsToSign };
}

export function groupSigningInputsByAccount(inputs: ConsolidationSigningInput[]): Array<{
  accountId: string;
  inputs: Array<{ index: number; address: string }>;
}> {
  const groups = new Map<string, Array<{ index: number; address: string }>>();
  for (const input of inputs) {
    const group = groups.get(input.accountId) ?? [];
    group.push({ index: input.index, address: input.address });
    groups.set(input.accountId, group);
  }
  return [...groups].map(([accountId, accountInputs]) => ({ accountId, inputs: accountInputs }));
}

export function hasNewSignatures(
  before: bitcoin.Psbt,
  after: bitcoin.Psbt,
  indices: number[],
): boolean {
  return indices.every((index) => {
    const previous = before.data.inputs[index];
    const next = after.data.inputs[index];
    return Boolean(
      (!previous.tapKeySig && next.tapKeySig)
      || (next.partialSig?.length ?? 0) > (previous.partialSig?.length ?? 0)
      || (!previous.finalScriptWitness && next.finalScriptWitness),
    );
  });
}

export function estimatedConsolidationVBytes(inputs: ConsolidationInput[], outputs: number): number {
  return estimateVBytes(
    inputs.filter((input) => input.source === 'taproot').length,
    inputs.filter((input) => input.source === 'payment').length,
    outputs,
  );
}

export { DUST };
