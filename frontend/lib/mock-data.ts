export type MessageRole = "user" | "assistant"

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: Date
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: Date
}

export const SUGGESTIONS = [
  "Next.js App Router nasıl çalışır?",
  "TypeScript generics açıkla",
  "React Server Components nedir?",
  "Tailwind CSS ile responsive tasarım",
]
