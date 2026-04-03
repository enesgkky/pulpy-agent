# Artifact Dashboard Rendering — Implementation Plan

## Goal

Add a Claude-style artifact rendering system to Pulpy. When the agent generates a React dashboard (via the `render_dashboard` tool), it renders live in a sandboxed iframe panel on the right side of the chat UI.

---

## Architecture Overview

```
User asks data question
  → Agent queries SQL, gets data
  → Agent calls render_dashboard(jsx_code, title, description)
  → Backend streams the tool call as part of normal SSE stream
  → Frontend detects render_dashboard in thread.messages (via useStream)
  → Artifact panel opens (split pane)
  → JSX sent to sandbox iframe via postMessage
  → Sandbox transpiles + renders React component
  → Dashboard appears live
```

**Key decision**: We do NOT change the streaming logic. The existing `useStream()` + `FetchStreamTransport` already exposes tool calls as structured `Message` objects with `tool_calls` arrays. We simply detect `render_dashboard` in those messages and react accordingly.

---

## Phase 1: Backend — `render_dashboard` Tool + System Prompt

### 1A: Create the `render_dashboard` tool

**File to create**: `backend/src/agent/tools/render-dashboard.tool.ts`

This is a LangChain `DynamicStructuredTool` (same pattern used in `mcp-tools.adapter.ts`). It's a "signal" tool — it doesn't execute rendering, it just returns a confirmation string. The frontend intercepts the tool call from the stream.

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export const renderDashboardTool = new DynamicStructuredTool({
  name: 'render_dashboard',
  description: `Render an interactive dashboard in the preview panel.

WHEN TO USE: Call this whenever the user wants to SEE data visually — charts,
tables, metrics, dashboards, reports. If you fetched data with SQL and the user
wants to visualize it, call this tool.

REQUIREMENTS FOR jsx_code:
- Must be a complete, self-contained React component
- Must have a default export: export default function DashboardName() { ... }
- ALL data must be embedded directly in the component as a const
- Use ONLY these libraries: React (hooks), Recharts, Lucide React, Tailwind CSS
- No TypeScript — plain JSX only
- No external API calls, no fetch, no localStorage
- Must include a Google Font import via <style> tag

The component renders in a sandboxed iframe with React 18, Recharts,
Lucide React, and Tailwind CSS pre-loaded.`,
  schema: z.object({
    jsx_code: z.string().describe('Complete React JSX component as a string. Must be valid JSX with a default export.'),
    title: z.string().optional().default('Dashboard').describe('Dashboard title shown in the preview panel header.'),
    description: z.string().optional().default('').describe('Brief description of what the dashboard shows.'),
  }),
  func: async ({ jsx_code, title, description }) => {
    // Signal tool — frontend handles the actual rendering
    return `Dashboard '${title}' has been rendered in the preview panel. The user can now see: ${description}`;
  },
});
```

**Zod schema**: Uses `zod` (already in `package.json` as `^4.3.6`). Need to verify zod v4 API compatibility — v4 changed some things. If issues, may need `z.object()` adjustments.

### 1B: Register the tool with the agent

**File to edit**: `backend/src/agent/agent.service.ts`

In the `createAgent` method (around line 75-106), add `render_dashboard` to the `agentOptions.tools` array alongside any existing MCP tools.

Current code:
```typescript
if (options.mcpTools?.length) {
  agentOptions.tools = options.mcpTools;
}
```

Change to:
```typescript
import { renderDashboardTool } from './tools/render-dashboard.tool';

// Always include render_dashboard, plus any MCP tools
const tools: StructuredTool[] = [renderDashboardTool];
if (options.mcpTools?.length) {
  tools.push(...options.mcpTools);
}
agentOptions.tools = tools;
```

### 1C: Update the system prompt

**File to edit**: `backend/src/agent/agent.service.ts` (lines 79-89)

Append dashboard rendering instructions to the existing system prompt. The skill file (`skills/dashboard-builder/skill.md`) is already copied to the workspace and loaded by `agentOptions.skills = ['/skills/']`, so the agent can read it. But we need explicit instructions about the rendering pipeline in the system prompt.

Add after existing guidelines:
```
## How Dashboard Rendering Works

When the user asks you to visualize, chart, or display data:

1. First, use your available tools to fetch/analyze the data
2. Examine the data shape: columns, types, row count
3. Decide the best visualization (chart type, layout)
4. Read the dashboard-builder skill file for design guidelines
5. Generate a COMPLETE React JSX component with the data embedded
6. Call the render_dashboard tool with the JSX code

IMPORTANT RULES:
- ALWAYS fetch the data FIRST, then generate the dashboard
- NEVER call render_dashboard with placeholder/dummy data
- Embed ALL fetched data directly in the JSX as a const array
- If the dataset has more than 200 rows, aggregate it first
- After calling render_dashboard, briefly tell the user what the dashboard shows
- Don't explain the JSX code to the user
- Don't paste raw JSX in the chat — always use the render_dashboard tool
- Don't generate TypeScript — plain JSX only
```

### 1D: Handle `previous_artifact` from frontend

**File to edit**: `backend/src/conversation/conversation.controller.ts`

**File to edit**: `backend/src/conversation/dto/send-message.dto.ts`

Add `previousArtifact?: string` field to `SendMessageDto`. When the frontend sends the previous dashboard code, inject it as context before sending to the agent, so the agent can edit existing dashboards instead of rewriting from scratch.

In `send-message.dto.ts`:
```typescript
export class SendMessageDto {
  content: string;
  conversationId?: string;
  service?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  mcpServers?: McpServerDto[];
  previousArtifact?: string;  // <-- add this
}
```

In `conversation.controller.ts` `streamMessage` method, before calling `getEncodedStream`:
If `dto.previousArtifact` exists, append a system-context message to history telling the agent about the existing dashboard code.

---

## Phase 2: Frontend — Artifact State Management

### 2A: Create the artifact hook

**File to create**: `frontend/hooks/use-artifact.ts`

This hook manages the artifact state machine. It does NOT parse streams — it receives messages from `useStream()` and reacts.

**State machine**:
```
CLOSED → LOADING → RENDERING → ACTIVE
                             → ERROR
```

**Interface**:
```typescript
interface ArtifactState {
  status: 'closed' | 'loading' | 'rendering' | 'active' | 'error';
  code: string | null;
  title: string;
  description: string;
  error: string | null;
  history: Array<{ code: string; title: string; timestamp: number }>;
  activeVersion: number;
}
```

**Hook signature**:
```typescript
function useArtifact(messages: Message[], isLoading: boolean): {
  artifact: ArtifactState;
  closePanel: () => void;
  setVersion: (index: number) => void;
  onRenderSuccess: () => void;
  onRenderError: (error: string) => void;
  retryMessage: string | null; // auto-message to send to agent on retry
}
```

**Logic**:
- Scan `messages` for AI messages with `tool_calls` where `name === 'render_dashboard'`
- When a NEW `render_dashboard` tool call appears (track by tool call ID):
  - If `isLoading` is true and the tool call args are incomplete → status = `loading`
  - If tool call args have `jsx_code` → status = `rendering`, push to history
- `onRenderSuccess` → status = `active`
- `onRenderError(error)` → status = `error`, store error message
- `closePanel()` → status = `closed`
- `setVersion(index)` → render that version from history

**How to detect a render_dashboard tool call**:
Use the same pattern as `chat-messages.tsx:getToolCalls()`:
```typescript
const toolCalls = (msg as any).tool_calls ?? [];
const dashboardCall = toolCalls.find(tc => tc.name === 'render_dashboard');
if (dashboardCall?.args?.jsx_code) {
  // We have complete JSX — transition to rendering
}
```

**Edge cases to handle**:
- Agent sends multiple `render_dashboard` calls → each goes to history, show latest
- Agent sends text before/after dashboard → no interference, text renders in chat normally
- User closes panel, agent sends new dashboard → re-open
- `render_dashboard` tool call appears but args not yet populated (streaming) → show loading
- Detect incomplete tool calls via `tool_call_chunks` on the message (same pattern as TodoList detection in `chat-messages.tsx:101-108`)

### 2B: Create the sandbox communication hook

**File to create**: `frontend/hooks/use-sandbox.ts`

Manages postMessage communication with the sandbox iframe.

**Hook signature**:
```typescript
function useSandbox(
  iframeRef: RefObject<HTMLIFrameElement>,
  onSuccess: () => void,
  onError: (error: string) => void
): {
  sendCode: (code: string, id: string) => void;
  isReady: boolean;
}
```

**Logic**:
- Listen for `message` events from iframe
- Handle `SANDBOX_READY` → set isReady = true
- Handle `RENDER_SUCCESS` → call onSuccess
- Handle `RENDER_ERROR` → call onError(error)
- `sendCode` → postMessage `{ type: 'RENDER_ARTIFACT', code, id }` to iframe
- Clean up event listener on unmount
- Add 5-second timeout: if no RENDER_SUCCESS after sending code, treat as error

---

## Phase 3: Sandbox Iframe

### 3A: Create the sandbox HTML page

**File to create**: `frontend/public/sandbox.html`

A standalone HTML page loaded in the iframe. Contains:
- React 18 (UMD from CDN)
- ReactDOM 18 (UMD from CDN)
- Recharts (UMD from CDN)
- Lucide React (UMD from CDN)
- Sucrase (for JSX transpilation, UMD from CDN)
- Tailwind CSS (CDN script)

**Rendering pipeline** (all happens inside the iframe):
1. Receive `RENDER_ARTIFACT` postMessage with JSX code string
2. Parse import statements → rewrite to use global scope objects
3. Remove `export default` → capture component reference
4. Transpile JSX → JS using Sucrase
5. Evaluate transpiled code with `new Function()`
6. Render component with `ReactDOM.createRoot().render()`
7. Send `RENDER_SUCCESS` or `RENDER_ERROR` back to parent via postMessage

**Security**:
- Iframe uses `sandbox="allow-scripts"` attribute
- No `allow-same-origin` — iframe is fully isolated
- No access to parent DOM, cookies, storage, navigation
- Google Fonts need network access — `allow-scripts` permits `<style>@import</style>` fetches

**Import rewriting logic**:
```javascript
// import { useState, useMemo } from "react"
//   → const { useState, useMemo } = { ...React }
//     (actually: const useState = React.useState; etc.)

// import { BarChart, Bar } from "recharts"  
//   → const BarChart = Recharts.BarChart; const Bar = Recharts.Bar;

// import { TrendingUp } from "lucide-react"
//   → const TrendingUp = LucideReact.TrendingUp;
```

### 3B: Test the sandbox standalone

Before integrating, test by:
1. Open `http://localhost:3000/sandbox.html` directly in browser
2. Open browser console
3. Run: `window.postMessage({ type: 'RENDER_ARTIFACT', code: '<test JSX>', id: 'test-1' }, '*')`
4. Verify the component renders

---

## Phase 4: Frontend — Split Pane UI + Artifact Panel

### 4A: Modify ChatLayout to use split pane

**File to edit**: `frontend/components/chat/chat-layout.tsx`

Currently the `SidebarInset` contains header + chat area + input. We need to wrap the chat content area in a `ResizablePanelGroup` with two panels:
- Left panel: chat (messages + input)
- Right panel: artifact panel (only visible when artifact.status !== 'closed')

Use existing `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from `frontend/components/ui/resizable.tsx`.

**Layout change**:
```
Before:
  SidebarInset
    ├── header
    ├── ChatContainerRoot (messages)
    └── input area

After:
  SidebarInset
    ├── header
    └── ResizablePanelGroup (direction="horizontal")
        ├── ResizablePanel (chat — default 100%, min 35%)
        │   ├── ChatContainerRoot (messages)
        │   └── input area
        ├── ResizableHandle (only when artifact open)
        └── ResizablePanel (artifact — default 55%, min 30%, only when open)
            └── ArtifactPanel
```

**Behavior**:
- When artifact status is `closed`: chat panel takes 100%, artifact panel is hidden (collapsed or not rendered)
- When artifact opens: animate chat to ~45%, artifact to ~55%
- `ResizableHandle` with `withHandle` prop for drag indicator
- Panel sizes controlled programmatically via `ImperativeHandle` from react-resizable-panels

**Integration with useArtifact**:
```typescript
const { artifact, closePanel, setVersion, onRenderSuccess, onRenderError } = useArtifact(displayMessages, thread.isLoading);
```

Pass `artifact` and handlers down to `ArtifactPanel`.

### 4B: Create ArtifactPanel component

**File to create**: `frontend/components/chat/artifact-panel.tsx`

The right-side panel that shows the dashboard.

**Sub-sections**:
1. **Toolbar** (top bar):
   - Dashboard title (from `artifact.title`)
   - "Code" toggle button — switches between rendered preview and raw JSX view
   - "Copy" button — copies JSX to clipboard
   - "Close" button (X) — calls `closePanel()`
   - Version dots (if `artifact.history.length > 1`) — clickable to switch versions

2. **Content area** (based on artifact.status):
   - `loading` → `<ArtifactSkeleton />`
   - `rendering` → iframe + may still show skeleton overlay until RENDER_SUCCESS
   - `active` → iframe visible, skeleton hidden
   - `error` → error message + "Try Fixing" button

3. **Iframe** (the sandbox):
   - `<iframe src="/sandbox.html" sandbox="allow-scripts" />`
   - Managed by `useSandbox` hook
   - When `artifact.status` transitions to `rendering`, call `sendCode(artifact.code, id)`

**Props**:
```typescript
interface ArtifactPanelProps {
  artifact: ArtifactState;
  onClose: () => void;
  onRenderSuccess: () => void;
  onRenderError: (error: string) => void;
  onSetVersion: (index: number) => void;
  onRetry: (message: string) => void; // sends auto-fix message to chat
}
```

### 4C: Create ArtifactSkeleton component

**File to create**: `frontend/components/chat/artifact-skeleton.tsx`

Loading skeleton that mimics a typical dashboard layout:
- 4 small rounded rectangles (KPI cards) in a row → `animate-pulse`
- 1 large rectangle (chart area) → `animate-pulse`
- 3 narrow rectangles (table rows) → `animate-pulse`

Use shadcn's existing `Skeleton` component from `frontend/components/ui/skeleton.tsx` (if it exists) or Tailwind's `animate-pulse` + `bg-muted` classes.

### 4D: Create CodeViewer component

**File to create**: `frontend/components/chat/code-viewer.tsx`

Raw JSX display when user toggles "Code" view. Simple `<pre>` with syntax highlighting.

Options:
- Use Shiki (already installed in frontend) for JSX syntax highlighting
- Or a simple `<pre><code>` with Tailwind styling (faster, simpler)

Go with simple `<pre>` + monospace styling first. Can add Shiki later if needed.

### 4E: Hide render_dashboard from chat tool calls

**File to edit**: `frontend/components/chat/chat-messages.tsx`

Currently `buildRenderItems` (line 396) shows all tool calls as collapsible items. We should **hide** `render_dashboard` tool calls from the chat — they're already represented by the artifact panel.

In the filter at line 408:
```typescript
// Current:
const toolCalls = getToolCalls(msg).filter((c) => c.name !== "write_todos")

// Change to:
const toolCalls = getToolCalls(msg).filter(
  (c) => c.name !== "write_todos" && c.name !== "render_dashboard"
)
```

---

## Phase 5: Wire Everything Together

### 5A: Connect artifact detection to panel

In `chat-layout.tsx`:
1. Import and call `useArtifact(displayMessages, thread.isLoading)`
2. Conditionally render the artifact panel based on `artifact.status !== 'closed'`
3. Pass `artifact` state + handlers to `ArtifactPanel`

### 5B: Connect sandbox to artifact state

In `ArtifactPanel`:
1. Create iframe ref
2. Call `useSandbox(iframeRef, onRenderSuccess, onRenderError)`
3. When `artifact.code` changes and status is `rendering`, call `sendCode(artifact.code, id)`
4. Use `useEffect` to trigger this

### 5C: Handle dashboard editing flow

In `chat-layout.tsx`:
1. When sending a message, include `artifact.code` as `previousArtifact` in the request
2. Modify the `FetchStreamTransport.onRequest` to add `previousArtifact` to the request body

### 5D: Handle retry on error

In `ArtifactPanel`:
1. "Try Fixing" button calls `onRetry(message)`
2. The message is auto-generated: "The dashboard failed to render with this error: {error}. Please fix the JSX code and call render_dashboard again."
3. `onRetry` in `chat-layout.tsx` calls `thread.submit()` with this message

### 5E: Keyboard shortcuts

In `ArtifactPanel` or `chat-layout.tsx`:
- `Escape` → close artifact panel
- `Cmd/Ctrl + Shift + C` → copy JSX code (if panel is open)

---

## Phase 6: Polish

### 6A: Panel transition animations
- Chat panel width transition: CSS `transition: flex-basis 300ms ease-out` or use react-resizable-panels' built-in animation
- Artifact panel content fade-in after width animation

### 6B: Version history UI
- Show dots at bottom of artifact panel when `history.length > 1`
- Active dot is highlighted
- Clicking a dot calls `setVersion(index)` → re-sends that version's code to sandbox

### 6C: Responsive design
- On mobile (< 768px): stack vertically or use tab switch between chat and artifact
- Or: artifact panel takes full width, chat is hidden behind a "Back to chat" button

### 6D: Edge cases
- Page refresh: artifacts are ephemeral, lost on refresh (acceptable for now)
- Multiple conversations: each conversation has its own artifact state (already handled since `useArtifact` takes `messages` as input)
- Agent sends text before and after dashboard: handled by existing message rendering
- Agent calls render_dashboard twice: both in history, latest shown

---

## Files to Create (6 files)

| # | File | Purpose |
|---|------|---------|
| 1 | `backend/src/agent/tools/render-dashboard.tool.ts` | The render_dashboard LangChain tool |
| 2 | `frontend/public/sandbox.html` | Standalone sandbox page for iframe |
| 3 | `frontend/hooks/use-artifact.ts` | Artifact state machine hook |
| 4 | `frontend/hooks/use-sandbox.ts` | postMessage communication with iframe |
| 5 | `frontend/components/chat/artifact-panel.tsx` | Right-side panel (toolbar + iframe + skeleton + error) |
| 6 | `frontend/components/chat/artifact-skeleton.tsx` | Loading skeleton |

## Files to Edit (5 files)

| # | File | Changes |
|---|------|---------|
| 1 | `backend/src/agent/agent.service.ts` | Import tool, add to agentOptions.tools, update system prompt |
| 2 | `backend/src/conversation/dto/send-message.dto.ts` | Add `previousArtifact` field |
| 3 | `backend/src/conversation/conversation.controller.ts` | Inject previousArtifact context into history |
| 4 | `frontend/components/chat/chat-layout.tsx` | Add split pane layout, useArtifact, pass artifact to panel |
| 5 | `frontend/components/chat/chat-messages.tsx` | Filter out render_dashboard from tool call display |

---

## Execution Order

```
Phase 1 — Backend (tool + system prompt + dto)
  1A: Create render-dashboard.tool.ts
  1B: Edit agent.service.ts — register tool + update system prompt
  1C: Edit send-message.dto.ts — add previousArtifact
  1D: Edit conversation.controller.ts — inject previousArtifact into history

Phase 2 — Frontend hooks
  2A: Create use-artifact.ts
  2B: Create use-sandbox.ts

Phase 3 — Sandbox
  3A: Create sandbox.html
  3B: Test sandbox standalone in browser

Phase 4 — Frontend UI
  4A: Create artifact-skeleton.tsx
  4B: Create artifact-panel.tsx
  4C: Edit chat-layout.tsx — split pane + useArtifact integration
  4D: Edit chat-messages.tsx — hide render_dashboard tool calls

Phase 5 — Wire together
  5A: Connect artifact detection → panel rendering
  5B: Connect sandbox ↔ artifact state
  5C: Add previousArtifact to stream request
  5D: Add retry-on-error flow
  5E: Keyboard shortcuts

Phase 6 — Polish
  6A: Panel animations
  6B: Version dots UI
  6C: Responsive design
  6D: Edge case testing
```

---

## Testing Checkpoints

- **After Phase 1**: Start the backend, send a message asking for a dashboard. Check server logs to confirm the agent calls `render_dashboard` and the tool call appears in the SSE stream.
- **After Phase 3**: Open `/sandbox.html` in browser, paste test JSX via console `postMessage`, verify it renders.
- **After Phase 4**: Hardcode a fake artifact state in `chat-layout.tsx` to verify the panel opens/closes and the split pane works.
- **After Phase 5**: Full end-to-end test — ask the agent to visualize data, watch the panel open and dashboard render.
