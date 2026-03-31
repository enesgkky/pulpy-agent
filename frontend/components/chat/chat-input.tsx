"use client"

import { useState } from "react"
import { ArrowUp, Square } from "lucide-react"
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
  isLoading: boolean
}

export function ChatInput({ onSubmit, onStop, isLoading }: ChatInputProps) {
  const [value, setValue] = useState("")

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isLoading) return
    onSubmit(trimmed)
    setValue("")
  }

  return (
    <PromptInput
      value={value}
      onValueChange={setValue}
      isLoading={isLoading}
      onSubmit={handleSubmit}
      className="w-full max-w-2xl"
    >
      <PromptInputTextarea placeholder="Mesajinizi yazin..." />
      <PromptInputActions className="justify-end px-2 pb-2">
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
  )
}
