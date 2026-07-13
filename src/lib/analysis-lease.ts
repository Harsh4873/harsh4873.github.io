import type { AnalysisLease } from '../model';

export const ANALYSIS_LEASE_FUTURE_SKEW_MS = 30_000;

/**
 * A lease is fresh only when its heartbeat is valid, no older than the caller's
 * limit, and not ahead of this device's clock. Future skew must never extend a
 * lease indefinitely.
 */
export function isAnalysisLeaseFresh(
  lease: Pick<AnalysisLease, 'heartbeatAt'> | null | undefined,
  nowMs: number,
  maximumAgeMs: number,
  futureSkewToleranceMs = ANALYSIS_LEASE_FUTURE_SKEW_MS,
): boolean {
  if (!lease
    || !Number.isFinite(nowMs)
    || !Number.isFinite(maximumAgeMs)
    || maximumAgeMs < 0
    || !Number.isFinite(futureSkewToleranceMs)
    || futureSkewToleranceMs < 0) return false;
  const heartbeatMs = Date.parse(lease.heartbeatAt);
  if (!Number.isFinite(heartbeatMs) || heartbeatMs > nowMs + futureSkewToleranceMs) return false;
  return nowMs - Math.min(heartbeatMs, nowMs) <= maximumAgeMs;
}
