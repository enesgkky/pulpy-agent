import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface McpTestResult {
  success: boolean;
  serverInfo?: { name: string; version: string };
  tools?: { name: string; description?: string }[];
  error?: string;
}

@Injectable()
export class McpService {
  async testConnection(url: string): Promise<McpTestResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 30_000);

    let client: Client | undefined;

    try {
      const transport = new SSEClientTransport(new URL(url));
      client = new Client({ name: 'pulpy-mcp-test', version: '1.0.0' });

      await client.connect(transport, { signal: abortController.signal });

      const serverInfo = client.getServerVersion() ?? {
        name: 'unknown',
        version: 'unknown',
      };

      const { tools } = await client.listTools();

      return {
        success: true,
        serverInfo: {
          name: serverInfo.name ?? 'unknown',
          version: serverInfo.version ?? 'unknown',
        },
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Bilinmeyen hata oluştu';
      return { success: false, error: message };
    } finally {
      clearTimeout(timeout);
      try {
        await client?.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
