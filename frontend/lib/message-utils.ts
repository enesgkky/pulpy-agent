import type { Message } from "@langchain/langgraph-sdk"

export function getMessageText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text ?? "")
      .join("")
  }
  return ""
}

export function isHumanMessage(msg: Message): boolean {
  return msg.type === "human"
}

export function isAIMessage(msg: Message): boolean {
  return msg.type === "ai"
}
