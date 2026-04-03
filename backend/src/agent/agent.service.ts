import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { LocalShellBackend } from 'deepagents';
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import type { StructuredTool } from '@langchain/core/tools';
import { renderDashboardTool } from './tools/render-dashboard.tool';

export interface AgentOptions {
  service?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  backend?: LocalShellBackend;
  mcpTools?: StructuredTool[];
  uploadedFiles?: string[];
}

@Injectable()
export class AgentService {
  constructor(private readonly config: ConfigService) { }

  private createModel(options: AgentOptions): BaseLanguageModel | undefined {
    const service = options.service;
    if (!service) return undefined;

    switch (service) {
      case 'openai': {
        const apiKey =
          options.apiKey || this.config.get<string>('OPENAI_API_KEY');
        if (!apiKey) return undefined;
        return new ChatOpenAI({ openAIApiKey: apiKey, model: 'gpt-4.1' });
      }
      case 'anthropic': {
        const apiKey =
          options.apiKey || this.config.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) return undefined;
        return new ChatAnthropic({
          anthropicApiKey: apiKey,
          model: 'claude-sonnet-4-5',
        });
      }
      case 'google': {
        const apiKey =
          options.apiKey || this.config.get<string>('GOOGLE_API_KEY');
        if (!apiKey) return undefined;
        return new ChatGoogleGenerativeAI({
          apiKey,
          model: 'gemini-2.5-flash',
        });
      }
      case 'viziowise': {
        const apiKey = options.apiKey || 'not-needed';
        const baseUrl =
          options.baseUrl ||
          this.config.get<string>('VIZIOWISE_BASE_URL');
        if (!baseUrl) return undefined;
        const modelName =
          options.model ||
          this.config.get<string>('VIZIOWISE_MODEL') ||
          'Qwen/Qwen3.5-35B-A3B';
        return new ChatOpenAI({
          openAIApiKey: apiKey,
          configuration: { baseURL: baseUrl },
          model: modelName,
        });
      }
      default:
        return undefined;
    }
  }

  private createAgent(options: AgentOptions) {
    const model = this.createModel(options);

    let systemPrompt = `You are Morf, a corporate AI assistant developed by Viziowise AI.

You help professionals with business tasks including data analysis, report generation, code development, research, and strategic planning.

Guidelines:
- Be concise, accurate, and professional.
- When analyzing data, provide actionable insights with specific numbers.
- When writing code, follow best practices and include clear explanations.
- Use available skills when they match the user's request.
- If the user writes in Turkish, respond in Turkish. Otherwise match the user's language.
- Structure complex answers with headings, lists, and tables where appropriate.

File handling:
- Users may upload files. Uploaded files are stored in the /uploads/ directory.
- When a user mentions a file or you need to work with uploaded data, first run \`ls /uploads/\` to discover available files.
- For Excel/CSV files: use Python with pandas or openpyxl to read and analyze.
- For PDF files: use Python with pdfplumber or pypdf to extract text and tables.
- For SQL files: read the file content and analyze the queries.
- Always read the actual file content before responding about it.

## Dashboard Rendering — MANDATORY

**CRITICAL RULE: When the user asks to visualize, chart, display, or see data as a dashboard/component/graph/table — you MUST call the render_dashboard tool. NEVER paste JSX/React code as text in the chat. NEVER put code in a code block. The ONLY way to show a dashboard is by calling render_dashboard.**

Steps:
1. Fetch/analyze the data first using available tools
2. Generate a COMPLETE React JSX component with ALL data embedded as a const
3. Call render_dashboard(jsx_code=..., title=..., description=...)
4. After calling render_dashboard, briefly tell the user what the dashboard shows in 1-2 sentences

Rules:
- NEVER put JSX in a markdown code block — ALWAYS use render_dashboard tool
- NEVER call render_dashboard with placeholder/dummy data — use real fetched data
- If the dataset has more than 200 rows, aggregate it first
- Don't explain the JSX code to the user
- Don't generate TypeScript — plain JSX only
- Use libraries ONLY from: React 18, Recharts, Lucide React, Tailwind CSS
- If the user says "dashboard", "chart", "visualize", "graph", "component", "show me" — use render_dashboard
- Use ONLY ASCII variable/function names (no Turkish/Unicode characters like ü, ö, ş, ğ, ç, ı). Use English names like "countries" not "ülkeler", "invoiceCount" not "faturaSayısı"
- For Google Fonts, use this EXACT pattern: <style>{\`@import url('...');\`}</style> — ALWAYS wrap CSS in {\`backticks\`} inside <style> tags. NEVER write bare CSS inside <style>`;

    if (options.uploadedFiles?.length) {
      systemPrompt += `\n\nThe following files were just uploaded and are available in the workspace:\n${options.uploadedFiles.map((f) => `- ${f}`).join('\n')}`;
    }

    const agentOptions: Parameters<typeof createDeepAgent>[0] = {
      systemPrompt,
    };

    if (model) {
      agentOptions.model = model;
    }

    if (options.backend) {
      agentOptions.backend = options.backend;
      agentOptions.skills = ['/skills/'];
    }

    const tools: StructuredTool[] = [renderDashboardTool as unknown as StructuredTool];
    if (options.mcpTools?.length) {
      tools.push(...options.mcpTools);
    }
    agentOptions.tools = tools;

    return createDeepAgent(agentOptions);
  }

  async getEncodedStream(
    messages: BaseMessage[],
    options: AgentOptions = {},
  ) {
    const startTime = Date.now();
    const agent = this.createAgent(options);

    const stream = await agent.stream(
      { messages },
      {
        encoding: 'text/event-stream',
        streamMode: ['values', 'messages'],
        recursionLimit: 500,
      },
    );

    return { stream, startTime };
  }
}
