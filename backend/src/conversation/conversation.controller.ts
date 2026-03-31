import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Res,
  Header,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConversationService } from './conversation.service';
import { AgentService } from '../agent/agent.service';
import { SandboxService } from '../agent/sandbox.service';
import {
  CreateConversationDto,
  UpdateConversationDto,
  SendMessageDto,
} from './dto/send-message.dto';
import { getMcpTools } from '../mcp/mcp-tools.adapter';

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text ?? '')
      .join('');
  }
  return '';
}

@Controller('conversation')
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly agentService: AgentService,
    private readonly sandboxService: SandboxService,
  ) {}

  // ─── Conversation CRUD ────────────────────────────────────

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationService.create(dto);
  }

  @Get()
  findAll() {
    return this.conversationService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateConversationDto) {
    return this.conversationService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.sandboxService.remove(id);
    return this.conversationService.remove(id);
  }

  // ─── Message History ──────────────────────────────────────

  @Get(':id/history')
  findHistory(@Param('id') id: string) {
    return this.conversationService.findHistory(id);
  }

  // ─── Streaming ────────────────────────────────────────────

  @Post('stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async streamMessage(@Body() dto: SendMessageDto, @Res() res: Response) {
    const startTime = Date.now();

    const { conversation } =
      await this.conversationService.sendMessage(dto);

    const history =
      await this.conversationService.getLangChainHistory(conversation.id);

    const backend = await this.sandboxService.getOrCreate(conversation.id);

    const mcpTools = dto.mcpServers?.length
      ? await getMcpTools(dto.mcpServers)
      : [];

    const agentOptions = {
      service: dto.service,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl,
      model: dto.model,
      backend,
      mcpTools,
    };

    // Send conversationId as custom SSE event
    res.write(
      `event: custom\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`,
    );

    const { stream: sseStream } = await this.agentService.getEncodedStream(
      history,
      agentOptions,
    );

    const decoder = new TextDecoder();
    let sseBuffer = '';
    let lastAssistantContent = '';

    try {
      for await (const chunk of sseStream) {
        res.write(Buffer.from(chunk));

        sseBuffer += decoder.decode(chunk, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const block of events) {
          if (!block.trim()) continue;
          const dataMatch = block.match(/^data:\s*(.+)$/m);
          if (!dataMatch?.[1]) continue;

          try {
            const data = JSON.parse(dataMatch[1]);
            if (Array.isArray(data?.messages) && data.messages.length > 0) {
              const last = data.messages[data.messages.length - 1];
              if (last.type === 'ai') {
                const text = extractTextContent(last.content);
                if (text) lastAssistantContent = text;
              }
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (streamError: any) {
      this.logger.error(`[stream] Error: ${streamError?.message}`);
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: streamError?.message })}\n\n`,
        );
      } catch {
        // response closed
      }
    }

    if (lastAssistantContent) {
      await this.conversationService.saveAssistantMessage(
        conversation.id,
        lastAssistantContent,
      );
    }

    this.logger.log(`[stream] Done (${Date.now() - startTime}ms)`);
    res.end();
  }
}
