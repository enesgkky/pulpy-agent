# Claude Code Prompt: Add Artifact-Style Dashboard Rendering to My Deep Agent Project

## Context

I have an existing project that uses LangChain's Deep Agents SDK. My agent already has tools for writing SQL queries and fetching data from my database. What I need now is the **artifact rendering system** — the full pipeline where:

1. User asks a data question in chat
2. My Deep Agent queries SQL and gets results
3. The agent generates a React dashboard component
4. The dashboard renders LIVE in a sandboxed preview panel on the right side of the UI

This should work exactly like Claude.ai's Artifacts feature — split pane, sandboxed iframe, interactive React components rendered from LLM-generated JSX.

---

## Phase 0: Understand My Project First

**STOP. Before writing ANY code, explore my project thoroughly.**

Do all of these:
```bash
# Project structure
find . -maxdepth 3 -type f | head -80

# Dependencies
cat package.json 2>/dev/null
cat pyproject.toml 2>/dev/null
cat requirements.txt 2>/dev/null

# Frontend framework
ls src/ app/ frontend/ client/ 2>/dev/null
cat next.config.* vite.config.* nuxt.config.* 2>/dev/null

# Agent configuration
find . -name "*.py" | xargs grep -l "create_deep_agent\|create_agent\|ChatOpenAI\|ChatAnthropic" 2>/dev/null
find . -name "*.py" | xargs grep -l "@tool\|def.*tool" 2>/dev/null

# Existing API routes / streaming
find . -name "*.py" -o -name "*.ts" | xargs grep -l "StreamingResponse\|SSE\|WebSocket\|EventSource" 2>/dev/null

# Current system prompt
find . -name "*.py" -o -name "*.md" -o -name "*.txt" | xargs grep -l "system_prompt\|SYSTEM_PROMPT\|system_message" 2>/dev/null
```

After exploring, give me a summary:
- Frontend: what framework, what router, what styling
- Backend: what framework, what agent setup, what streaming method
- Agent: what model, what tools exist, where's the system prompt
- API: how does the frontend currently talk to the backend

**Get my confirmation before proceeding.**

---

## Phase 1: Agent-Side Changes (Backend)

### 1A: Create the `render_dashboard` Tool

Create a LangChain tool the agent calls when it wants to render a dashboard. This tool doesn't actually DO the rendering — it signals to the frontend that JSX is coming.

```python
from langchain_core.tools import tool

@tool
def render_dashboard(jsx_code: str, title: str = "Dashboard", description: str = "") -> str:
    """Render an interactive dashboard in the preview panel.

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
    Lucide React, and Tailwind CSS pre-loaded.

    Args:
        jsx_code: Complete React JSX component as a string. Must be valid JSX with a default export.
        title: Dashboard title shown in the preview panel header.
        description: Brief description of what the dashboard shows.

    Returns:
        Confirmation message. The frontend handles the actual rendering.
    """
    # This is a "signal" tool — it doesn't execute rendering.
    # The frontend intercepts this tool call in the stream and renders the JSX.
    return f"Dashboard '{title}' has been rendered in the preview panel. The user can now see: {description}"
```

### 1B: Load the Dashboard Skill into the Agent

The skill file (`dashboard-builder/SKILL.md`) teaches the agent HOW to write good dashboards. You need to load it into the agent's context. There are two approaches — pick whichever fits my project:

**Approach A — Inject into system prompt (simpler):**
```python
from pathlib import Path

skill_content = Path("skills/dashboard-builder/SKILL.md").read_text()

# Strip YAML frontmatter
skill_body = skill_content.split("---", 2)[-1].strip()

SYSTEM_PROMPT = f"""
{existing_system_prompt}

## Dashboard Generation Skill

When the user asks to visualize or display data, follow these instructions to generate
high-quality dashboards using the render_dashboard tool:

{skill_body}
"""
```

**Approach B — Use Deep Agents' filesystem (if using skills/memory):**
```python
# Place the skill file where the agent's filesystem middleware can read it
# Usually: agent_workspace/skills/dashboard-builder/SKILL.md
# The agent can then read it with the read_file tool when it needs to generate a dashboard
```

I recommend Approach A for now — it's direct and reliable. Move to B when the system prompt gets too long.

### 1C: Update the Agent's System Prompt

**This is critical.** The agent needs to know about the rendering pipeline. Add this to the system prompt (AFTER the skill content):

```
## How Dashboard Rendering Works

When the user asks you to visualize, chart, or display data:

1. First, use your SQL tools to fetch the data
2. Examine the data shape: columns, types, row count
3. Decide the best visualization (chart type, layout)
4. Generate a COMPLETE React JSX component with the data embedded
5. Call the render_dashboard tool with the JSX code

IMPORTANT RULES:
- ALWAYS fetch the data FIRST, then generate the dashboard
- NEVER call render_dashboard with placeholder/dummy data
- Embed ALL fetched data directly in the JSX as a const array
- If the dataset has more than 200 rows, aggregate it first (group by, top N, etc.)
- If the user asks to modify an existing dashboard, I will provide the previous JSX — edit it, don't rewrite from scratch
- After calling render_dashboard, briefly tell the user what the dashboard shows in 1-2 sentences. Don't explain the code.

NEVER DO:
- Don't explain the JSX code to the user
- Don't paste raw JSX in the chat — always use the render_dashboard tool
- Don't generate TypeScript (no type annotations, no interfaces)
- Don't use libraries that aren't available in the sandbox
```

### 1D: Streaming Configuration

Make sure the backend streams tool calls properly. The frontend needs to see tool calls AS THEY HAPPEN, not after the full response completes.

For LangGraph / Deep Agents:
```python
# The streaming endpoint must yield events for:
# 1. Regular text tokens (assistant message chunks)
# 2. Tool call START (tool name + start of arguments)
# 3. Tool call arguments streaming (partial JSX code)
# 4. Tool call END (complete)
# 5. Tool result

# Example SSE endpoint:
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json

app = FastAPI()

@app.post("/api/chat")
async def chat(request: ChatRequest):
    async def event_stream():
        async for event in agent.astream_events(
            {"messages": [{"role": "user", "content": request.message}]},
            version="v2"
        ):
            kind = event["event"]

            if kind == "on_chat_model_stream":
                # Regular text token
                chunk = event["data"]["chunk"]
                if chunk.content:
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk.content})}\n\n"

                # Tool call detection — this is where the magic happens
                if chunk.tool_call_chunks:
                    for tc in chunk.tool_call_chunks:
                        yield f"data: {json.dumps({'type': 'tool_call_chunk', 'id': tc.get('id', ''), 'name': tc.get('name', ''), 'args': tc.get('args', '')})}\n\n"

            elif kind == "on_tool_start":
                yield f"data: {json.dumps({'type': 'tool_start', 'name': event['name'], 'id': event.get('run_id', '')})}\n\n"

            elif kind == "on_tool_end":
                yield f"data: {json.dumps({'type': 'tool_end', 'name': event['name'], 'output': str(event['data'].get('output', ''))})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

**KEY DETAIL**: LangGraph's `astream_events` sends tool call arguments as CHUNKS — the `args` field comes piece by piece as the LLM generates it. For the `render_dashboard` tool, the `jsx_code` argument will stream over many chunks. The frontend needs to accumulate these chunks.

---

## Phase 2: Frontend — Stream Parsing & Artifact Detection

This is the most important part. The frontend must parse the SSE stream, detect when a dashboard is being generated, and manage the artifact panel state.

### 2A: The Artifact State Machine

The artifact panel has exactly 5 states. Implement this as a state machine:

```
                  ┌──────────────┐
                  │    CLOSED    │  (panel hidden, no artifact)
                  └──────┬───────┘
                         │ detect render_dashboard tool call
                         ▼
                  ┌──────────────┐
                  │   LOADING    │  (panel opens, shows skeleton/spinner)
                  └──────┬───────┘
                         │ all JSX chunks received (tool call complete)
                         ▼
                  ┌──────────────┐
                  │  RENDERING   │  (pass JSX to sandbox, attempting render)
                  └──────┬───────┘
                    ┌────┴────┐
                    │success  │failure
                    ▼         ▼
             ┌──────────┐  ┌──────────┐
             │  ACTIVE   │  │  ERROR   │
             │(dashboard │  │(show err │
             │ visible)  │  │+ retry)  │
             └──────────┘  └──────────┘
```

State transitions:
- **CLOSED → LOADING**: When stream parser detects a `tool_call_chunk` with `name: "render_dashboard"`. Open the panel immediately with a loading skeleton. Don't wait for the code — start opening the panel the MOMENT you see the tool name.
- **LOADING → RENDERING**: When the tool call is complete (received `tool_end` for `render_dashboard`). Now you have the full JSX string.
- **RENDERING → ACTIVE**: Sandbox iframe sends back a `postMessage` with `{ type: 'RENDER_SUCCESS' }`.
- **RENDERING → ERROR**: Sandbox sends `{ type: 'RENDER_ERROR', error: '...' }` or a timeout (5 seconds with no success message).
- **ERROR → LOADING**: User clicks "Retry" or agent regenerates.
- **ACTIVE → LOADING**: Agent generates a new/updated dashboard (new `render_dashboard` call).
- **ACTIVE → CLOSED**: User manually closes the panel (click X button).
- **Any state → CLOSED**: User clicks the close button.

### 2B: Stream Parser Implementation

```typescript
// hooks/useAgentStream.ts

interface ArtifactState {
  status: 'closed' | 'loading' | 'rendering' | 'active' | 'error';
  code: string | null;         // The full JSX code
  title: string;
  error: string | null;
  history: Array<{             // Version history
    code: string;
    title: string;
    timestamp: number;
  }>;
  activeVersion: number;       // Index into history
}

interface StreamState {
  messages: ChatMessage[];
  artifact: ArtifactState;
  isStreaming: boolean;
}

// Tool call accumulator — this is critical for parsing chunked tool calls
interface PendingToolCall {
  id: string;
  name: string;
  argsBuffer: string;  // Accumulates argument JSON chunks
}

function useAgentStream() {
  const [state, setState] = useState<StreamState>({ ... });
  const pendingToolCalls = useRef<Map<string, PendingToolCall>>(new Map());
  const currentTextBuffer = useRef<string>('');

  async function sendMessage(userMessage: string) {
    setState(prev => ({ ...prev, isStreaming: true }));

    // If there's a previous dashboard and user might be asking to edit it,
    // include the previous JSX in context
    const payload = {
      message: userMessage,
      // Send previous dashboard code so agent can edit it
      previous_artifact: state.artifact.code || undefined,
    };

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));

        switch (data.type) {
          case 'text':
            // Regular chat text — append to current assistant message
            currentTextBuffer.current += data.content;
            setState(prev => ({
              ...prev,
              messages: updateLastAssistantMessage(prev.messages, currentTextBuffer.current)
            }));
            break;

          case 'tool_call_chunk': {
            const { id, name, args } = data;

            if (name && !pendingToolCalls.current.has(id)) {
              // NEW tool call detected — first chunk with the tool name
              pendingToolCalls.current.set(id, { id, name, argsBuffer: '' });

              // **THIS IS THE TRIGGER** — open the panel immediately
              if (name === 'render_dashboard') {
                setState(prev => ({
                  ...prev,
                  artifact: { ...prev.artifact, status: 'loading', error: null }
                }));
              }
            }

            // Accumulate argument chunks
            if (id && pendingToolCalls.current.has(id) && args) {
              const tc = pendingToolCalls.current.get(id)!;
              tc.argsBuffer += args;
            }
            break;
          }

          case 'tool_end': {
            // Tool call is complete — extract the full arguments
            const tc = [...pendingToolCalls.current.values()]
              .find(t => t.name === data.name);

            if (tc?.name === 'render_dashboard') {
              try {
                const args = JSON.parse(tc.argsBuffer);
                const jsxCode = args.jsx_code;
                const title = args.title || 'Dashboard';

                // Save to history and trigger rendering
                setState(prev => ({
                  ...prev,
                  artifact: {
                    status: 'rendering',
                    code: jsxCode,
                    title,
                    error: null,
                    history: [...prev.artifact.history, {
                      code: jsxCode,
                      title,
                      timestamp: Date.now()
                    }],
                    activeVersion: prev.artifact.history.length, // newest
                  }
                }));
              } catch (e) {
                setState(prev => ({
                  ...prev,
                  artifact: { ...prev.artifact, status: 'error', error: 'Failed to parse dashboard code' }
                }));
              }
            }

            pendingToolCalls.current.delete(tc?.id || '');
            break;
          }

          case 'done':
            setState(prev => ({ ...prev, isStreaming: false }));
            currentTextBuffer.current = '';
            break;
        }
      }
    }
  }

  return { state, sendMessage };
}
```

### 2C: Edge Cases the Stream Parser Must Handle

**Edge case 1: Agent sends text BEFORE and AFTER the dashboard**
The agent might say "Let me create a dashboard for you" → call render_dashboard → then say "Here's your revenue breakdown." The parser must handle text chunks interleaved with tool call chunks. The `currentTextBuffer` handles this — text before the tool call goes in one message, text after goes in the same or a new message.

**Edge case 2: Agent calls render_dashboard TWICE in one response**
Possible if the user asks for two charts. Each tool call has a unique `id`. The panel should show the LATEST one, but both should be in the version history.

**Edge case 3: Agent calls other tools AND render_dashboard**
The agent will likely call SQL tools first, then render_dashboard. The stream parser must track ALL pending tool calls by ID and only react to `render_dashboard` for artifact purposes. Other tool calls are just displayed as status messages in the chat.

**Edge case 4: Partial JSON in args buffer**
Tool call arguments arrive as string chunks. The `argsBuffer` might contain invalid JSON until all chunks are received. NEVER try to parse `argsBuffer` until you get `tool_end`. Don't try to "preview" the JSX while it's streaming — wait for the complete code.

**Edge case 5: The agent's JSX is broken**
The sandbox will fail to render. It sends back a RENDER_ERROR postMessage. Show the error with a "Try fixing" button that sends a message to the agent like: "The dashboard failed to render with this error: {error}. The JSX code was: {first 200 chars}... Please fix it and call render_dashboard again."

**Edge case 6: User closes the panel then asks another question**
If the panel is CLOSED and the agent calls render_dashboard again, re-open it. Always respect the agent's intent to show a dashboard.

**Edge case 7: Page refresh**
Dashboards are ephemeral by default — they don't survive page refresh. If you want persistence, save the artifact history to the conversation state in your backend. For now, losing them on refresh is fine.

---

## Phase 3: The Sandbox Iframe

### 3A: Sandbox Page Setup

Create a standalone HTML page that the iframe loads. This is the isolated environment where LLM-generated code runs.

```html
<!-- public/sandbox.html (or a dedicated route) -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Artifact Sandbox</title>

  <!-- Tailwind CSS via CDN -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- React 18 -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>

  <!-- Recharts (UMD build) -->
  <script crossorigin src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js"></script>

  <!-- Lucide React -->
  <script crossorigin src="https://unpkg.com/lucide-react@0.383.0/dist/umd/lucide-react.js"></script>

  <!-- Sucrase (for JSX transpilation) -->
  <script crossorigin src="https://unpkg.com/sucrase@3.35.0/dist/sucrase.js"></script>

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; overflow: auto; }
    #root { min-height: 100vh; }
    #error-display { display: none; padding: 24px; font-family: monospace; }
    #error-display.visible { display: block; }
    #error-display pre { background: #1e1e2e; color: #f38ba8; padding: 16px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error-display">
    <p style="color: #cdd6f4; margin-bottom: 12px; font-family: sans-serif;">Dashboard failed to render:</p>
    <pre id="error-message"></pre>
  </div>

  <script>
    // ============================================================
    // SANDBOX RENDERER
    // ============================================================

    const ALLOWED_ORIGIN = window.location.origin; // Lock to same origin, or set to your app's origin

    // Scope: libraries available to the generated code via import statements
    const SCOPE = {
      'react': React,
      'recharts': Recharts,
      'lucide-react': window.LucideReact || {},
    };

    // Listen for render commands from parent
    window.addEventListener('message', (event) => {
      // Security: validate origin
      // if (event.origin !== ALLOWED_ORIGIN) return;

      const { type, code, id } = event.data;

      if (type === 'RENDER_ARTIFACT') {
        renderCode(code, id);
      }
    });

    function renderCode(jsxCode, requestId) {
      const root = document.getElementById('root');
      const errorDisplay = document.getElementById('error-display');
      const errorMessage = document.getElementById('error-message');

      // Reset
      errorDisplay.className = '';
      root.style.display = 'block';

      try {
        // Step 1: Rewrite imports to use our scope
        // Transform: import { X } from "recharts" → const { X } = __SCOPE__["recharts"]
        let processedCode = jsxCode;

        // Remove all import statements and collect what they import
        const importRegex = /import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s+from\s+['"]([^'"]+)['"]\s*;?/g;
        const imports = [];
        processedCode = processedCode.replace(importRegex, (match, defaultImport, namedImports, source) => {
          imports.push({ defaultImport, namedImports, source });
          return ''; // Remove the import line
        });

        // Build import scope assignments
        let scopeSetup = '';
        for (const imp of imports) {
          const scopeObj = `__SCOPE__["${imp.source}"]`;
          if (imp.source === 'react') {
            // React hooks: destructure from React global
            if (imp.namedImports) {
              const names = imp.namedImports.split(',').map(n => n.trim()).filter(Boolean);
              for (const name of names) {
                // Handle "X as Y" syntax
                const [original, alias] = name.split(/\s+as\s+/).map(s => s.trim());
                scopeSetup += `const ${alias || original} = React.${original};\n`;
              }
            }
          } else if (SCOPE[imp.source]) {
            if (imp.defaultImport) {
              scopeSetup += `const ${imp.defaultImport} = ${scopeObj};\n`;
            }
            if (imp.namedImports) {
              const names = imp.namedImports.split(',').map(n => n.trim()).filter(Boolean);
              for (const name of names) {
                const [original, alias] = name.split(/\s+as\s+/).map(s => s.trim());
                scopeSetup += `const ${alias || original} = ${scopeObj}.${original} || ${scopeObj}["${original}"];\n`;
              }
            }
          }
        }

        // Remove "export default" — we'll capture the component differently
        processedCode = processedCode.replace(/export\s+default\s+function\s+(\w+)/, 'function $1');
        processedCode = processedCode.replace(/export\s+default\s+/, 'const __DEFAULT_EXPORT__ = ');

        // Find the component name (last function declaration or __DEFAULT_EXPORT__)
        const funcMatch = processedCode.match(/function\s+(\w+)\s*\(/g);
        const lastFunc = funcMatch ? funcMatch[funcMatch.length - 1].match(/function\s+(\w+)/)[1] : null;

        // Step 2: Transpile JSX → JS using Sucrase
        const transpiled = Sucrase.transform(scopeSetup + processedCode, {
          transforms: ['jsx'],
          jsxRuntime: 'classic',
          production: true,
        }).code;

        // Step 3: Evaluate and get the component
        const fullCode = `
          ${transpiled}
          return typeof __DEFAULT_EXPORT__ !== 'undefined' ? __DEFAULT_EXPORT__ : ${lastFunc || 'null'};
        `;

        const __SCOPE__ = SCOPE;
        const Component = new Function('React', 'Recharts', '__SCOPE__', fullCode)(
          React, Recharts, __SCOPE__
        );

        if (!Component) {
          throw new Error('No component found. Make sure you have "export default function ..."');
        }

        // Step 4: Render
        const reactRoot = ReactDOM.createRoot(root);
        reactRoot.render(React.createElement(Component));

        // Step 5: Notify parent of success
        window.parent.postMessage({
          type: 'RENDER_SUCCESS',
          id: requestId,
        }, '*');

      } catch (err) {
        console.error('Sandbox render error:', err);

        root.style.display = 'none';
        errorDisplay.className = 'visible';
        errorMessage.textContent = err.message + (err.stack ? '\n\n' + err.stack.split('\n').slice(0, 5).join('\n') : '');

        // Notify parent of failure
        window.parent.postMessage({
          type: 'RENDER_ERROR',
          id: requestId,
          error: err.message,
        }, '*');
      }
    }

    // Notify parent that sandbox is ready
    window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
  </script>
</body>
</html>
```

### 3B: PostMessage Protocol

The main app and sandbox communicate via postMessage. Here's the complete protocol:

**Parent → Sandbox:**
```typescript
// Render a dashboard
iframe.contentWindow.postMessage({
  type: 'RENDER_ARTIFACT',
  code: jsxCode,      // The full JSX string
  id: 'artifact-123', // Unique ID for this render request
}, '*');
```

**Sandbox → Parent:**
```typescript
// Sandbox is loaded and ready
{ type: 'SANDBOX_READY' }

// Render succeeded
{ type: 'RENDER_SUCCESS', id: 'artifact-123' }

// Render failed
{ type: 'RENDER_ERROR', id: 'artifact-123', error: 'Unexpected token ...' }
```

### 3C: Iframe Security

```html
<!-- In your main app, the iframe should have these attributes: -->
<iframe
  src="/sandbox.html"
  sandbox="allow-scripts"
  style="width: 100%; height: 100%; border: none;"
  title="Dashboard Preview"
/>
```

The `sandbox="allow-scripts"` attribute:
- ✅ Allows JavaScript execution (needed for React)
- ❌ Blocks access to parent's DOM
- ❌ Blocks access to parent's cookies/storage
- ❌ Blocks navigation
- ❌ Blocks form submission
- ❌ Blocks popups

**NOTE:** Do NOT add `allow-same-origin` unless absolutely needed — it weakens the sandbox. Without it, the iframe is treated as a unique origin with no access to your app's data.

If you need `allow-same-origin` (e.g., for Google Fonts to load), consider hosting `sandbox.html` on a separate subdomain instead (like `sandbox.yourapp.com`). This gives you full origin isolation.

---

## Phase 4: Frontend — The Split Pane UI

### 4A: Layout Architecture

```
┌────────────────────────────────────────────────────────────┐
│  App Shell (header, nav, etc.)                             │
├──────────────────────────┬─────────────────────────────────┤
│                          │                                  │
│   Chat Panel             │   Artifact Panel                 │
│                          │   ┌─────────────────────────┐   │
│   ┌─────────────────┐   │   │ Toolbar (title, actions) │   │
│   │ Message History  │   │   ├─────────────────────────┤   │
│   │                  │   │   │                          │   │
│   │  User: show me   │   │   │  Sandboxed Iframe        │   │
│   │  revenue...      │   │   │  (renders dashboard)     │   │
│   │                  │   │   │                          │   │
│   │  Agent: Here's   │   │   │                          │   │
│   │  your dashboard  │   │   │                          │   │
│   │                  │   │   │                          │   │
│   ├─────────────────┤   │   ├─────────────────────────┤   │
│   │ Input box        │   │   │ Footer (version dots)    │   │
│   └─────────────────┘   │   └─────────────────────────┘   │
│                          │                                  │
├──────────────────────────┴─────────────────────────────────┤
│  ← Resize handle (draggable)                               │
└────────────────────────────────────────────────────────────┘
```

- When artifact status is `CLOSED`, the chat panel takes full width
- When artifact opens, animate the split (chat shrinks to ~45%, artifact takes ~55%)
- The resize handle between them is draggable
- On mobile (< 768px), stack vertically: chat on top, artifact below (or use a tab switch)

### 4B: Artifact Panel Components

**Toolbar** shows:
- Dashboard title (from the tool call's `title` argument)
- "Code" toggle button → switches between rendered preview and raw JSX
- "Copy" button → copies JSX to clipboard
- Version dots → if multiple dashboards were generated, show pagination dots
- "Close" button (X) → collapses the panel

**Loading state** (during LOADING status):
Show a skeleton that matches the typical dashboard layout — a few rectangles for KPI cards, a larger rectangle for the chart area, smaller ones for the table. Use `animate-pulse` on gray shapes. This gives the user a sense of what's coming.

**Error state** (during ERROR status):
Show the error message from the sandbox, plus a "Try Fixing" button. When clicked, send a message to the agent: "The dashboard failed to render with this error: [error]. Please fix the code and try again."

### 4C: Version History

Every time the agent calls `render_dashboard`, save the result to an array:

```typescript
history: [
  { code: '...jsx v1...', title: 'Revenue Dashboard', timestamp: 1711234567890 },
  { code: '...jsx v2...', title: 'Revenue Dashboard (Updated)', timestamp: 1711234600000 },
]
```

Show pagination dots at the bottom of the artifact panel. Clicking a dot renders that version in the sandbox. The active version has a highlighted dot.

---

## Phase 5: Data Flow — From SQL to Dashboard

The end-to-end flow when a user says "show me monthly revenue":

```
1. User types "show me monthly revenue"
   │
2. Frontend sends message to /api/chat via SSE
   │
3. Agent thinks → decides to query SQL
   │
4. Agent calls: sql_query("SELECT month, revenue FROM sales GROUP BY month ORDER BY month")
   │  ← Stream sends: tool_start (sql_query)
   │  ← Stream sends: tool_end (sql_query, output: [{month: "Jan", revenue: 45200}, ...])
   │
5. Agent sees the data → decides to visualize it
   │
6. Agent calls: render_dashboard(jsx_code="import { useState }...", title="Monthly Revenue")
   │  ← Stream sends: tool_call_chunk (name: "render_dashboard") → PANEL OPENS
   │  ← Stream sends: tool_call_chunk (args: partial JSON chunks...)
   │  ← Stream sends: tool_call_chunk (args: more chunks...)
   │  ← Stream sends: tool_end (render_dashboard) → JSX COMPLETE, SEND TO SANDBOX
   │
7. Sandbox receives JSX → transpiles → renders
   │  ← postMessage: RENDER_SUCCESS → PANEL SHOWS DASHBOARD
   │
8. Agent says: "Here's your monthly revenue dashboard showing growth from $45.2k to $67.4k."
   │  ← Stream sends: text chunks
   │
9. Stream sends: done
```

### 5A: Large Dataset Handling

If the SQL query returns too much data (>200 rows), the JSX will be huge and may hit token limits. Handle this in the agent's system prompt:

```
If your SQL query returns more than 200 rows:
1. Do NOT embed all rows in the dashboard
2. Instead, write a SECOND SQL query that aggregates the data:
   - GROUP BY a meaningful dimension (month, category, region)
   - Use TOP/LIMIT for rankings
   - Calculate summary statistics (SUM, AVG, COUNT)
3. Use the aggregated result in the dashboard
4. Show a note in the dashboard: "Showing aggregated view of N total records"
```

### 5B: Dashboard Editing Flow

When the user says "make the bars red" or "add a pie chart":

1. Backend receives the message + the `previous_artifact` code (sent by frontend)
2. The system prompt tells the agent: "The user wants to modify the existing dashboard. Here is the current JSX: {previous_artifact}"
3. Agent edits the JSX and calls `render_dashboard` again with updated code
4. Frontend detects the new tool call → enters LOADING → replaces the dashboard
5. Previous version stays in the version history

The frontend should send the previous artifact in the request body:
```typescript
const payload = {
  message: userMessage,
  previous_artifact: state.artifact.code || undefined,
};
```

And the backend should inject it into the conversation:
```python
messages = request.messages.copy()
if request.previous_artifact:
    # Add context about the existing dashboard
    messages.append({
        "role": "user",
        "content": f"[CONTEXT: The current dashboard code is:\n```jsx\n{request.previous_artifact}\n```\nIf I ask to modify it, edit this code rather than rewriting from scratch.]"
    })
```

---

## Phase 6: Polish & Edge Cases

### 6A: Loading Animation
When artifact status is LOADING, show this skeleton pattern:
- 4 small rounded rectangles (KPI card shapes) in a row → `animate-pulse bg-gray-700/30`
- 1 large rectangle (chart area) → `animate-pulse bg-gray-700/20`
- 3 narrow rectangles (table rows) → `animate-pulse bg-gray-700/10`

### 6B: Smooth Panel Transition
- Panel opens with a CSS transition: `transition: width 300ms ease-out`
- Content fades in: `opacity` transition after the width animation completes
- Panel close: reverse animation

### 6C: Retry on Error
Add a "Try Fixing" button that sends this auto-message to the agent:
```
The dashboard failed to render with this error:

{error_message}

Please fix the JSX code and call render_dashboard again. Here was the broken code:

{first_500_chars_of_code}...
```

### 6D: Keyboard Shortcuts
- `Escape` → close artifact panel
- `Cmd/Ctrl + Shift + C` → copy JSX code
- `Cmd/Ctrl + Shift + V` → toggle code view

### 6E: Empty State
If the user hasn't generated any dashboards yet, the artifact panel doesn't exist. Only the chat takes full width. No empty placeholder panel.

### 6F: Multiple Conversations
If your app supports multiple chat conversations, each conversation has its own artifact state. Switching conversations should switch the artifact panel content (or close it if that conversation has no artifacts).

---

## File Structure

```
project/
├── frontend/
│   ├── components/
│   │   ├── SplitLayout.tsx             # Resizable split pane
│   │   ├── ChatPanel.tsx               # Left side: message list + input
│   │   ├── ArtifactPanel.tsx           # Right side: toolbar + iframe + versions
│   │   ├── ArtifactToolbar.tsx         # Title, code toggle, copy, close
│   │   ├── ArtifactSkeleton.tsx        # Loading skeleton animation
│   │   ├── ArtifactError.tsx           # Error state with retry button
│   │   ├── ArtifactVersionDots.tsx     # Version pagination
│   │   └── CodeViewer.tsx              # Raw JSX display with syntax highlighting
│   ├── hooks/
│   │   ├── useAgentStream.ts           # SSE parser + artifact state machine
│   │   ├── useArtifact.ts              # Artifact state + version management
│   │   └── useSandbox.ts               # postMessage communication with iframe
│   ├── public/
│   │   └── sandbox.html                # Standalone sandbox page for iframe
│   └── lib/
│       ├── stream-parser.ts            # Low-level SSE event parsing
│       └── constants.ts                # Allowed origins, timeouts, etc.
├── backend/
│   ├── agent/
│   │   ├── tools/
│   │   │   ├── sql_tools.py            # Your existing SQL tools
│   │   │   └── render_dashboard.py     # The render_dashboard tool
│   │   ├── skills/
│   │   │   └── dashboard-builder/
│   │   │       └── SKILL.md            # Dashboard generation skill
│   │   ├── prompts/
│   │   │   └── system_prompt.py        # System prompt with skill loaded
│   │   └── agent.py                    # Deep Agent configuration
│   └── api/
│       ├── routes.py                   # API endpoints
│       └── stream.py                   # SSE streaming handler
└── package.json
```

---

## How To Execute This

1. **Phase 0**: Explore my project, confirm the plan
2. **Phase 1**: Backend changes (tool + skill + system prompt + streaming)
3. **Phase 2**: Stream parser hook (the hardest part — get this right)
4. **Phase 3**: Sandbox HTML page (test it standalone first with hardcoded JSX)
5. **Phase 4**: Split pane UI + artifact panel components
6. **Phase 5**: Wire it all together end-to-end
7. **Phase 6**: Polish

**Test at each phase:**
- After Phase 3: Open sandbox.html directly, paste JSX into browser console via `renderCode(...)`, verify it renders
- After Phase 4: Hardcode a fake artifact state to verify the panel opens/closes/shows code
- After Phase 5: Send a real message and watch the full pipeline work

Start with Phase 0. Explore my project now.
