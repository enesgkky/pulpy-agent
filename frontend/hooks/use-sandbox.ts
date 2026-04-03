"use client"

import { useState, useEffect, useCallback, useRef } from "react"

const RENDER_TIMEOUT_MS = 8000

interface UseSandboxOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onSuccess: () => void
  onError: (error: string) => void
}

export function useSandbox({ iframeRef, onSuccess, onError }: UseSandboxOptions) {
  const [isReady, setIsReady] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIdRef = useRef<string | null>(null)

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, id, error } = event.data ?? {}

      if (type === "SANDBOX_READY") {
        setIsReady(true)
        return
      }

      if (type === "RENDER_SUCCESS" && id === pendingIdRef.current) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        pendingIdRef.current = null
        onSuccess()
        return
      }

      if (type === "RENDER_ERROR" && id === pendingIdRef.current) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        pendingIdRef.current = null
        onError(error || "Unknown render error")
        return
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [onSuccess, onError])

  const sendCode = useCallback(
    (code: string, id: string) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) {
        onError("Sandbox iframe is not available")
        return
      }

      pendingIdRef.current = id
      if (timeoutRef.current) clearTimeout(timeoutRef.current)

      iframe.contentWindow.postMessage(
        { type: "RENDER_ARTIFACT", code, id },
        "*"
      )

      // Timeout: if no success/error after RENDER_TIMEOUT_MS, treat as error
      timeoutRef.current = setTimeout(() => {
        if (pendingIdRef.current === id) {
          pendingIdRef.current = null
          onError("Dashboard render timed out. The component may have an infinite loop or heavy computation.")
        }
      }, RENDER_TIMEOUT_MS)
    },
    [iframeRef, onError]
  )

  return { sendCode, isReady }
}
