import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export const NotificationProviderToken = Symbol('NotificationProviderToken');

export type ProviderResult =
  | { ok: true; providerMessageId?: string; delivered: boolean }
  | { ok: false; transient: boolean; errorCode: string };

export interface NotificationProvider {
  readonly name: string;
  status(): Promise<'configured' | 'disabled' | 'unavailable' | 'mock' | 'noop'>;
  sendSMS(recipient: string, message: string): Promise<ProviderResult>;
  sendWhatsApp(recipient: string, message: string): Promise<ProviderResult>;
}

/** Masks a phone number for logs, e.g. ******1234. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '******' : `******${digits.slice(-4)}`;
}

/**
 * Default provider. Accepts the send request but never performs delivery and
 * never claims delivery; the record transitions to SENT at most.
 */
@Injectable()
export class NoopProvider implements NotificationProvider {
  readonly name = 'noop';

  status(): Promise<'configured' | 'disabled' | 'unavailable' | 'mock' | 'noop'> {
    return Promise.resolve('noop');
  }

  sendSMS(): Promise<ProviderResult> {
    return Promise.resolve({ ok: true, providerMessageId: `noop:${randomUUID()}`, delivered: false });
  }

  sendWhatsApp(): Promise<ProviderResult> {
    return Promise.resolve({ ok: true, providerMessageId: `noop:${randomUUID()}`, delivered: false });
  }
}

/**
 * Development-only provider. Prints the masked recipient and message so
 * operators can inspect what would be sent; never claims delivery.
 */
@Injectable()
export class MockProvider implements NotificationProvider {
  readonly name = 'mock';

  status(): Promise<'configured' | 'disabled' | 'unavailable' | 'mock' | 'noop'> {
    return Promise.resolve('mock');
  }

  sendSMS(recipient: string, message: string): Promise<ProviderResult> {
    console.log(`[mock:sms] to ${maskPhone(recipient)}: ${message}`);
    return Promise.resolve({ ok: true, providerMessageId: `mock:${randomUUID()}`, delivered: false });
  }

  sendWhatsApp(recipient: string, message: string): Promise<ProviderResult> {
    console.log(`[mock:whatsapp] to ${maskPhone(recipient)}: ${message}`);
    return Promise.resolve({ ok: true, providerMessageId: `mock:${randomUUID()}`, delivered: false });
  }
}
