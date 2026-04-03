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
<<<<<<< Updated upstream
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
=======
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
>>>>>>> Stashed changes
import type { Response } from 'express';
import { ConversationService } from './conversation.service';
import { AgentService } from '../agent/agent.service';
import { SandboxService } from '../agent/sandbox.service';
import { join } from 'path';
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

  // ─── Message History ──────────────────────────────────────

  @Get(':id/history')
  findHistory(@Param('id') id: string) {
    return this.conversationService.findHistory(id);
  }

  // ─── File Upload ─────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
        filename: (_req, file, cb) => {
          const uniqueName = `${randomUUID()}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
    }),
  )
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    return files.map((f) => ({
      filename: f.filename,
      originalName: f.originalname.normalize('NFC'),
      path: f.path,
      size: f.size,
    }));
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

<<<<<<< Updated upstream
    this.logger.log(
      `Test 12345`,
    );
=======
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
>>>>>>> Stashed changes

    const mcpTools = dto.mcpServers?.length
      ? await getMcpTools(dto.mcpServers)
      : [];

    this.logger.log(
      `Test After Mcp code`,
    );

    const agentOptions = {
      service: dto.service,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl,
      model: dto.model,
      backend,
      mcpTools,
      uploadedFiles: uploadedFiles.length ? uploadedFiles : undefined,
    };

    this.logger.log(
      `Test After Agent Options code`,
    );

    // Send conversationId as custom SSE event
    res.write(
      `event: custom\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`,
    );

    this.logger.log(
      `Test Before Stream code`,
    );

    const { stream: sseStream } = await this.agentService.getEncodedStream(
      history,
      agentOptions,
    );

    this.logger.log(
      `Test After Stream code`,
    );

    const decoder = new TextDecoder();
    let sseBuffer = '';
    let lastAssistantContent = '';

    this.logger.log(
      `Test Before Try code`,
    );

    try {
      this.logger.log('Test Entered try block, waiting for first chunk');
      let chunkCount = 0;
      for await (const chunk of sseStream) {
        chunkCount++;
        this.logger.log(`Test Received chunk #${chunkCount}, type: ${typeof chunk}, isBuffer: ${Buffer.isBuffer(chunk)}`);
        
        try {
          const bufferChunk = Buffer.from(chunk);
          this.logger.log(`Test Buffered chunk #${chunkCount}, byteLength: ${bufferChunk.byteLength}`);
          const writeResult = res.write(bufferChunk);
          this.logger.log(`Test res.write returned: ${writeResult}`);
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
            this.logger.log(`Test Called res.flush()`);
          }
        } catch (bufErr: any) {
          this.logger.error(`Test Error writing chunk #${chunkCount}: ${bufErr?.message}`, bufErr?.stack);
        }

        sseBuffer += decoder.decode(chunk, { stream: true });
        const events = sseBuffer.split('\n\n');
        this.logger.log(`Test Chunk #${chunkCount} yielded ${events.length} potential events`);
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
                if (text) {
                  lastAssistantContent = text;
                  this.logger.log(`Test parsed AI text content (length: ${text.length})`);
                }
              }
            }
          } catch (parseErr: any) {
            this.logger.warn(`Test Failed to parse data block: ${parseErr?.message}`);
          }
        }
        this.logger.log(`Test Finished processing chunk #${chunkCount}`);
      }
      this.logger.log(`Test Exited for-await loop. Total chunks: ${chunkCount}`);
    } catch (streamError: any) {
      this.logger.error(`Test [stream] Error caught during iteration: ${streamError?.message}`, streamError?.stack);
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
