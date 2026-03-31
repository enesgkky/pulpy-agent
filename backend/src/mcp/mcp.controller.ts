import { Controller, Post, Body } from '@nestjs/common';
import { McpService, McpTestResult } from './mcp.service';
import { TestMcpDto } from './dto/test-mcp.dto';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Post('test')
  async testConnection(@Body() dto: TestMcpDto): Promise<McpTestResult> {
    return this.mcpService.testConnection(dto.url);
  }
}
