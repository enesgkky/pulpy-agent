"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import type { Message } from "@langchain/langgraph-sdk"
import {
  Message as MessageUI,
  MessageContent,
} from "@/components/ui/message"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { getMessageText } from "@/lib/message-utils"
import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  Loader2,
  ListTodo,
} from "lucide-react"

interface ChatMessagesProps {
  messages: Message[]
  isLoading: boolean
}

/* ── types ───────────────────────────────────────── */

interface ToolCall {
  name: string
  args: Record<string, any>
  id?: string
}

interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed"
}

/* ── helpers ─────────────────────────────────────── */

function getToolCalls(msg: Message): ToolCall[] {
  if (msg.type !== "ai") return []
  return ((msg as any).tool_calls ?? []) as ToolCall[]
}

function getToolResultMap(
  messages: Message[]
): Map<string, { content: string; status?: string }> {
  const map = new Map<string, { content: string; status?: string }>()
  for (const m of messages) {
    if (m.type === "tool") {
      const tm = m as any
      map.set(tm.tool_call_id, {
        content: getMessageText(tm.content),
        status: tm.status,
      })
    }
  }
  return map
}

function parseTodosFromPartial(argsStr: string): TodoItem[] | null {
  try {
    const parsed = JSON.parse(argsStr)
    if (Array.isArray(parsed?.todos)) return parsed.todos
  } catch {
    try {
      const wrapped = JSON.parse(`{${argsStr}}`)
      if (Array.isArray(wrapped?.todos)) return wrapped.todos
    } catch {
      /* ignore */
    }
  }
  return null
}

function getLatestTodos(messages: Message[]): TodoItem[] | null {
  let latest: TodoItem[] | null = null
  for (const m of messages) {
    if (m.type !== "ai") continue
    const msg = m as any

    for (const c of getToolCalls(m)) {
      if (c.name === "write_todos" && Array.isArray(c.args?.todos)) {
        latest = c.args.todos as TodoItem[]
      }
    }
    for (const ic of (msg.invalid_tool_calls ?? []) as any[]) {
      const args = ic.args || ic.arg
      if (typeof args === "string" && args.includes("todos")) {
        const parsed = parseTodosFromPartial(args)
        if (parsed) latest = parsed
      }
    }
    for (const chunk of (msg.tool_call_chunks ?? []) as any[]) {
      if (typeof chunk.args === "string" && chunk.args.includes("todos")) {
        const parsed = parseTodosFromPartial(chunk.args)
        if (parsed) latest = parsed
      }
    }
  }
  return latest
}

/** Generate a human-readable label for a tool call */
function getToolLabel(call: ToolCall): string {
  const { name, args } = call
  if (name === "read_file") {
    const path: string = args.path || ""
    const skillMatch = path.match(/\/skills\/([^/]+)/)
    if (skillMatch) return `Reading ${skillMatch[1].replace(/-/g, " ")} skill`
    const filename = path.split("/").pop() || "file"
    return `Reading ${filename}`
  }
  if (name === "write_file") {
    const filename = (args.path || "file").split("/").pop()
    return `Writing ${filename}`
  }
  if (name === "execute_shell" || name === "shell") {
    const cmd: string = args.command || ""
    const short = cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd
    return short ? `Running: ${short}` : "Running command"
  }
  if (name === "ls") {
    const path: string = args.path || ""
    const skillMatch = path.match(/\/skills\/([^/]+)/)
    if (skillMatch) return `Browsing ${skillMatch[1].replace(/-/g, " ")} skill`
    return `Listing ${path || "files"}`
  }
  // MCP and other tools — format the name
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ── sub-components ──────────────────────────────── */

function TodoListBlock({ todos }: { todos: TodoItem[] }) {
  const completed = todos.filter((t) => t.status === "completed").length
  const inProgress = todos.filter((t) => t.status === "in_progress").length
  const pending = todos.filter((t) => t.status === "pending").length
  const total = todos.length

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <ListTodo className="h-4 w-4" />
          <span>Gorevler</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {completed > 0 && (
            <span className="text-green-600 dark:text-green-400">
              {completed} tamamlandi
            </span>
          )}
          {inProgress > 0 && (
            <span className="text-blue-600 dark:text-blue-400">
              {inProgress} devam ediyor
            </span>
          )}
          {pending > 0 && <span>{pending} bekliyor</span>}
        </div>
      </div>

      {total > 0 && (
        <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>
      )}

      <div className="space-y-1">
        {todos.map((todo, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              todo.status === "completed" && "text-muted-foreground"
            )}
          >
            {todo.status === "completed" && (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            )}
            {todo.status === "in_progress" && (
              <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-blue-500 animate-pulse" />
            )}
            {todo.status === "pending" && (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn(todo.status === "completed" && "line-through")}>
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Group consecutive same-name tool calls */
function groupToolCalls(calls: ToolCall[]): ToolCall[][] {
  const groups: ToolCall[][] = []
  for (const call of calls) {
    const last = groups[groups.length - 1]
    if (last && last[0].name === call.name) {
      last.push(call)
    } else {
      groups.push([call])
    }
  }
  return groups
}

/** Stacked group of same-name tool calls */
function ToolCallGroup({
  calls,
  toolResultMap,
}: {
  calls: ToolCall[]
  toolResultMap: Map<string, { content: string; status?: string }>
}) {
  // useState must always be called (Rules of Hooks)
  const [open, setOpen] = useState(false)

  const count = calls.length
  const label = getToolLabel(calls[0])

  if (count === 1) {
    const call = calls[0]
    return (
      <InlineToolCall
        call={call}
        result={call.id ? toolResultMap.get(call.id) : undefined}
      />
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="group flex items-center gap-1 rounded border border-muted-foreground/15 bg-muted/30 px-2 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        style={{
          boxShadow:
            count >= 3
              ? "2px 2.5px 0 0 hsl(var(--border)), 4px 5px 0 0 hsl(var(--border) / 0.5)"
              : "2px 2.5px 0 0 hsl(var(--border))",
        }}
      >
        <span>
          {label}{" "}
          <span className="text-[11px] font-medium text-muted-foreground/60">
            x{count}
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-0.5 ml-2 border-l-2 border-muted pl-3">
          {calls.map((call, i) => (
            <InlineToolCall
              key={call.id ?? `grp-${i}`}
              call={call}
              result={call.id ? toolResultMap.get(call.id) : undefined}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Inline collapsible for a single tool call — looks like Claude web */
function InlineToolCall({
  call,
  result,
}: {
  call: ToolCall
  result?: { content: string; status?: string }
}) {
  const [open, setOpen] = useState(false)
  const isDone = !!result
  const isErr = result?.status === "error"
  const label = getToolLabel(call)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1 py-0.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
        <span>{label}</span>
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mb-1 ml-1 border-l-2 border-muted pl-4 py-1 space-y-1.5">
          {/* Step: action */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </div>

          {/* Step: status */}
          <div className="flex items-center gap-2 text-sm">
            {!isDone && (
              <>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                <span className="text-muted-foreground">Calisiyor...</span>
              </>
            )}
            {isDone && !isErr && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                <span className="text-muted-foreground">Done</span>
              </>
            )}
            {isErr && (
              <>
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5 shrink-0 text-red-500"
                  fill="currentColor"
                >
                  <circle cx="8" cy="8" r="8" opacity="0.15" />
                  <path d="M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z" />
                </svg>
                <span className="text-red-500/80">Hata</span>
              </>
            )}
          </div>

          {/* Optional: input/output detail */}
          {isDone && result.content && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                Detay
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/30 p-2">
                {result.content}
              </pre>
            </details>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Animated spinner — decorative, shown at the bottom while streaming */
function StreamingSpinner() {
  return (
    <div className="py-2">
      <svg
        className="h-8 w-8 animate-spin text-primary/60"
        viewBox="0 0 24 24"
        fill="none"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1="12"
            y1="2"
            x2="12"
            y2="6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity={0.15 + (i / 12) * 0.85}
            transform={`rotate(${i * 30} 12 12)`}
          />
        ))}
      </svg>
    </div>
  )
}

/* ── render item types ───────────────────────────── */

type RenderItem =
  | { kind: "human"; id: string; text: string }
  | { kind: "ai-text"; id: string; text: string; isFinal: boolean }
  | { kind: "tool-group"; id: string; calls: ToolCall[] }

function buildRenderItems(messages: Message[]): RenderItem[] {
  const items: RenderItem[] = []

  for (const msg of messages) {
    if (msg.type === "human") {
      const text = getMessageText(msg.content)
      if (text) items.push({ kind: "human", id: msg.id!, text })
      continue
    }
    if (msg.type === "tool" || msg.type !== "ai") continue

    const text = getMessageText(msg.content).trim()
    const toolCalls = getToolCalls(msg).filter((c) => c.name !== "write_todos")

    if (!text && toolCalls.length === 0) continue

    // Only emit text if it's non-empty and not purely accompanying a tool call
    // (intermediate "thinking" text is OK, but don't let it break consecutive grouping
    //  when it has no real content)
    if (text && toolCalls.length === 0) {
      items.push({
        kind: "ai-text",
        id: `${msg.id}-text`,
        text,
        isFinal: true,
      })
    } else if (text && toolCalls.length > 0) {
      // Intermediate text before tool call — push it, it will break grouping intentionally
      items.push({
        kind: "ai-text",
        id: `${msg.id}-text`,
        text,
        isFinal: false,
      })
    }

    for (const call of toolCalls) {
      const last = items[items.length - 1]
      if (last?.kind === "tool-group" && last.calls[0].name === call.name) {
        last.calls.push(call)
      } else {
        items.push({
          kind: "tool-group",
          id: call.id ?? `${msg.id}-${call.name}`,
          calls: [call],
        })
      }
    }
  }

  return items
}

/* ── main ────────────────────────────────────────── */

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const toolResultMap = getToolResultMap(messages)
  const latestTodos = useMemo(() => getLatestTodos(messages), [messages])
  const renderItems = useMemo(() => buildRenderItems(messages), [messages])

  return (
    <>
      {renderItems.map((item) => {
        if (item.kind === "human") {
          return (
            <MessageUI key={item.id} className="max-w-2xl px-4 py-2 ml-auto">
              <MessageContent className="bg-primary text-primary-foreground rounded-2xl px-4 py-2">
                {item.text}
              </MessageContent>
            </MessageUI>
          )
        }

        if (item.kind === "ai-text") {
          return (
            <div key={item.id} className="w-full px-4 mr-auto">
              {item.isFinal ? (
                <MessageUI className="py-2">
                  <MessageContent
                    markdown
                    className="prose prose-base dark:prose-invert max-w-none"
                  >
                    {item.text}
                  </MessageContent>
                </MessageUI>
              ) : (
                <p className="pb-1 pt-2 text-[15px] text-foreground/80">
                  {item.text}
                </p>
              )}
            </div>
          )
        }

        if (item.kind === "tool-group") {
          return (
            <div key={item.id} className="w-full px-4 mr-auto py-0.5">
              <ToolCallGroup calls={item.calls} toolResultMap={toolResultMap} />
            </div>
          )
        }

        return null
      })}

      {/* Todo progress — only while streaming */}
      {isLoading && latestTodos && (
        <div className="w-full px-4 pt-2 mr-auto">
          <TodoListBlock todos={latestTodos} />
        </div>
      )}

      {/* Spinner — while streaming */}
      {isLoading && (
        <div className="px-4 pt-1 mr-auto">
          <StreamingSpinner />
        </div>
      )}
    </>
  )
}
