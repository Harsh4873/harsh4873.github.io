import { describe, expect, it } from 'vitest';
import type { AnalysisLease } from '../model';
import { isAnalysisLeaseFresh } from './analysis-lease';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const LEASE: AnalysisLease = {
  runId: 'analysis-run-1',
  ownerId: 'research-tab-1',
  mode: 'local',
  heartbeatAt: '2026-07-13T11:59:30.000Z',
};

describe('analysis lease freshness', () => {
  it('accepts a heartbeat at or inside the maximum age', () => {
    expect(isAnalysisLeaseFresh(LEASE, NOW, 30_000)).toBe(true);
    expect(isAnalysisLeaseFresh({ heartbeatAt: new Date(NOW).toISOString() }, NOW, 30_000)).toBe(true);
  });

  it('rejects stale, missing, invalid, and excessively future-skewed heartbeats', () => {
    expect(isAnalysisLeaseFresh(LEASE, NOW, 29_999)).toBe(false);
    expect(isAnalysisLeaseFresh(undefined, NOW, 30_000)).toBe(false);
    expect(isAnalysisLeaseFresh({ heartbeatAt: 'not-a-date' }, NOW, 30_000)).toBe(false);
    expect(isAnalysisLeaseFresh({ heartbeatAt: new Date(NOW + 1).toISOString() }, NOW, 30_000)).toBe(true);
    expect(isAnalysisLeaseFresh({ heartbeatAt: new Date(NOW + 30_000).toISOString() }, NOW, 30_000)).toBe(true);
    expect(isAnalysisLeaseFresh({ heartbeatAt: new Date(NOW + 30_001).toISOString() }, NOW, 30_000)).toBe(false);
  });

  it('rejects invalid clock and maximum-age inputs', () => {
    expect(isAnalysisLeaseFresh(LEASE, Number.NaN, 30_000)).toBe(false);
    expect(isAnalysisLeaseFresh(LEASE, NOW, -1)).toBe(false);
    expect(isAnalysisLeaseFresh(LEASE, NOW, 30_000, -1)).toBe(false);
  });
});
