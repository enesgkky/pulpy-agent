"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import dynamic from "next/dynamic"
import { useStream, FetchStreamTransport } from "@langchain/langgraph-sdk/react"
import type { Message } from "@langchain/langgraph-sdk"
import { useStickToBottomContext } from "use-stick-to-bottom"
import { BASE_URL, fetchConversation, type UploadedFile } from "@/lib/api"
import { loadSettings } from "./settings-dialog"
import { ChatMessages, type ArtifactInfo } from "./chat-messages"
import { ArtifactPanel } from "./artifact-panel"
import { ChatInput } from "./chat-input"
import { ChatSidebar } from "./chat-sidebar"
import { toast } from "sonner"

const SettingsDialog = dynamic(
  () => import("./settings-dialog").then((m) => m.SettingsDialog),
  { ssr: false },
)
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatLayoutProps {
  conversationId?: string
}

/** Rendered inside StickToBottom (has context), but portals button into the input area */
function ScrollButtonPortal({ container }: { container: HTMLElement | null }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  if (!container) return null

  return createPortal(
    <div
      className={cn(
        "absolute -top-11 left-1/2 -translate-x-1/2 z-50 transition-all duration-150 ease-out",
        isAtBottom
          ? "pointer-events-none translate-y-2 opacity-0"
          : "translate-y-0 opacity-100"
      )}
    >
      <Button
        size="icon"
        variant="outline"
        onClick={() => scrollToBottom()}
        className="h-8 w-8 rounded-full shadow-md"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>,
    container
  )
}

export function ChatLayout({ conversationId: initialConvId }: ChatLayoutProps) {
  const [convId, setConvId] = useState(initialConvId)
  const convIdRef = useRef(initialConvId)
  const [history, setHistory] = useState<Message[]>([])
  const [inputAreaEl, setInputAreaEl] = useState<HTMLElement | null>(null)
  const prevMessagesRef = useRef<Message[]>([])
  const [activeArtifact, setActiveArtifact] = useState<{ url: string; title: string } | null>(null)
  const [savedArtifacts, setSavedArtifacts] = useState<ArtifactInfo[]>([])
  const lastOpenedArtifactRef = useRef<string | null>(null)
  const humanCountRef = useRef(0)
  const filesByHumanIndexRef = useRef<Map<number, UploadedFile[]>>(new Map())

  useEffect(() => {
    // Reset all state when conversation changes
    setActiveArtifact(null)
    lastOpenedArtifactRef.current = null

    if (!initialConvId) {
      setHistory([])
      setSavedArtifacts([])
      return
    }
    fetchConversation(initialConvId)
      .then((conv) => {
        const msgs: Message[] = conv.messages.map((m) => ({
          id: m.id,
          type: m.role === "user" ? "human" : "ai",
          content: m.content,
        })) as Message[]
        setHistory(msgs)
      })
      .catch(() => setHistory([]))

    // Load saved artifacts for this conversation
    fetch(`${BASE_URL}/conversation/${initialConvId}/artifacts`)
      .then((r) => r.json())
      .then((list: { filename: string }[]) => {
        setSavedArtifacts(list.map((a) => ({ filename: a.filename, path: `artifacts/${a.filename}` })))
      })
      .catch(() => setSavedArtifacts([]))
  }, [initialConvId])

  // Pending files ref — set before submit, consumed by transport
  const pendingFilesRef = useRef<UploadedFile[] | undefined>(undefined)

  // transport is created once — convId is read via ref to avoid recreation on convId change
  const transport = useMemo( () =>
      new FetchStreamTransport({
        apiUrl: `${BASE_URL}/conversation/stream`,
        onRequest: async (_url, init) => {
          const body = JSON.parse(init.body as string)
          const messages = body.input?.messages ?? []
          const lastHuman = [...messages]
            .reverse()
            .find((m: any) => m.type === "human")

          const settings = loadSettings()
          const svc = settings.activeService

          const apiKey =
            svc === "viziowise"
              ? settings.viziowise.apiKey
              : settings.apiKeys[svc as keyof typeof settings.apiKeys]

          // Consume pending files
          const files = pendingFilesRef.current
          pendingFilesRef.current = undefined

          return {
            ...init,
            body: JSON.stringify({
              content:
                typeof lastHuman?.content === "string"
                  ? lastHuman.content
                  : "",
              conversationId: convIdRef.current,
              service: svc,
              apiKey: apiKey || undefined,
              baseUrl:
                svc === "viziowise"
                  ? settings.viziowise.baseUrl || undefined
                  : undefined,
              model:
                svc === "viziowise"
                  ? settings.viziowise.model || undefined
                  : undefined,
              mcpServers:
                settings.mcpServers?.length
                  ? settings.mcpServers
                  : undefined,
              files: files?.length ? files : undefined,
            }),
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const thread = useStream({
    transport,
    onCustomEvent: (event: any) => {
      if (event.conversationId && !convIdRef.current) {
        convIdRef.current = event.conversationId
        setConvId(event.conversationId)
        window.history.replaceState(null, "", `/c/${event.conversationId}`)
      }
    },
  })

  // thread.messages includes full conversation history during streaming.
  // Use it when available; fall back to history (API-loaded) for initial render;
  // keep prevMessagesRef so the list never flashes empty on submit reset.
  const displayMessages = useMemo(() => {
    if (thread.messages.length > 0) {
      prevMessagesRef.current = thread.messages
      return thread.messages
    }
    if (history.length > 0) {
      prevMessagesRef.current = history
      return history
    }
    return prevMessagesRef.current
  }, [history, thread.messages])

  // Auto-open artifact: detect from tool calls OR poll after streaming ends
  const prevIsLoadingRef = useRef(false)

  // Method 1: Detect artifact from tool calls in real-time
  useEffect(() => {
    const id = convIdRef.current
    if (!id) return

    const openArtifact = (filename: string) => {
      if (filename && filename !== lastOpenedArtifactRef.current) {
        lastOpenedArtifactRef.current = filename
        setActiveArtifact({
          url: `${BASE_URL}/conversation/${id}/artifacts/${filename}`,
          title: filename,
        })
      }
    }

    for (const msg of displayMessages) {
      if (msg.type !== "ai") continue
      const aiMsg = msg as any

      // Only check fully parsed tool_calls (not chunks/invalid — those fire too early)
      const calls = (aiMsg.tool_calls ?? []) as { name: string; args: Record<string, any> }[]
      for (const call of calls) {
        const filePath = call.args?.file_path || call.args?.path || ""
        if (
          call.name === "write_file" &&
          typeof filePath === "string" &&
          (filePath.startsWith("artifacts/") || filePath.includes("/artifacts/"))
        ) {
          openArtifact(filePath.split("/").pop() || filePath)
        }
      }
    }
  }, [displayMessages])

  // Method 2: Fallback — check artifacts endpoint when streaming finishes
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current
    prevIsLoadingRef.current = thread.isLoading
    if (wasLoading && !thread.isLoading) {
      const id = convIdRef.current
      if (!id) return
      fetch(`${BASE_URL}/conversation/${id}/artifacts`)
        .then((r) => r.json())
        .then((artifacts: { filename: string }[]) => {
          // Update savedArtifacts for persistent cards
          setSavedArtifacts(artifacts.map((a) => ({ filename: a.filename, path: `artifacts/${a.filename}` })))
          if (artifacts.length > 0) {
            const latest = artifacts[artifacts.length - 1]
            if (latest.filename !== lastOpenedArtifactRef.current) {
              lastOpenedArtifactRef.current = latest.filename
              setActiveArtifact({
                url: `${BASE_URL}/conversation/${id}/artifacts/${latest.filename}`,
                title: latest.filename,
              })
            }
          }
        })
        .catch(() => {})
    }
  }, [thread.isLoading])

  const handleSubmit = useCallback(
    (text: string, files?: UploadedFile[]) => {
      if (files?.length) {
        pendingFilesRef.current = files
        filesByHumanIndexRef.current.set(humanCountRef.current, files)
      }
      humanCountRef.current++
      thread.submit({
        messages: [{ type: "human", content: text }],
      } as any)
    },
    [thread],
  )

  const handleOpenArtifact = useCallback(
    (artifact: ArtifactInfo) => {
      const id = convIdRef.current
      if (!id) return
      setActiveArtifact({
        url: `${BASE_URL}/conversation/${id}/artifacts/${artifact.filename}`,
        title: artifact.filename,
      })
    },
    [],
  )

  const handleStop = () => {
    thread.stop()
  }

  return (
    <SidebarProvider className="h-dvh overflow-hidden">
      <ChatSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h1 className="text-lg font-semibold">Morf V2</h1>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <SettingsDialog />
          </div>
        </header>

        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={activeArtifact ? 50 : 100} minSize={30}>
            <div className="flex h-full flex-col">
              <ChatContainerRoot className="min-h-0 flex-1">
                <ChatContainerContent className="mx-auto max-w-4xl gap-4 p-4">
                  <ChatMessages
                    messages={displayMessages}
                    isLoading={thread.isLoading}
                    filesByHumanIndex={filesByHumanIndexRef.current}
                    savedArtifacts={savedArtifacts}
                    onOpenArtifact={handleOpenArtifact}
                  />
                  <ChatContainerScrollAnchor />
                </ChatContainerContent>

                <ScrollButtonPortal container={inputAreaEl} />
              </ChatContainerRoot>

              <div
                ref={setInputAreaEl}
                className="relative shrink-0 border-t p-4"
              >
                <div className="mx-auto flex max-w-4xl justify-center">
                  <ChatInput
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                    isLoading={thread.isLoading}
                  />
                </div>
              </div>
            </div>
          </ResizablePanel>

          {activeArtifact && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={25}>
                <ArtifactPanel
                  url={activeArtifact.url}
                  title={activeArtifact.title}
                  onClose={() => setActiveArtifact(null)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  )
}
