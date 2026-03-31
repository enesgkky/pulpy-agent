import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { SandboxService } from './sandbox.service';

@Module({
  providers: [AgentService, SandboxService],
  exports: [AgentService, SandboxService],
})
export class AgentModule {}
