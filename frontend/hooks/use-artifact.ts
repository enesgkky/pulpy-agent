"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { Message } from "@langchain/langgraph-sdk"

export interface ArtifactVersion {
  code: string
  title: string
  description: string
  timestamp: number
}

export interface ArtifactState {
  status: "closed" | "loading" | "rendering" | "active" | "error"
  code: string | null
  title: string
  description: string
  error: string | null
  history: ArtifactVersion[]
  activeVersion: number
}

const INITIAL_STATE: ArtifactState = {
  status: "closed",
  code: null,
  title: "",
  description: "",
  error: null,
  history: [],
  activeVersion: -1,
}

interface ToolCall {
  name: string
  args: Record<string, unknown>
  id?: string
}

function getToolCalls(msg: Message): ToolCall[] {
  if (msg.type !== "ai") return []
  return ((msg as any).tool_calls ?? []) as ToolCall[]
}

/**
 * Check tool_call_chunks for a pending render_dashboard call
 * that hasn't completed yet (args still streaming).
 */
function hasPendingDashboardChunk(msg: Message): boolean {
  if (msg.type !== "ai") return false
  const chunks = ((msg as any).tool_call_chunks ?? []) as any[]
  return chunks.some(
    (c: any) =>
      c.name === "render_dashboard" ||
      (typeof c.args === "string" && c.args.includes("jsx_code"))
  )
}

export function useArtifact(messages: Message[], isLoading: boolean) {
  const [artifact, setArtifact] = useState<ArtifactState>(INITIAL_STATE)
  const seenToolCallIds = useRef<Set<string>>(new Set())

  // Scan messages for render_dashboard tool calls
  useEffect(() => {
    let latestDashboardCall: { args: Record<string, unknown>; id: string } | null = null
    let foundPendingChunk = false

    for (const msg of messages) {
      // Check completed tool calls
      for (const tc of getToolCalls(msg)) {
        if (tc.name === "render_dashboard" && tc.args?.jsx_code) {
          latestDashboardCall = {
            args: tc.args,
            id: tc.id || `tc-${Date.now()}`,
          }
        }
      }

      // Check streaming chunks (tool call in progress)
      if (isLoading && hasPendingDashboardChunk(msg)) {
        foundPendingChunk = true
      }
    }

    // If we found a pending chunk but no completed call yet → loading
    if (foundPendingChunk && !latestDashboardCall && isLoading) {
      setArtifact((prev) => {
        if (prev.status === "closed" || prev.status === "active") {
          return { ...prev, status: "loading", error: null }
        }
        return prev
      })
      return
    }

    // If we found a completed render_dashboard call we haven't seen yet
    if (latestDashboardCall && !seenToolCallIds.current.has(latestDashboardCall.id)) {
      seenToolCallIds.current.add(latestDashboardCall.id)
      const { args, id } = latestDashboardCall
      const jsxCode = args.jsx_code as string
      const title = (args.title as string) || "Dashboard"
      const description = (args.description as string) || ""

      setArtifact((prev) => ({
        status: "rendering",
        code: jsxCode,
        title,
        description,
        error: null,
        history: [
          ...prev.history,
          { code: jsxCode, title, description, timestamp: Date.now() },
        ],
        activeVersion: prev.history.length, // index of the newly pushed item
      }))
    }
  }, [messages, isLoading])

  const closePanel = useCallback(() => {
    setArtifact((prev) => ({ ...prev, status: "closed" }))
  }, [])

  /** Manually render JSX code (fallback when agent pastes code in chat) */
  const renderCode = useCallback((code: string) => {
    setArtifact((prev) => ({
      status: "rendering",
      code,
      title: "Dashboard",
      description: "",
      error: null,
      history: [
        ...prev.history,
        { code, title: "Dashboard", description: "", timestamp: Date.now() },
      ],
      activeVersion: prev.history.length,
    }))
  }, [])

  const setVersion = useCallback((index: number) => {
    setArtifact((prev) => {
      const version = prev.history[index]
      if (!version) return prev
      return {
        ...prev,
        status: "rendering",
        code: version.code,
        title: version.title,
        description: version.description,
        error: null,
        activeVersion: index,
      }
    })
  }, [])

  const onRenderSuccess = useCallback(() => {
    setArtifact((prev) => {
      if (prev.status === "rendering") {
        return { ...prev, status: "active" }
      }
      return prev
    })
  }, [])

  const onRenderError = useCallback((error: string) => {
    setArtifact((prev) => ({ ...prev, status: "error", error }))
  }, [])

  // Generate a retry message for the agent
  const retryMessage =
    artifact.status === "error" && artifact.error && artifact.code
      ? `The dashboard failed to render with this error:\n\n${artifact.error}\n\nPlease fix the JSX code and call render_dashboard again. Here was the broken code:\n\n${artifact.code.slice(0, 500)}...`
      : null

  return {
    artifact,
    closePanel,
    setVersion,
    onRenderSuccess,
    onRenderError,
    renderCode,
    retryMessage,
  }
}
