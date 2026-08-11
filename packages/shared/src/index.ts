export type QueueDomainEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  organizationId: string;
  branchId?: string;
  departmentId?: string;
  serviceId?: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  data: Record<string, unknown>;
};

export const REALTIME_EVENT_NAMES = {
  queueTokenCreated: "queue.token.created",
  queueTokenCalled: "queue.token.called",
  queueTokenServing: "queue.token.serving",
  queueTokenSkipped: "queue.token.skipped",
  queueTokenRecalled: "queue.token.recalled",
  queueTokenTransferred: "queue.token.transferred",
  queueTokenCompleted: "queue.token.completed",
  queueTokenCancelled: "queue.token.cancelled",
  queueUpdated: "queue.updated",
  counterStatusChanged: "counter.status.changed",
  printerJobCreated: "printer.job.created",
  printerJobUpdated: "printer.job.updated"
} as const;
