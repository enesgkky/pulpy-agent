"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Settings,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
} from "lucide-react"
import { testMcpConnection, type McpTestResult } from "@/lib/api"

const STORAGE_KEY = "pulpy-settings"

export interface McpServer {
  name: string
  url: string
}

export interface PulpySettings {
  activeService: string
  apiKeys: {
    openai: string
    anthropic: string
    google: string
  }
  viziowise: {
    baseUrl: string
    model: string
    apiKey: string
  }
  mcpServers: McpServer[]
}

const DEFAULT_SETTINGS: PulpySettings = {
  activeService: "openai",
  apiKeys: {
    openai: "",
    anthropic: "",
    google: "",
  },
  viziowise: {
    baseUrl: "",
    model: "",
    apiKey: "",
  },
  mcpServers: [],
}

export function loadSettings(): PulpySettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: PulpySettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function SettingsDialog() {
  const [settings, setSettings] = useState<PulpySettings>(DEFAULT_SETTINGS)
  const [open, setOpen] = useState(false)

  // MCP form state
  const [mcpName, setMcpName] = useState("")
  const [mcpUrl, setMcpUrl] = useState("")
  const [mcpTesting, setMcpTesting] = useState<string | null>(null)
  const [mcpTestResults, setMcpTestResults] = useState<
    Record<string, McpTestResult>
  >({})

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const update = (patch: Partial<PulpySettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  const updateApiKey = (provider: keyof PulpySettings["apiKeys"], value: string) => {
    const next = {
      ...settings,
      apiKeys: { ...settings.apiKeys, [provider]: value },
    }
    setSettings(next)
    saveSettings(next)
  }

  const updateViziowise = (field: keyof PulpySettings["viziowise"], value: string) => {
    const next = {
      ...settings,
      viziowise: { ...settings.viziowise, [field]: value },
    }
    setSettings(next)
    saveSettings(next)
  }

  const addMcpServer = () => {
    const trimmedName = mcpName.trim()
    const trimmedUrl = mcpUrl.trim()
    if (!trimmedName || !trimmedUrl) return
    const servers = [...(settings.mcpServers || []), { name: trimmedName, url: trimmedUrl }]
    update({ mcpServers: servers })
    setMcpName("")
    setMcpUrl("")
  }

  const removeMcpServer = (index: number) => {
    const servers = [...(settings.mcpServers || [])]
    const removed = servers.splice(index, 1)[0]
    update({ mcpServers: servers })
    // Clean up test result
    if (removed) {
      setMcpTestResults((prev) => {
        const next = { ...prev }
        delete next[removed.url]
        return next
      })
    }
  }

  const handleTestMcp = async (server: McpServer) => {
    setMcpTesting(server.url)
    setMcpTestResults((prev) => {
      const next = { ...prev }
      delete next[server.url]
      return next
    })
    try {
      const result = await testMcpConnection(server.url)
      setMcpTestResults((prev) => ({ ...prev, [server.url]: result }))
    } catch {
      setMcpTestResults((prev) => ({
        ...prev,
        [server.url]: { success: false, error: "Bağlantı isteği başarısız" },
      }))
    } finally {
      setMcpTesting(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ayarlar</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="model">
          <TabsList className="w-full">
            <TabsTrigger value="model" className="flex-1">Model</TabsTrigger>
            <TabsTrigger value="mcp" className="flex-1">
              MCP Sunucular
              {(settings.mcpServers?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                  {settings.mcpServers.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Model Tab ─────────────────────────── */}
          <TabsContent value="model" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Model Servisi</Label>
              <Select
                value={settings.activeService}
                onValueChange={(v) => update({ activeService: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="viziowise">Viziowise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {settings.activeService === "openai" && (
              <div className="space-y-2">
                <Label>OpenAI API Key</Label>
                <Input
                  type="password"
                  value={settings.apiKeys.openai}
                  onChange={(e) => updateApiKey("openai", e.target.value)}
                  placeholder="sk-..."
                />
              </div>
            )}

            {settings.activeService === "anthropic" && (
              <div className="space-y-2">
                <Label>Anthropic API Key</Label>
                <Input
                  type="password"
                  value={settings.apiKeys.anthropic}
                  onChange={(e) => updateApiKey("anthropic", e.target.value)}
                  placeholder="sk-ant-..."
                />
              </div>
            )}

            {settings.activeService === "google" && (
              <div className="space-y-2">
                <Label>Google API Key</Label>
                <Input
                  type="password"
                  value={settings.apiKeys.google}
                  onChange={(e) => updateApiKey("google", e.target.value)}
                  placeholder="AIza..."
                />
              </div>
            )}

            {settings.activeService === "viziowise" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input
                    value={settings.viziowise.baseUrl}
                    onChange={(e) => updateViziowise("baseUrl", e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input
                    value={settings.viziowise.model}
                    onChange={(e) => updateViziowise("model", e.target.value)}
                    placeholder="Qwen/Qwen3.5-35B-A3B"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={settings.viziowise.apiKey}
                    onChange={(e) => updateViziowise("apiKey", e.target.value)}
                    placeholder="opsiyonel"
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── MCP Tab ───────────────────────────── */}
          <TabsContent value="mcp" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              HTTP/SSE tipinde MCP sunucularını ekleyerek agent&apos;a harici tool&apos;lar kazandırabilirsiniz.
            </p>

            {/* Add new server form */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="space-y-2">
                <Label>Sunucu Adı</Label>
                <Input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="ornek: weather-server"
                />
              </div>
              <div className="space-y-2">
                <Label>URL (SSE)</Label>
                <Input
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  placeholder="http://localhost:3001/sse"
                />
              </div>
              <Button
                size="sm"
                onClick={addMcpServer}
                disabled={!mcpName.trim() || !mcpUrl.trim()}
                className="w-full"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Sunucu Ekle
              </Button>
            </div>

            {/* Server list */}
            {(settings.mcpServers?.length ?? 0) > 0 && <Separator />}

            {(settings.mcpServers || []).map((server, idx) => {
              const result = mcpTestResults[server.url]
              const isTesting = mcpTesting === server.url

              return (
                <div key={`${server.url}-${idx}`} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{server.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{server.url}</p>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestMcp(server)}
                        disabled={isTesting}
                      >
                        {isTesting ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wrench className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeMcpServer(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Test result */}
                  {result && (
                    <div className="space-y-2">
                      {result.success ? (
                        <>
                          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>
                              Bağlantı başarılı
                              {result.serverInfo &&
                                ` — ${result.serverInfo.name} v${result.serverInfo.version}`}
                            </span>
                          </div>
                          {result.tools && result.tools.length > 0 && (
                            <div className="rounded-md bg-muted/50 p-2">
                              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Tool&apos;lar ({result.tools.length})
                              </p>
                              <div className="space-y-1">
                                {result.tools.map((tool) => (
                                  <div key={tool.name} className="text-xs">
                                    <span className="font-mono font-medium">{tool.name}</span>
                                    {tool.description && (
                                      <span className="ml-1.5 text-muted-foreground">
                                        — {tool.description}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {result.tools && result.tools.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              Sunucuda tool bulunamadı.
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>{result.error || "Bağlantı başarısız"}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {(settings.mcpServers?.length ?? 0) === 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Henüz MCP sunucusu eklenmedi.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
