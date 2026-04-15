import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AdvancedTablePayload } from './table-generator.tool';

/**
 * In-memory store for AdvancedTable payloads keyed by UUID.
 *
 * Motivation:
 *   Large tables (1000+ rows) inline-stream through the LLM are expensive and
 *   slow. Instead, the tool stores the payload here and only emits a small
 *   reference `{ tableId }`. The frontend fetches the full payload via HTTP
 *   just before rendering, keeping chat transcripts small.
 *
 * Lifetime:
 *   Entries expire after TTL_MS. A lightweight lazy sweep removes stale
 *   entries on every write — no background timer, no memory leak. For
 *   production you would swap this with Redis / Postgres-backed storage.
 */
@Injectable()
export class TableStoreService {
  private readonly logger = new Logger(TableStoreService.name);
  private readonly store = new Map<
    string,
    { payload: AdvancedTablePayload; expiresAt: number }
  >();

  // Demo için 1 saat yeterli. Chat geçmişi yenilendiğinde tablo kaybolur; bu
  // kabul edilebilir bir trade-off. Kalıcılık istenirse Postgres'e taşınır.
  private static readonly TTL_MS = 60 * 60 * 1000;

  put(payload: AdvancedTablePayload): string {
    this.sweep();
    const id = randomUUID();
    this.store.set(id, {
      payload,
      expiresAt: Date.now() + TableStoreService.TTL_MS,
    });
    this.logger.debug(
      `Stored table ${id} (${payload.rows.length} rows, ${payload.columns.length} cols)`,
    );
    return id;
  }

  get(id: string): AdvancedTablePayload {
    const entry = this.store.get(id);
    if (!entry) {
      throw new NotFoundException(`Table ${id} not found or expired`);
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(id);
      throw new NotFoundException(`Table ${id} expired`);
    }
    return entry.payload;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (entry.expiresAt < now) this.store.delete(id);
    }
  }
}
