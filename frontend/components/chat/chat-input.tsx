"use client"

import { useState, useRef } from "react"
import { ArrowUp, Square, Paperclip, X, FileSpreadsheet, FileText, FileCode, File } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input"
import { uploadFiles, type UploadedFile } from "@/lib/api"

const ACCEPTED_TYPES = [
  ".xlsx", ".xls", ".xlsm", ".csv", ".tsv",
  ".pdf",
  ".sql",
  ".json", ".xml", ".txt",
].join(",")

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (["xlsx", "xls", "xlsm", "csv", "tsv"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />
  if (ext === "pdf")
    return <FileText className="h-4 w-4 shrink-0 text-red-600" />
  if (["sql", "json", "xml"].includes(ext))
    return <FileCode className="h-4 w-4 shrink-0 text-blue-600" />
  return <File className="h-4 w-4 shrink-0 text-muted-foreground" />
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ChatInputProps {
  onSubmit: (message: string, files?: UploadedFile[]) => void
  onStop?: () => void
  onUpload?: (file: File) => void
  isLoading: boolean
}

export function ChatInput({ onSubmit, onStop, onUpload, isLoading }: ChatInputProps) {
  const [value, setValue] = useState("")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    const trimmed = value.trim()
    if ((!trimmed && pendingFiles.length === 0) || isLoading || isUploading) return

    let uploaded: UploadedFile[] | undefined
    if (pendingFiles.length > 0) {
      setIsUploading(true)
      try {
        uploaded = await uploadFiles(pendingFiles)
      } catch {
        setIsUploading(false)
        return
      }
      setIsUploading(false)
    }

    const messageText = trimmed || pendingFiles.map((f) => f.name).join(", ") + " dosyası yüklendi."
    onSubmit(messageText, uploaded)
    setValue("")
    setPendingFiles([])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files])
    }
    e.target.value = ""
  }

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="w-full max-w-2xl">
      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingFiles.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm"
            >
              {getFileIcon(file.name)}
              <span className="max-w-[150px] truncate">{file.name}</span>
              <span className="text-muted-foreground text-xs">
                {formatSize(file.size)}
              </span>
              <button
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-foreground -mr-1 ml-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <PromptInput
        value={value}
        onValueChange={setValue}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className="w-full"
      >
        <PromptInputTextarea placeholder="Mesajinizi yazin..." />
        <PromptInputActions className="justify-between px-2 pb-2">
          <div className="flex items-center">
            <PromptInputAction tooltip="Dosya ekle">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isUploading}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </PromptInputAction>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <div className="flex items-center">
            {isLoading ? (
              <PromptInputAction tooltip="Durdur">
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={onStop}
                >
                  <Square className="h-4 w-4" />
                </Button>
              </PromptInputAction>
            ) : (
              <PromptInputAction tooltip="Gonder">
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  disabled={(!value.trim() && pendingFiles.length === 0) || isUploading}
                  onClick={handleSubmit}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </PromptInputAction>
            )}
          </div>
        </PromptInputActions>
      </PromptInput>

      {isUploading && (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Dosyalar yukleniyor...
        </p>
      )}
    </div>
  )
}
