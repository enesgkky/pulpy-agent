import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { SandboxService } from './sandbox.service';
import { TableStoreService, TablesController } from './tools';

@Module({
  controllers: [TablesController],
  providers: [AgentService, SandboxService, TableStoreService],
  exports: [AgentService, SandboxService, TableStoreService],
})
export class AgentModule {}
