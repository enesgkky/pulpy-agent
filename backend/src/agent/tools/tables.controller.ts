import { Controller, Get, Param } from '@nestjs/common';
import type { AdvancedTablePayload } from './table-generator.tool';
import { TableStoreService } from './table-store.service';

/**
 * Serves table payloads stored by the generate_advanced_table tool.
 *
 * Flow:
 *   1. LLM calls the tool → tool stores payload in TableStoreService, gets ID
 *   2. Tool returns `{ tableId }` wrapped in an advanced-table markdown block
 *   3. Frontend parses the block, sees the ID, hits `GET /tables/:id`,
 *      receives the full AdvancedTableProps payload and renders it.
 */
@Controller('tables')
export class TablesController {
  constructor(private readonly store: TableStoreService) {}

  @Get(':id')
  getTable(@Param('id') id: string): AdvancedTablePayload {
    return this.store.get(id);
  }
}
