const HEX_RE = /^[0-9a-f]*$/i;

export function assertVanityHex(prefix: string, suffix: string): void {
  if (!HEX_RE.test(prefix) || !HEX_RE.test(suffix)) {
    throw new Error('Vanity prefix/suffix must be hex');
  }
  if (prefix.length > 6 || suffix.length > 6) {
    throw new Error('Vanity prefix/suffix max 6 hex characters');
  }
}

export function vanityMatches(txid: string, prefix: string, suffix: string): boolean {
  return txid.startsWith(prefix.toLowerCase()) && txid.endsWith(suffix.toLowerCase());
}
