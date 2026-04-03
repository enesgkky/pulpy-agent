import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { LocalShellBackend } from 'deepagents';
import { mkdir, cp, rm, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/** Normalize Unicode to NFC and replace problematic characters for safe filenames */
function sanitizeFilename(name: string): string {
  return name.normalize('NFC');
}

interface BackendEntry {
  backend: LocalShellBackend;
  rootDir: string;
  createdAt: number;
  lastUsedAt: number;
}

const SKILLS_DIR = join(process.cwd(), 'skills');
const WORKSPACES_DIR = join(process.cwd(), 'workspaces');

const WORKSPACE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every minute
const SANDBOX_MAX_RETRIES = 3;
const SANDBOX_RETRY_DELAY_MS = 1000;

@Injectable()
export class SandboxService implements OnModuleDestroy {
  private readonly logger = new Logger(SandboxService.name);
  private readonly backends = new Map<string, BackendEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  async getOrCreate(conversationId: string): Promise<LocalShellBackend> {
    const existing = this.backends.get(conversationId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      this.logger.log(
        `[sandbox] Reusing backend for conversation ${conversationId}`,
      );
      return existing.backend;
    }

    const rootDir = await this.getWorkspaceDir(conversationId);

    for (let attempt = 1; attempt <= SANDBOX_MAX_RETRIES; attempt++) {
      try {
        await mkdir(rootDir, { recursive: true });

        // Copy skills into the workspace
        if (existsSync(SKILLS_DIR)) {
          const skillsDest = join(rootDir, 'skills');
          await cp(SKILLS_DIR, skillsDest, { recursive: true });
          this.logger.log(`[sandbox] Skills copied to ${skillsDest}`);
        }

        const backend = await LocalShellBackend.create({
          rootDir,
          virtualMode: true,
          inheritEnv: true,
          timeout: 600,
          maxOutputBytes: 2_000_000,
        });

        this.backends.set(conversationId, {
          backend,
          rootDir,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        });

        this.logger.log(
          `[sandbox] Created local backend for conversation ${conversationId} at ${rootDir}`,
        );

        return backend;
      } catch (err: any) {
        if (attempt < SANDBOX_MAX_RETRIES) {
          this.logger.warn(
            `[sandbox] Backend oluşturma hatası (deneme ${attempt}/${SANDBOX_MAX_RETRIES}): ${err?.message} — tekrar deneniyor`,
          );
          await new Promise((r) => setTimeout(r, SANDBOX_RETRY_DELAY_MS));
        } else {
          this.logger.error(
            `[sandbox] Backend oluşturulamadı (${SANDBOX_MAX_RETRIES} deneme başarısız): ${err?.message}`,
          );
          throw err;
        }
      }
    }

    // TypeScript: unreachable but satisfies return type
    throw new Error('Sandbox oluşturulamadı');
  }

  async getWorkspaceDir(conversationId: string): Promise<string> {
    const rootDir = join(WORKSPACES_DIR, conversationId);
    if (!existsSync(rootDir)) {
      await mkdir(rootDir, { recursive: true });
    }
    const existing = this.backends.get(conversationId);
    if (existing) {
      existing.lastUsedAt = Date.now();
    }
    return rootDir;
  }

  /** Copy uploaded files into the conversation workspace and return workspace-relative paths */
  async copyFilesToWorkspace(
    conversationId: string,
    files: { path: string; originalName: string }[],
  ): Promise<string[]> {
    const entry = this.backends.get(conversationId);
    if (!entry) return [];

    const uploadsDir = join(entry.rootDir, 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const workspacePaths: string[] = [];
    for (const file of files) {
      const safeName = sanitizeFilename(file.originalName);
      const dest = join(uploadsDir, safeName);
      await copyFile(file.path, dest);
      workspacePaths.push(safeName);
      this.logger.log(
        `[sandbox] Copied ${safeName} to workspace ${conversationId}`,
      );
    }
    return workspacePaths;
  }

  async remove(conversationId: string): Promise<void> {
    const entry = this.backends.get(conversationId);
    if (entry) {
      this.backends.delete(conversationId);
      try {
        await entry.backend.close();
        await rm(entry.rootDir, { recursive: true, force: true });
        this.logger.log(
          `[sandbox] Removed backend for conversation ${conversationId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[sandbox] Error removing backend: ${err?.message}`,
        );
      }
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [convId, entry] of this.backends) {
      if (now - entry.lastUsedAt > WORKSPACE_TTL_MS) {
        this.logger.log(
          `[sandbox] TTL expired for conversation ${convId}`,
        );
        await this.remove(convId);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.cleanupTimer);
    const ids = [...this.backends.keys()];
    this.logger.log(
      `[sandbox] Shutting down ${ids.length} active backends`,
    );
    await Promise.allSettled(ids.map((id) => this.remove(id)));
  }
}
