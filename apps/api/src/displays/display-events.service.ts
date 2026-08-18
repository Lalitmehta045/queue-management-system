import { Injectable } from '@nestjs/common';

export type DisplayEventType =
  | 'QUEUE_UPDATED'
  | 'TOKEN_CALLED'
  | 'TOKEN_SERVED'
  | 'TOKEN_RECALLED'
  | 'TOKEN_SKIPPED'
  | 'TOKEN_COMPLETED'
  | 'TOKEN_RECALL_SKIPPED';

type Listener = (eventType: DisplayEventType) => void;

@Injectable()
export class DisplayEventsService {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(branchId: string, listener: Listener) {
    const branchListeners = this.listeners.get(branchId) ?? new Set<Listener>();
    branchListeners.add(listener);
    this.listeners.set(branchId, branchListeners);

    return () => {
      branchListeners.delete(listener);
      if (branchListeners.size === 0) this.listeners.delete(branchId);
    };
  }

  publish(branchId: string, eventType: DisplayEventType) {
    const branchListeners = this.listeners.get(branchId);
    if (!branchListeners) return;
    for (const listener of branchListeners) listener(eventType);
  }

  subscriberCount(branchId: string) {
    return this.listeners.get(branchId)?.size ?? 0;
  }
}
