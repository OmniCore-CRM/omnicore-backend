import { ConversationChannel, MessageStatus, Prisma, ReconciliationRunStatus } from "@prisma/client";
import { prisma } from "@/config/db.js";

type ChannelProvider = "WHATSAPP" | "EMAIL";

type MetricName =
  | "webhook.accepted"
  | "webhook.rejected"
  | "webhook.replay_rejected"
  | "webhook.signature_failed"
  | "messaging.send_success"
  | "messaging.send_failed"
  | "messaging.retry_scheduled"
  | "messaging.retry_exhausted"
  | "messaging.dlq_created"
  | "lifecycle.status_updates"
  | "lifecycle.invalid_transitions"
  | "lifecycle.unmatched_status_events"
  | "deliverability.delivered"
  | "deliverability.bounced"
  | "deliverability.complained"
  | "deliverability.deferred"
  | "operations.reconciliation_started"
  | "operations.reconciliation_completed"
  | "operations.reconciliation_failed";

type MetricEvent = {
  metric: MetricName;
  provider: ChannelProvider;
  companyId?: string | null;
  requestId?: string | null;
  providerEventId?: string | null;
  eventType: string;
  outcome: "accepted" | "rejected" | "success" | "failure" | "scheduled" | "completed";
  latencyMs?: number;
  safeErrorCode?: string | null;
};

type MetricSeriesPoint = {
  ts: number;
  metric: MetricName;
  provider: ChannelProvider;
  companyId?: string | null;
  requestId?: string | null;
  providerEventId?: string | null;
  eventType: string;
  outcome: string;
  latencyMs?: number;
  safeErrorCode?: string | null;
};

type AlertSeverity = "critical" | "high" | "medium";

type AlertDefinition = {
  key: string;
  severity: AlertSeverity;
  threshold: string;
  description: string;
  runbookId: string;
};

type ActiveAlert = AlertDefinition & {
  currentValue: number;
  unit: string;
};

const MAX_EVENTS = 5000;
const FIVE_MINUTES = 5 * 60_000;
const FIFTEEN_MINUTES = 15 * 60_000;
const THIRTY_MINUTES = 30 * 60_000;

const counters = new Map<string, number>();
const events: MetricSeriesPoint[] = [];

const keyOf = (companyId: string | null | undefined, provider: ChannelProvider, metric: MetricName) =>
  `${companyId ?? "global"}|${provider}|${metric}`;

const prune = () => {
  const cutoff = Date.now() - THIRTY_MINUTES;
  while (events.length > MAX_EVENTS || (events[0] && events[0].ts < cutoff)) {
    events.shift();
  }
};

const definitions: AlertDefinition[] = [
  {
    key: "signature_failures_spike",
    severity: "critical",
    threshold: ">= 3 in 5m",
    description: "Webhook signature validation failures exceed expected baseline.",
    runbookId: "replay-attack-or-signature-failure",
  },
  {
    key: "replay_rejection_spike",
    severity: "critical",
    threshold: ">= 5 in 5m",
    description: "Replay rejection rate indicates active attack or provider duplication surge.",
    runbookId: "replay-attack-spike",
  },
  {
    key: "provider_outage",
    severity: "critical",
    threshold: ">= 3 send failures with provider unavailable in 10m",
    description: "Provider appears unavailable for outbound channel traffic.",
    runbookId: "provider-outage",
  },
  {
    key: "reconciliation_failures",
    severity: "critical",
    threshold: ">= 1 in 15m",
    description: "Reconciliation run failed and requires intervention.",
    runbookId: "reconciliation-failure",
  },
  {
    key: "dlq_backlog_growth",
    severity: "high",
    threshold: ">= 5 open items",
    description: "Dead letter queue backlog is growing.",
    runbookId: "dlq-backlog",
  },
  {
    key: "retry_backlog_growth",
    severity: "high",
    threshold: ">= 5 scheduled retries",
    description: "Retry backlog is increasing and may indicate provider degradation.",
    runbookId: "retry-backlog",
  },
  {
    key: "bounce_rate_increase",
    severity: "high",
    threshold: ">= 3 in 30m",
    description: "Email bounce rate has increased above operational threshold.",
    runbookId: "email-deliverability-degradation",
  },
  {
    key: "complaint_rate_increase",
    severity: "high",
    threshold: ">= 1 in 30m",
    description: "Email complaint rate requires immediate review.",
    runbookId: "email-deliverability-degradation",
  },
  {
    key: "status_lag_increase",
    severity: "medium",
    threshold: ">= 3 SENT messages older than 30m",
    description: "Lifecycle status lag is increasing.",
    runbookId: "retry-backlog",
  },
  {
    key: "webhook_latency_increase",
    severity: "medium",
    threshold: "avg >= 500ms over 5 samples in 15m",
    description: "Webhook processing latency is elevated.",
    runbookId: "provider-outage",
  },
];

const filterWindow = (companyId: string, windowMs: number) => {
  const cutoff = Date.now() - windowMs;
  return events.filter((event) => event.companyId === companyId && event.ts >= cutoff);
};

const countMetric = (companyId: string, metric: MetricName, provider?: ChannelProvider, windowMs = FIVE_MINUTES) =>
  filterWindow(companyId, windowMs).filter((event) => event.metric === metric && (!provider || event.provider === provider)).length;

const averageLatency = (companyId: string, metric: MetricName, windowMs = FIFTEEN_MINUTES) => {
  const points = filterWindow(companyId, windowMs).filter(
    (event) => event.metric === metric && typeof event.latencyMs === "number"
  );

  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + (point.latencyMs ?? 0), 0) / points.length;
};

export class ChannelObservabilityService {
  static record(event: MetricEvent) {
    const point: MetricSeriesPoint = {
      ts: Date.now(),
      ...event,
      companyId: event.companyId ?? null,
      requestId: event.requestId ?? null,
      providerEventId: event.providerEventId ?? null,
      safeErrorCode: event.safeErrorCode ?? null,
    };

    events.push(point);
    prune();

    const counterKey = keyOf(point.companyId, point.provider, point.metric);
    counters.set(counterKey, (counters.get(counterKey) ?? 0) + 1);

    const level =
      event.outcome === "failure" || event.outcome === "rejected"
        ? "warn"
        : "info";

    console.log(
      JSON.stringify({
        level,
        event: "channel_operational_event",
        requestId: point.requestId,
        providerEventId: point.providerEventId,
        provider: point.provider,
        companyId: point.companyId,
        eventType: point.eventType,
        metric: point.metric,
        outcome: point.outcome,
        latencyMs: point.latencyMs,
        safeErrorCode: point.safeErrorCode,
      })
    );
  }

  static snapshot(companyId: string) {
    const companyCounters = Array.from(counters.entries())
      .filter(([key]) => key.startsWith(`${companyId}|`))
      .map(([key, value]) => ({ key, value }));

    return {
      counters: companyCounters,
      recentEvents: filterWindow(companyId, THIRTY_MINUTES).slice(-100),
    };
  }

  static async activeAlerts(companyId: string): Promise<ActiveAlert[]> {
    const active: ActiveAlert[] = [];

    const signatureFailures = countMetric(companyId, "webhook.signature_failed");
    if (signatureFailures >= 3) {
      const definition = definitions.find((item) => item.key === "signature_failures_spike")!;
      active.push({ ...definition, currentValue: signatureFailures, unit: "events/5m" });
    }

    const replayRejections = countMetric(companyId, "webhook.replay_rejected");
    if (replayRejections >= 5) {
      const definition = definitions.find((item) => item.key === "replay_rejection_spike")!;
      active.push({ ...definition, currentValue: replayRejections, unit: "events/5m" });
    }

    const providerOutage = filterWindow(companyId, FIVE_MINUTES * 2).filter(
      (event) =>
        event.metric === "messaging.send_failed" &&
        event.safeErrorCode?.includes("PROVIDER_UNAVAILABLE")
    ).length;
    if (providerOutage >= 3) {
      const definition = definitions.find((item) => item.key === "provider_outage")!;
      active.push({ ...definition, currentValue: providerOutage, unit: "events/10m" });
    }

    const reconciliationFailures = countMetric(
      companyId,
      "operations.reconciliation_failed",
      undefined,
      FIFTEEN_MINUTES
    );
    if (reconciliationFailures >= 1) {
      const definition = definitions.find((item) => item.key === "reconciliation_failures")!;
      active.push({ ...definition, currentValue: reconciliationFailures, unit: "events/15m" });
    }

    const [openDlq, retryBacklog, statusLag] = await Promise.all([
      prisma.channelDeadLetterItem.count({
        where: {
          companyId,
          state: "OPEN",
        },
      }),
      prisma.messageRetryState.count({
        where: {
          companyId,
          state: "RETRY_SCHEDULED",
        },
      }),
      prisma.message.count({
        where: {
          companyId,
          provider: { in: [ConversationChannel.WHATSAPP, ConversationChannel.EMAIL] },
          status: MessageStatus.SENT,
          createdAt: {
            lte: new Date(Date.now() - THIRTY_MINUTES),
          },
        },
      }),
    ]);

    if (openDlq >= 5) {
      const definition = definitions.find((item) => item.key === "dlq_backlog_growth")!;
      active.push({ ...definition, currentValue: openDlq, unit: "open_items" });
    }

    if (retryBacklog >= 5) {
      const definition = definitions.find((item) => item.key === "retry_backlog_growth")!;
      active.push({ ...definition, currentValue: retryBacklog, unit: "scheduled_retries" });
    }

    const bounceCount = countMetric(companyId, "deliverability.bounced", "EMAIL", THIRTY_MINUTES);
    if (bounceCount >= 3) {
      const definition = definitions.find((item) => item.key === "bounce_rate_increase")!;
      active.push({ ...definition, currentValue: bounceCount, unit: "events/30m" });
    }

    const complaintCount = countMetric(companyId, "deliverability.complained", "EMAIL", THIRTY_MINUTES);
    if (complaintCount >= 1) {
      const definition = definitions.find((item) => item.key === "complaint_rate_increase")!;
      active.push({ ...definition, currentValue: complaintCount, unit: "events/30m" });
    }

    if (statusLag >= 3) {
      const definition = definitions.find((item) => item.key === "status_lag_increase")!;
      active.push({ ...definition, currentValue: statusLag, unit: "messages" });
    }

    const latencyAvg = averageLatency(companyId, "webhook.accepted", FIFTEEN_MINUTES);
    const latencySamples = filterWindow(companyId, FIFTEEN_MINUTES).filter(
      (event) => event.metric === "webhook.accepted" && typeof event.latencyMs === "number"
    ).length;
    if (latencySamples >= 5 && latencyAvg >= 500) {
      const definition = definitions.find((item) => item.key === "webhook_latency_increase")!;
      active.push({ ...definition, currentValue: Math.round(latencyAvg), unit: "ms_avg_15m" });
    }

    return active;
  }

  static alertDefinitions() {
    return definitions;
  }

  static async operationsOverview(companyId: string) {
    return {
      snapshot: this.snapshot(companyId),
      alertDefinitions: this.alertDefinitions(),
      activeAlerts: await this.activeAlerts(companyId),
      reconciliationFailuresLast15m: await prisma.reconciliationRun.count({
        where: {
          companyId,
          status: ReconciliationRunStatus.FAILED,
          startedAt: {
            gte: new Date(Date.now() - FIFTEEN_MINUTES),
          },
        },
      }),
    };
  }
}
