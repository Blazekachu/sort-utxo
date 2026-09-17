import type { ComposeUtxo } from './types';

export function canComposeSpend(u: ComposeUtxo): boolean {
  return u.confirmed && u.kind !== 'rune' && u.kind !== 'unknown';
}

export function canComposeFee(u: ComposeUtxo): boolean {
  return canComposeSpend(u) && u.source === 'payment' && u.kind === 'plain';
}
