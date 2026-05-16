/**
 * Check if a witness stack (array of hex strings) contains an inscription envelope.
 * Inscription envelope pattern: OP_FALSE (00) OP_IF (63) OP_PUSH3 (03) "ord" (6f7264)
 * This is a heuristic — looks for the byte sequence 0063036f7264 in any witness item.
 */
export function hasInscriptionEnvelope(witness: string[]): boolean {
  const ENVELOPE_MARKER = '0063036f7264'; // OP_FALSE OP_IF OP_PUSH3 "ord"

  for (const item of witness) {
    if (item.includes(ENVELOPE_MARKER)) {
      return true;
    }
  }
  return false;
}
