"use client";

// Geçici test sayfası — chat-markdown-renderer'ın `advanced-table` bloklarını
// doğru parse edip <AdvancedTable /> bastırdığını görsel olarak doğrulamak
// için. LLM/backend gerekmiyor. Doğrulama bittikten sonra SİL.

import { useState } from "react";
import { ChatMarkdownRenderer } from "@/components/chat/chat-markdown-renderer";

const HAPPY_PATH = `Merhaba, işte 2025 mali işler raporu:

\`\`\`advanced-table
{
  "title": "Mali İşler Raporu",
  "description": "2025 yılına ait mali işler özet tablosudur.",
  "columns": [
    { "key": "id", "label": "ID", "type": "number" },
    { "key": "kategori", "label": "Kategori", "type": "string" },
    { "key": "tutar", "label": "Tutar", "type": "number", "unit": "₺" }
  ],
  "rows": [
    { "id": 1, "kategori": "Maaşlar", "tutar": 50000 },
    { "id": 2, "kategori": "Vergiler", "tutar": 12500 },
    { "id": 3, "kategori": "Kira", "tutar": 18000 },
    { "id": 4, "kategori": "Pazarlama", "tutar": 24750 },
    { "id": 5, "kategori": "Yazılım Lisansları", "tutar": 9300 }
  ]
}
\`\`\`

Özet: toplam gider **114.550 ₺**. Ayrıca \`inline code\` böyle görünmeli.

\`\`\`ts
// Standart kod blokları da bozulmamalı
const x: number = 42;
console.log(x);
\`\`\`
`;

const BROKEN_JSON = `Bu blok bilerek bozuk — fallback UI görünmeli:

\`\`\`advanced-table
{ "title": "Bozuk", "columns": [ { "key": "a", }
\`\`\`
`;

const INVALID_SCHEMA = `Bu blok geçerli JSON ama AdvancedTableProps sözleşmesine uymuyor:

\`\`\`advanced-table
{ "foo": "bar", "baz": 123 }
\`\`\`
`;

const CASES: Record<string, string> = {
  "Happy path": HAPPY_PATH,
  "Broken JSON (fallback)": BROKEN_JSON,
  "Invalid schema (fallback)": INVALID_SCHEMA,
};

export default function TestTablePage() {
  const [active, setActive] = useState<keyof typeof CASES>("Happy path");

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-semibold">
        ChatMarkdownRenderer — Test Sayfası
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        advanced-table bloklarının render edildiğini ve fallback'lerin çalıştığını
        doğrulamak için geçici sayfa. Üretimde SİLİN.
      </p>

      <div className="mb-6 flex gap-2">
        {Object.keys(CASES).map((name) => (
          <button
            key={name}
            onClick={() => setActive(name as keyof typeof CASES)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              active === name
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <ChatMarkdownRenderer className="prose prose-sm dark:prose-invert max-w-none">
          {CASES[active]}
        </ChatMarkdownRenderer>
      </div>
    </div>
  );
}
