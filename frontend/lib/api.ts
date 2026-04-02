export const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000"

export interface ApiConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ApiMessage {
  id: string
  role: "user" | "assistant"
  content: string
  conversationId: string
  createdAt: string
}

export async function fetchConversations(): Promise<ApiConversation[]> {
  const res = await fetch(`${BASE_URL}/conversation`)
  if (!res.ok) throw new Error("Failed to fetch conversations")
  return res.json()
}

export async function fetchConversation(
  id: string
): Promise<ApiConversation & { messages: ApiMessage[] }> {
  const res = await fetch(`${BASE_URL}/conversation/${id}`)
  if (!res.ok) throw new Error("Failed to fetch conversation")
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/conversation/${id}`, {
    method: "DELETE",
  })
  if (!res.ok) throw new Error("Failed to delete conversation")
}

export async function createConversation(title?: string): Promise<ApiConversation> {
  const res = await fetch(`${BASE_URL}/conversation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error("Failed to create conversation")
  return res.json()
}

export interface McpTestResult {
  success: boolean
  serverInfo?: { name: string; version: string }
  tools?: { name: string; description?: string }[]
  error?: string
}

export async function testMcpConnection(url: string): Promise<McpTestResult> {
  const res = await fetch(`${BASE_URL}/mcp/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error("MCP test request failed")
  return res.json()
}

export async function uploadFile(
  conversationId: string,
  file: File
): Promise<{ filename: string; size: number }> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch(`${BASE_URL}/conversation/${conversationId}/upload`, {
    method: "POST",
    body: formData,
  })
  if (!res.ok) throw new Error("Failed to upload file")
  return res.json()
}

