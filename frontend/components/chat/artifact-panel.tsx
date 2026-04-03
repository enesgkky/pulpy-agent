"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useSandbox } from "@/hooks/use-sandbox"
import type { ArtifactState } from "@/hooks/use-artifact"
import { ArtifactSkeleton } from "./artifact-skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  X,
  Code2,
  Eye,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

interface ArtifactPanelProps {
  artifact: ArtifactState
  onClose: () => void
  onRenderSuccess: () => void
  onRenderError: (error: string) => void
  onSetVersion: (index: number) => void
  onRetry: (message: string) => void
}

export function ArtifactPanel({
  artifact,
  onClose,
  onRenderSuccess,
  onRenderError,
  onSetVersion,
  onRetry,
}: ArtifactPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const renderIdRef = useRef(0)

  const stableOnSuccess = useCallback(() => onRenderSuccess(), [onRenderSuccess])
  const stableOnError = useCallback((err: string) => onRenderError(err), [onRenderError])

  const { sendCode, isReady } = useSandbox({
    iframeRef,
    onSuccess: stableOnSuccess,
    onError: stableOnError,
  })

  // Send code to sandbox when status is "rendering" and sandbox is ready
  useEffect(() => {
    if (artifact.status === "rendering" && artifact.code && isReady) {
      renderIdRef.current += 1
      const id = `render-${renderIdRef.current}`
      sendCode(artifact.code, id)
    }
  }, [artifact.status, artifact.code, isReady, sendCode])

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C") {
        e.preventDefault()
        handleCopy()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, artifact.code])

  function handleCopy() {
    if (!artifact.code) return
    navigator.clipboard.writeText(artifact.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleRetry() {
    if (artifact.error && artifact.code) {
      const msg = `The dashboard failed to render with this error:\n\n${artifact.error}\n\nPlease fix the JSX code and call render_dashboard again.`
      onRetry(msg)
    }
  }

  const isLoading = artifact.status === "loading"
  const isError = artifact.status === "error"
  const showIframe = artifact.status === "rendering" || artifact.status === "active"

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="truncate text-sm font-medium">
            {artifact.title || "Dashboard"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Code / Preview toggle */}
          {artifact.code && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setShowCode((v) => !v)}
              title={showCode ? "Show preview" : "Show code"}
            >
              {showCode ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            </Button>
          )}

          {/* Copy */}
          {artifact.code && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleCopy}
              title="Copy JSX"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          )}

          {/* Close */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        {/* Loading skeleton */}
        {isLoading && <ArtifactSkeleton />}

        {/* Error state */}
        {isError && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {artifact.error}
            </p>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Try Fixing
            </Button>
          </div>
        )}

        {/* Code view */}
        {showCode && artifact.code && (
          <div className="h-full overflow-auto bg-muted/30 p-4">
            <pre className="text-xs leading-relaxed">
              <code>{artifact.code}</code>
            </pre>
          </div>
        )}

        {/* Iframe — always mounted when we have code, visibility toggled */}
        {artifact.code && (
          <iframe
            ref={iframeRef}
            src="/sandbox.html"
            sandbox="allow-scripts allow-same-origin"
            className={cn(
              "h-full w-full border-none",
              showCode || isLoading || isError ? "invisible absolute inset-0" : "visible"
            )}
            title="Dashboard Preview"
          />
        )}
      </div>

      {/* Version dots */}
      {artifact.history.length > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t py-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={artifact.activeVersion <= 0}
            onClick={() => onSetVersion(artifact.activeVersion - 1)}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <div className="flex items-center gap-1.5">
            {artifact.history.map((_, i) => (
              <button
                key={i}
                onClick={() => onSetVersion(i)}
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  i === artifact.activeVersion
                    ? "bg-primary"
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
                title={`Version ${i + 1}`}
              />
            ))}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={artifact.activeVersion >= artifact.history.length - 1}
            onClick={() => onSetVersion(artifact.activeVersion + 1)}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}
