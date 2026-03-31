import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { LocalShellBackend } from 'deepagents';
import { mkdir, cp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

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

    const rootDir = join(WORKSPACES_DIR, conversationId);
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
      timeout: 120,
      maxOutputBytes: 200_000,
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
    await Promise.all(ids.map((id) => this.remove(id)));
  }
}
