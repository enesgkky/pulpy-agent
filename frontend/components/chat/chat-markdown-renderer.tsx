"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ChatMarkdownRenderer
//
// LLM'den gelen Markdown'ı render ederken özel `advanced-table` kod bloklarını
// yakalayıp <AdvancedTable /> bileşenine çeviren custom renderer.
//
// Backend tarafındaki tool (generate_advanced_table) çıktıyı şu formatta üretir:
//
//   ```advanced-table
//   { "title": "...", "columns": [...], "rows": [...] }
//   ```
//
// react-markdown'ın `code` component override'ı className içinde
// "language-advanced-table" gördüğünde JSON'u parse edip <AdvancedTable />
// bastırır. Parse hatası olursa kullanıcıya zarif bir fallback gösterilir.
//
// Bu dosya hem standalone örnektir (asıl projeye olduğu gibi kopyalanabilir)
// hem de pulpy-agent'ın mevcut Markdown bileşeninin kullandığı override
// haritasının (chatMarkdownComponents) kaynağıdır.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useMemo } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
// AdvancedTable accesses `document` (canvas measurement, portals) so we must
// avoid executing it during SSR. next/dynamic with ssr:false defers the import
// to the browser — this also breaks the import graph: the real component is
// only pulled in at first render, not at module-init time.
import type { AdvancedTableProps } from "@/components/ui/advanced-table";
const AdvancedTable = dynamic(
  () =>
    import("@/components/ui/advanced-table").then((m) => ({
      default: m.AdvancedTable,
    })),
  { ssr: false },
);

// Backend tool'u ile aynı dil etiketi. İkisi de değişmek zorunda kalırsa
// tek bir paylaşılan sabit dosyaya alınması düşünülebilir.
const ADVANCED_TABLE_LANG = "advanced-table";

// ─── Yardımcılar ────────────────────────────────────────────────────────────

function extractLanguage(className?: string): string {
  if (!className) return "plaintext";
  const match = className.match(/language-([\w-]+)/);
  return match ? match[1] : "plaintext";
}

/**
 * react-markdown bazen çocukları string, bazen ReactNode array verir.
 * Code block içeriğini düz string'e indirgemek için.
 */
function childrenToString(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToString).join("");
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "number") return String(children);
  if (typeof children === "object" && "props" in (children as object)) {
    const c = (children as { props?: { children?: React.ReactNode } }).props
      ?.children;
    return childrenToString(c);
  }
  return "";
}

function isAdvancedTablePayload(value: unknown): value is AdvancedTableProps {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.columns) &&
    Array.isArray(v.rows) &&
    v.columns.every(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof (c as Record<string, unknown>).key === "string" &&
        typeof (c as Record<string, unknown>).label === "string",
    )
  );
}

// ─── Fallback UI ────────────────────────────────────────────────────────────

function AdvancedTableFallback({
  raw,
  error,
}: {
  raw: string;
  error: string;
}) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-destructive/40 bg-destructive/5">
      <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Tablo bloğu işlenemedi</span>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">{error}</p>
      <pre className="max-h-48 overflow-auto px-4 py-3 text-xs text-muted-foreground">
        {raw}
      </pre>
    </div>
  );
}

// ─── Code component override ────────────────────────────────────────────────

type CodeProps = React.ComponentProps<"code"> & {
  node?: { position?: { start: { line: number }; end: { line: number } } };
};

function CodeComponent({ className, children, node, ...props }: CodeProps) {
  const language = extractLanguage(className);

  // ─── Generative UI: advanced-table ───────────────────────────────────────
  if (language === ADVANCED_TABLE_LANG) {
    const raw = childrenToString(children).trim();
    try {
      const parsed = JSON.parse(raw);
      if (!isAdvancedTablePayload(parsed)) {
        return (
          <AdvancedTableFallback
            raw={raw}
            error="JSON yapısı AdvancedTableProps sözleşmesine uymuyor (columns/rows eksik veya hatalı)."
          />
        );
      }
      // AdvancedTable (LyteNyte Grid) inherits height from its parent via
      // h-full. In a chat bubble the parent is auto-sized, so without a
      // fixed/min height the row viewport collapses to 0px. Give it a
      // sensible height based on row count, capped so huge tables still fit.
      const rowCount = parsed.rows.length;
      const chromeHeight = 160; // toolbar + header + filter row + footer
      const rowHeight = 36;
      const computedHeight = Math.min(
        640,
        Math.max(320, chromeHeight + rowCount * rowHeight),
      );
      return (
        <div
          className="my-4 w-full"
          style={{ height: computedHeight }}
        >
          <AdvancedTable {...parsed} />
        </div>
      );
    } catch (err) {
      return (
        <AdvancedTableFallback
          raw={raw}
          error={
            err instanceof Error
              ? `JSON parse hatası: ${err.message}`
              : "Bilinmeyen JSON parse hatası."
          }
        />
      );
    }
  }

  // ─── Inline code ────────────────────────────────────────────────────────
  // react-markdown v10'da inline tespit için node.position kullanıyoruz:
  // tek satırlık ve language tag'i olmayan kod = inline.
  const isInline =
    !node?.position?.start.line ||
    node.position.start.line === node.position.end.line;

  if (isInline) {
    return (
      <span
        className={cn(
          "bg-primary-foreground rounded-sm px-1 font-mono text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  }

  // ─── Standart kod bloğu (shiki ile) ─────────────────────────────────────
  return (
    <CodeBlock className={className}>
      <CodeBlockCode code={childrenToString(children)} language={language} />
    </CodeBlock>
  );
}

/**
 * Markdown bileşeni içine geçirilebilecek hazır component override haritası.
 * Mevcut <Markdown /> bileşeninizden bunu `components` prop'u olarak geçirin
 * veya kendi INITIAL_COMPONENTS'inizi bununla değiştirin.
 */
export const chatMarkdownComponents: Partial<Components> = {
  code: CodeComponent as Components["code"],
  pre: function PreComponent({ children }) {
    // <pre> sarmalını yok say — CodeBlock kendi konteynerini sağlıyor.
    return <>{children}</>;
  },
};

// ─── Standalone wrapper (kopyala-yapıştır referansı) ────────────────────────
// Asıl projede mevcut Markdown bileşeniniz varsa onu kullanmaya devam edip
// sadece yukarıdaki `chatMarkdownComponents`'i geçirebilirsiniz. Yoksa bu
// wrapper doğrudan ChatMarkdownRenderer olarak da kullanılabilir.

export type ChatMarkdownRendererProps = {
  children: string;
  className?: string;
};

function ChatMarkdownRendererImpl({
  children,
  className,
}: ChatMarkdownRendererProps) {
  const components = useMemo(() => chatMarkdownComponents, []);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const ChatMarkdownRenderer = memo(ChatMarkdownRendererImpl);
ChatMarkdownRenderer.displayName = "ChatMarkdownRenderer";
