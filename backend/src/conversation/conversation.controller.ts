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
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { ConversationService } from './conversation.service';
import { AgentService } from '../agent/agent.service';
import { SandboxService } from '../agent/sandbox.service';
import { writeFile } from 'fs/promises';
import {
  CreateConversationDto,
  UpdateConversationDto,
  SendMessageDto,
} from './dto/send-message.dto';
import { getMcpTools } from '../mcp/mcp-tools.adapter';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

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
  ) { }

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

  // ─── File Upload ──────────────────────────────────────────

  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const workspaceDir = await this.sandboxService.getWorkspaceDir(id);
    const filePath = join(workspaceDir, file.originalname);
    await writeFile(filePath, file.buffer);
    this.logger.log(`[file] Saved ${file.originalname} to ${workspaceDir}`);
    return { filename: file.originalname, size: file.size };
  }

  // ─── Artifact Serving ────────────────────────────────────

  @Get(':id/artifacts')
  async listArtifacts(@Param('id') id: string) {
    const workspaceDir = await this.sandboxService.getWorkspaceDir(id);
    const artifactsDir = join(workspaceDir, 'artifacts');
    if (!existsSync(artifactsDir)) return [];
    const { readdirSync } = require('fs');
    const files: string[] = readdirSync(artifactsDir);
    return files
      .filter((f: string) => f.endsWith('.html') || f.endsWith('.htm') || f.endsWith('.md'))
      .map((f: string) => ({ filename: f }));
  }

  @Get(':id/artifacts/:filename')
  async getArtifact(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const workspaceDir = await this.sandboxService.getWorkspaceDir(id);
    const filePath = join(workspaceDir, 'artifacts', filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    const contentType = filename.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  }

  // ─── Message History ──────────────────────────────────────

  @Get(':id/history')
  findHistory(@Param('id') id: string) {
    return this.conversationService.findHistory(id);
  }

  // ─── Multi File Upload (buffer → temp with original names) ──

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    const results: { filename: string; originalName: string; path: string; size: number }[] = [];
    for (const file of files) {
      const originalName = file.originalname.normalize('NFC');
      const dest = join(UPLOADS_DIR, `${Date.now()}-${originalName}`);
      await writeFile(dest, file.buffer);
      results.push({
        filename: originalName,
        originalName,
        path: dest,
        size: file.size,
      });
    }
    return results;
  }

  // ─── Streaming ────────────────────────────────────────────

  @Post('stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  async streamMessage(@Body() dto: SendMessageDto, @Res() res: Response) {
    const startTime = Date.now();

    const { conversation } =
      await this.conversationService.sendMessage(dto);

    const history =
      await this.conversationService.getLangChainHistory(conversation.id);

    const backend = await this.sandboxService.getOrCreate(conversation.id);

    // Copy uploaded files into workspace if provided
    let uploadedFiles: string[] = [];
    if (dto.files?.length) {
      uploadedFiles = await this.sandboxService.copyFilesToWorkspace(
        conversation.id,
        dto.files.map((f) => ({ path: f.path, originalName: f.originalName })),
      );
      this.logger.log(
        `[stream] Copied ${uploadedFiles.length} file(s) to workspace`,
      );
    }

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
      uploadedFiles: uploadedFiles.length ? uploadedFiles : undefined,
    };

    // Send conversationId as custom SSE event
    res.write(
      `event: custom\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`,
    );

    // Detect client disconnect
    let clientDisconnected = false;
    res.on('close', () => {
      clientDisconnected = true;
      this.logger.log(`[stream] Client disconnected for conversation ${conversation.id}`);
    });

    let sseStream: AsyncIterable<any>;
    try {
      const result = await this.agentService.getEncodedStream(
        history,
        agentOptions,
      );
      sseStream = result.stream;
    } catch (initError: any) {
      this.logger.error(`[stream] Failed to create agent stream: ${initError?.message}`);
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: 'Stream baslatilamadi. Lutfen tekrar deneyin.' })}\n\n`,
        );
      } catch { /* response closed */ }
      res.end();
      return;
    }

    // Collect raw SSE data for post-stream content extraction
    const rawChunks: Buffer[] = [];
    let lastAssistantContent = '';

    // Disable socket buffering for real-time streaming
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    try {
      for await (const chunk of sseStream) {
        if (clientDisconnected) break;

        try {
          const bufferChunk = Buffer.from(chunk);
          rawChunks.push(bufferChunk);
          const ok = res.write(bufferChunk);
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
          if (!ok) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        } catch {
          break;
        }
      }
    } catch (streamError: any) {
      this.logger.error(`[stream] Error during iteration: ${streamError?.message}`, streamError?.stack);
      if (!clientDisconnected) {
        try {
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: streamError?.message || 'Beklenmedik bir hata olustu.' })}\n\n`,
          );
        } catch { /* response closed */ }
      }
    }

    // Extract last assistant content AFTER streaming (not during — avoids blocking)
    try {
      const fullSse = Buffer.concat(rawChunks).toString('utf-8');
      const events = fullSse.split('\n\n');
      for (let i = events.length - 1; i >= 0; i--) {
        const block = events[i].trim();
        if (!block) continue;
        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (!dataMatch?.[1]) continue;
        try {
          const data = JSON.parse(dataMatch[1]);
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            const last = data.messages[data.messages.length - 1];
            if (last.type === 'ai') {
              const text = extractTextContent(last.content);
              if (text) {
                lastAssistantContent = text;
                break; // Found the last AI message
              }
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* extraction failed — non-critical */ }

    if (lastAssistantContent) {
      await this.conversationService.saveAssistantMessage(
        conversation.id,
        lastAssistantContent,
      ).catch((err) => {
        this.logger.warn(`[stream] Failed to save assistant message: ${err?.message}`);
      });
    }

    this.logger.log(`[stream] Done (${Date.now() - startTime}ms)`);
    if (!clientDisconnected) res.end();
  }
}
