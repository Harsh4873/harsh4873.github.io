import { describe, expect, it } from 'vitest';
import { canFallBackToLocalAnalysis } from './analysis-job-coordination';

describe('analysis job coordination', () => {
  it('allows offline persistence only for a local analysis claimed locally', () => {
    expect(canFallBackToLocalAnalysis('local', 'local')).toBe(true);
    expect(canFallBackToLocalAnalysis('local', 'cloud')).toBe(false);
    expect(canFallBackToLocalAnalysis('local', 'pending')).toBe(false);
    expect(canFallBackToLocalAnalysis('ai', 'local')).toBe(false);
    expect(canFallBackToLocalAnalysis('ai', 'cloud')).toBe(false);
  });
});
