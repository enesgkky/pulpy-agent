import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
} from '@langchain/core/messages';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import {
  CreateConversationDto,
  UpdateConversationDto,
  SendMessageDto,
} from './dto/send-message.dto';

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  // ─── Conversation CRUD ────────────────────────────────────

  async create(dto: CreateConversationDto): Promise<Conversation> {
    const conversation = this.conversationRepo.create({ title: dto.title });
    return this.conversationRepo.save(conversation);
  }

  async findAll(): Promise<Conversation[]> {
    return this.conversationRepo.find({
      order: { updatedAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  async update(id: string, dto: UpdateConversationDto): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOneBy({ id });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    Object.assign(conversation, dto);
    return this.conversationRepo.save(conversation);
  }

  async remove(id: string): Promise<void> {
    const result = await this.conversationRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Conversation not found');
    }
  }

  // ─── Message History ──────────────────────────────────────

  async findHistory(conversationId: string): Promise<Message[]> {
    const conversation = await this.conversationRepo.findOneBy({
      id: conversationId,
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  // ─── LangChain History ─────────────────────────────────────

  async getLangChainHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.findHistory(conversationId);
    return messages.map((msg) => this.toBaseMessage(msg));
  }

  toBaseMessage(msg: Message): BaseMessage {
    switch (msg.role) {
      case 'user':
        return new HumanMessage({ content: msg.content, id: msg.id });
      case 'assistant':
        return new AIMessage({ content: msg.content, id: msg.id });
    }
  }

  // ─── Messaging ────────────────────────────────────────────

  async sendMessage(
    dto: SendMessageDto,
  ): Promise<{ conversation: Conversation; userMessage: Message }> {
    let conversation: Conversation;

    if (dto.conversationId) {
      const found = await this.conversationRepo.findOneBy({
        id: dto.conversationId,
      });
      if (!found) {
        throw new NotFoundException('Conversation not found');
      }
      conversation = found;
    } else {
      const title =
        dto.content.length > 30
          ? dto.content.slice(0, 30) + '…'
          : dto.content;
      conversation = this.conversationRepo.create({ title });
      conversation = await this.conversationRepo.save(conversation);
    }

    const userMessage = this.messageRepo.create({
      role: 'user',
      content: dto.content,
      conversationId: conversation.id,
    });
    await this.messageRepo.save(userMessage);

    return { conversation, userMessage };
  }

  async saveAssistantMessage(
    conversationId: string,
    content: string,
  ): Promise<Message> {
    const message = this.messageRepo.create({
      role: 'assistant',
      content,
      conversationId,
    });
    return this.messageRepo.save(message);
  }
}
