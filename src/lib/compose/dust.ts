export function dustLimitForAddress(address: string): number {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) return 330;
  if (address.startsWith('3') || address.startsWith('2')) return 546;
  return 294;
}
