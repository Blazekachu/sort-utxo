import { describe, it, expect } from 'vitest';
import { estimateComposeVBytes } from '../size';

describe('estimateComposeVBytes', () => {
  it('grows when an OP_RETURN is added', () => {
    const a = estimateComposeVBytes({ taprootInputs: 1, p2wpkhInputs: 1, nestedInputs: 0, satOutputs: 2, opReturnScriptLen: null });
    const b = estimateComposeVBytes({ taprootInputs: 1, p2wpkhInputs: 1, nestedInputs: 0, satOutputs: 2, opReturnScriptLen: 10 });
    expect(b).toBeGreaterThan(a);
    expect(a).toBeLessThanOrEqual(100_000);
  });
});
