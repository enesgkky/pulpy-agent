import { Logger } from '@nestjs/common';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { StructuredTool } from '@langchain/core/tools';

const logger = new Logger('McpToolsAdapter');

/**
 * Wrap an MCP tool so that invocation errors are returned as
 * text content instead of throwing — this lets the LLM see the
 * error, fix its parameters, and retry autonomously.
 */
function wrapToolWithErrorHandling(tool: StructuredTool): StructuredTool {
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema as any,
    func: async (input: any, runManager?: any) => {
      try {
        return await tool.invoke(input, runManager);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[${tool.name}] Tool hatası (agent'a iletiliyor): ${message}`);
        return `[HATA] ${tool.name} çalıştırılırken hata oluştu: ${message}\n\nLütfen parametreleri kontrol edip tekrar deneyin.`;
      }
    },
  });
}

export async function getMcpTools(
  servers: { name: string; url: string }[],
): Promise<StructuredTool[]> {
  if (!servers.length) return [];

  logger.log(
    `MCP sunucularına bağlanılıyor: ${servers.map((s) => `${s.name} (${s.url})`).join(', ')}`,
  );

  const config: Record<string, { transport: 'sse'; url: string }> = {};
  for (const s of servers) {
    config[s.name] = { transport: 'sse', url: s.url };
  }

  try {
    const client = new MultiServerMCPClient(config);
    const tools = await client.getTools();
    logger.log(`MCP araçları yüklendi: ${tools.length} araç — [${tools.map((t) => t.name).join(', ')}]`);
    for (const tool of tools) {
      const schema = tool.schema;
      if (schema) {
        logger.debug(`Tool şeması [${tool.name}]: ${JSON.stringify(schema)}`);
      }
    }
    return tools.map(wrapToolWithErrorHandling);
  } catch (error) {
    logger.error(`MCP bağlantı hatası: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}
