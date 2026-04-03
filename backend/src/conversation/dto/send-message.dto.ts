export class CreateConversationDto {
  title: string;
}

export class UpdateConversationDto {
  title?: string;
}

export class McpServerDto {
  name: string;
  url: string;
}

export class FileReferenceDto {
  filename: string;
  originalName: string;
  path: string;
}

export class SendMessageDto {
  content: string;
  conversationId?: string;
  service?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  mcpServers?: McpServerDto[];
  files?: FileReferenceDto[];
  previousArtifact?: string;
}
