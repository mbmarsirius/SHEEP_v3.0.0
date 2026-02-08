/**
 * API Usage Tracker
 *
 * Tracks API usage per agent for billing/metering.
 */

export interface UsageRecord {
  agentId: string;
  endpoint: string;
  timestamp: number;
  tier: "free" | "pro" | "enterprise";
}

const usageRecords: UsageRecord[] = [];

/**
 * Track API usage
 */
export function trackUsage(record: UsageRecord): void {
  usageRecords.push(record);

  // Keep only last 24 hours
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const index = usageRecords.findIndex((r) => r.timestamp > cutoff);
  if (index > 0) {
    usageRecords.splice(0, index);
  }
}

/**
 * Get usage stats for an agent
 */
export function getUsageStats(
  agentId: string,
  windowMs = 24 * 60 * 60 * 1000,
): {
  totalRequests: number;
  requestsByEndpoint: Record<string, number>;
} {
  const cutoff = Date.now() - windowMs;
  const relevant = usageRecords.filter((r) => r.agentId === agentId && r.timestamp > cutoff);

  const requestsByEndpoint: Record<string, number> = {};
  for (const record of relevant) {
    requestsByEndpoint[record.endpoint] = (requestsByEndpoint[record.endpoint] ?? 0) + 1;
  }

  return {
    totalRequests: relevant.length,
    requestsByEndpoint,
  };
}
