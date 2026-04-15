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
//   { "tableId": "uuid-..." }
//   ```
//
// Neden sadece tableId? 1000+ satırlı tablolarda tüm veriyi LLM stream'ine
// yazmak hem pahalı hem yavaş. Tool gerçek payload'ı backend'de saklar, sadece
// küçük bir referans emitler. Renderer bu ID'yi görünce GET /tables/:id ile
// tam payload'ı çeker ve <AdvancedTable /> bastırır.
//
// Geri uyumluluk: eski chat geçmişlerinde inline `{ columns, rows }` JSON
// blokları kalmış olabilir. Eğer blok tableId yerine columns/rows içeriyorsa
// onları da aynı bileşenle render ediyoruz.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
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

function isAdvancedTableRef(value: unknown): value is { tableId: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.tableId === "string" && v.tableId.length > 0;
}

// AdvancedTable, key="__index" olan kolonu otomatik olarak sola sabitler ve
// hareket ettirilemez yapar (1-2-3... sıra numarası). LLM'e bunu yazdırmak
// yerine renderer'da prepend ediyoruz — sözleşme sade kalsın, model index
// kolonunu hiç düşünmesin diye.
function withIndexColumn(payload: AdvancedTableProps): AdvancedTableProps {
  return {
    ...payload,
    columns: [
      // type'ı kasıtlı olarak "number" VERİLMİYOR — advanced-table sadece
      // number kolonları aggregate ediyor. Index'i number yaparsak footer'da
      // "Top: 6" gibi anlamsız bir satır numarası toplamı çıkar.
      { key: "__index", label: "No" },
      ...payload.columns,
    ],
  };
}

// Fixed height for chat-rendered tables — every table gets the same large
// frame regardless of row count, so small datasets don't render as a tiny
// strip. LyteNyte Grid scrolls internally when rows exceed the viewport.
const ADVANCED_TABLE_HEIGHT = 480;

/**
 * Streaming sırasında blok henüz tamamlanmamış olabilir — JSON yarım gelir.
 * Balanced braces heuristic: açık ve kapalı { } sayıları eşit değilse veya hiç
 * kapanış süslü parantez yoksa içerik "henüz bitmemiş" sayılır.
 */
function looksIncomplete(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("{")) return true;
  if (!trimmed.endsWith("}")) return true;
  let open = 0;
  let close = 0;
  let inString = false;
  let escape = false;
  for (const ch of trimmed) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") open++;
    else if (ch === "}") close++;
  }
  return open !== close || open === 0;
}

function AdvancedTableSkeleton({ height }: { height: number }) {
  return (
    <div
      className="my-4 w-full animate-pulse rounded-xl border border-border bg-muted/20"
      style={{ height }}
    >
      <div className="flex h-10 items-center gap-2 border-b border-border/60 px-3">
        <div className="h-4 w-32 rounded bg-muted/60" />
        <div className="ml-auto h-4 w-20 rounded bg-muted/60" />
      </div>
      <div className="flex h-10 items-center gap-4 border-b border-border/60 px-3">
        <div className="h-3 w-16 rounded bg-muted/60" />
        <div className="h-3 w-24 rounded bg-muted/60" />
        <div className="h-3 w-20 rounded bg-muted/60" />
      </div>
      <div className="space-y-3 p-3">
        <div className="h-3 w-full rounded bg-muted/40" />
        <div className="h-3 w-5/6 rounded bg-muted/40" />
        <div className="h-3 w-4/6 rounded bg-muted/40" />
      </div>
    </div>
  );
}

// ─── Remote fetcher (tableId → payload via GET /tables/:id) ─────────────────

function RemoteAdvancedTable({ tableId }: { tableId: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; payload: AdvancedTableProps }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    fetch(`${BACKEND_URL}/tables/${encodeURIComponent(tableId)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Tablo bulunamadı veya süresi doldu."
              : `Sunucu ${res.status} döndü.`,
          );
        }
        const data: unknown = await res.json();
        if (!isAdvancedTablePayload(data)) {
          throw new Error(
            "Sunucudan gelen veri AdvancedTableProps sözleşmesine uymuyor.",
          );
        }
        return data;
      })
      .then((payload) => {
        if (!cancelled) setState({ kind: "ready", payload });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Bilinmeyen tablo hatası.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tableId]);

  if (state.kind === "loading") {
    return <AdvancedTableSkeleton height={320} />;
  }
  if (state.kind === "error") {
    return (
      <AdvancedTableFallback
        raw={`tableId: ${tableId}`}
        error={state.message}
      />
    );
  }

  const propsWithIndex = withIndexColumn(state.payload);
  return (
    <div
      className="my-4 w-full"
      style={{ height: ADVANCED_TABLE_HEIGHT }}
    >
      <AdvancedTable {...propsWithIndex} hideFooterAggregate />
    </div>
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

    // Streaming sırasında blok henüz tamamlanmadıysa parse edip hata gösterme
    // — kullanıcıya titreşimli bir skeleton göster, bir sonraki chunk'ta
    // yeniden deneyeceğiz. Son chunk geldiğinde raw dengelenmiş olur.
    if (looksIncomplete(raw)) {
      return <AdvancedTableSkeleton height={280} />;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return (
        <AdvancedTableFallback
          raw={raw}
          error="Tablo bloğu geçerli JSON değil — model bozuk bir yapı döndürdü."
        />
      );
    }

    // Yeni yol: blok sadece bir tableId ref'i içeriyor → backend'den çek.
    if (isAdvancedTableRef(parsed)) {
      return <RemoteAdvancedTable tableId={parsed.tableId} />;
    }

    // Geri uyumluluk: eski chat geçmişlerinde blok tam payload içerebilir.
    // (Yeni istekler her zaman ref üretir, bu dal sadece history replay için.)
    if (isAdvancedTablePayload(parsed)) {
      const propsWithIndex = withIndexColumn(parsed);
      return (
        <div
          className="my-4 w-full"
          style={{ height: ADVANCED_TABLE_HEIGHT }}
        >
          <AdvancedTable {...propsWithIndex} hideFooterAggregate />
        </div>
      );
    }

    return (
      <AdvancedTableFallback
        raw={raw}
        error="Tablo bloğu ne bir tableId ne de geçerli bir payload içeriyor."
      />
    );
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
