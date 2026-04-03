"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X, ExternalLink, RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/ui/markdown"

interface ArtifactPanelProps {
  url: string
  title: string
  onClose: () => void
}

export function ArtifactPanel({ url, title, onClose }: ArtifactPanelProps) {
  const [key, setKey] = useState(0)
  const [ready, setReady] = useState(false)
  const [mdContent, setMdContent] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isMarkdown = /\.md$/i.test(title)

  const checkReady = useCallback(async () => {
    try {
      const res = await fetch(url, { method: "HEAD" })
      if (res.ok) {
        setReady(true)
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
        // Fetch markdown content if .md
        if (/\.md$/i.test(title)) {
          const full = await fetch(url)
          setMdContent(await full.text())
        }
      }
    } catch {
      // not ready yet
    }
  }, [url, title])

  useEffect(() => {
    setReady(false)
    setMdContent(null)
    setKey(0)
    checkReady()
    pollRef.current = setInterval(checkReady, 2000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [url, checkReady])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium truncate flex-1">{title}</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setKey((k) => k + 1)
              if (isMarkdown) {
                fetch(url).then((r) => r.text()).then(setMdContent).catch(() => {})
              }
            }}
            title="Yenile"
            disabled={!ready}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => window.open(url, "_blank")}
            title="Yeni sekmede ac"
            disabled={!ready}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            title="Kapat"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {!ready ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Artifact olusturuluyor...</p>
        </div>
      ) : isMarkdown && mdContent !== null ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="prose prose-base dark:prose-invert max-w-none">
            <Markdown>{mdContent}</Markdown>
          </div>
        </div>
      ) : (
        <iframe
          key={key}
          src={url}
          className="flex-1 w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-popups"
          title={title}
        />
      )}
    </div>
  )
}
