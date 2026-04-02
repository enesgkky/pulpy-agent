"use client"

import { useState, useRef } from "react"
import { ArrowUp, Square, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input"

interface ChatInputProps {
  onSubmit: (message: string) => void
  onStop?: () => void
  onUpload?: (file: File) => void
  isLoading: boolean
}

export function ChatInput({ onSubmit, onStop, onUpload, isLoading }: ChatInputProps) {
  const [value, setValue] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isLoading) return
    onSubmit(trimmed)
    setValue("")
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && onUpload) {
      onUpload(file)
    }
    // Reset file input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <PromptInput
        value={value}
        onValueChange={setValue}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className="w-full max-w-2xl"
      >
        <PromptInputTextarea placeholder="Mesajinizi yazin..." />
        <PromptInputActions className="justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileChange}
            />
            <PromptInputAction tooltip="Excel Yukle">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={handleUploadClick}
                disabled={isLoading}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </PromptInputAction>
          </div>

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
                disabled={!value.trim()}
                onClick={handleSubmit}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </PromptInputAction>
          )}
        </PromptInputActions>
      </PromptInput>
    </div>
  )
}
