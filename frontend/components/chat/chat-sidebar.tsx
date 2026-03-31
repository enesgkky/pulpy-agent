"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { MessageSquarePlus, Trash2 } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  fetchConversations,
  deleteConversation,
  type ApiConversation,
} from "@/lib/api"

export function ChatSidebar() {
  const router = useRouter()
  const params = useParams()
  const activeId = params?.id as string | undefined

  const [conversations, setConversations] = useState<ApiConversation[]>([])

  const load = () => {
    fetchConversations()
      .then(setConversations)
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleNew = () => {
    router.push("/")
  }

  const handleSelect = (id: string) => {
    router.push(`/c/${id}`)
  }

  const handleDelete = async (id: string) => {
    await deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      router.push("/")
    }
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleNew}
        >
          <MessageSquarePlus className="h-4 w-4" />
          Yeni Sohbet
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Sohbetler</SidebarGroupLabel>
          <SidebarMenu>
            {conversations.map((conv) => (
              <SidebarMenuItem key={conv.id}>
                <SidebarMenuButton
                  isActive={activeId === conv.id}
                  onClick={() => handleSelect(conv.id)}
                  tooltip={conv.title}
                >
                  <span className="truncate">{conv.title}</span>
                </SidebarMenuButton>
                <SidebarMenuAction
                  onClick={() => handleDelete(conv.id)}
                  showOnHover
                >
                  <Trash2 className="h-4 w-4" />
                </SidebarMenuAction>
              </SidebarMenuItem>
            ))}

            {conversations.length === 0 && (
              <p className="px-4 py-2 text-sm text-muted-foreground">
                Henuz sohbet yok
              </p>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
