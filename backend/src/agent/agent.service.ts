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

export interface AgentOptions {
  service?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  backend?: LocalShellBackend;
  mcpTools?: StructuredTool[];
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

    const agentOptions: Parameters<typeof createDeepAgent>[0] = {
      systemPrompt: `You are Pulpy, a corporate AI assistant.

You help professionals with business tasks including data analysis, report generation, code development, research, and strategic planning.

Guidelines:
- Be concise, accurate, and professional.
- When analyzing data, provide actionable insights with specific numbers.
- When writing code, follow best practices and include clear explanations.
- Use available skills when they match the user's request.
- If the user writes in Turkish, respond in Turkish. Otherwise match the user's language.
- Structure complex answers with headings, lists, and tables where appropriate.`,
    };

    if (model) {
      agentOptions.model = model;
    }

    if (options.backend) {
      agentOptions.backend = options.backend;
      agentOptions.skills = ['/skills/'];
    }

    if (options.mcpTools?.length) {
      agentOptions.tools = options.mcpTools;
    }

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
      },
    );

    return { stream, startTime };
  }
}
