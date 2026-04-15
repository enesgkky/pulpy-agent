import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// ─── Frontend Sözleşmesi ──────────────────────────────────────────────────
// AdvancedTableProps ile birebir aynı kalmalı. Frontend tarafındaki tipi
// değiştirirseniz bu dosyadaki tipi de güncelleyin — LLM çıktısı bu sözleşmeye
// göre validate ediliyor.

export interface AdvancedTableColumn {
  key: string;
  label: string;
  type?: 'string' | 'number' | 'date' | 'boolean';
  unit?: string;
}

export interface AdvancedTablePayload {
  title?: string;
  description?: string;
  columns: AdvancedTableColumn[];
  rows: Record<string, string | number>[];
}

// ─── Markdown Wrapper ─────────────────────────────────────────────────────
// LLM çıktısının içine gömülecek özel kod bloğu. Frontend'deki
// ChatMarkdownRenderer bu language tag'ini yakalayıp <AdvancedTable /> render
// edecek. Dilini değiştirirseniz iki tarafı da güncellemeniz gerekir.
export const ADVANCED_TABLE_LANG = 'advanced-table';

function wrapAsAdvancedTableBlock(payload: AdvancedTablePayload): string {
  const json = JSON.stringify(payload, null, 2);
  return ['```' + ADVANCED_TABLE_LANG, json, '```'].join('\n');
}

// ─── Tool Girdisi (Zod Schema) ────────────────────────────────────────────
// LLM bu şemayı görerek tool'u nasıl çağıracağına karar veriyor. Açıklamaları
// (`describe`) net tutmak doğrudan call kalitesini etkiler.

const TableGeneratorInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Doğal dilde tablo isteğinin kısa özeti. Örn: '2025 mali işler raporu', 'son 10 satış', 'aktif çalışanlar'.",
    ),
  category: z
    .enum(['finance', 'sales', 'hr', 'inventory', 'general'])
    .default('general')
    .describe(
      'İstenen verinin iş alanı kategorisi. Mock veritabanı bu kategoriye göre sütun ve satır üretir.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe('Döndürülecek maksimum satır sayısı.'),
  year: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe('Filtrelenecek opsiyonel yıl. Verilmezse içinde bulunulan yıl kullanılır.'),
});

type TableGeneratorInput = z.infer<typeof TableGeneratorInputSchema>;

// ─── Mock Veritabanı ──────────────────────────────────────────────────────
// Gerçek projede burayı kendi DB/API katmanınızla değiştirin. Dönen yapı yine
// AdvancedTablePayload olmak zorunda — frontend kontratı bu.

function fetchMockTable(input: TableGeneratorInput): AdvancedTablePayload {
  const year = input.year ?? new Date().getFullYear();

  switch (input.category) {
    case 'finance': {
      const baseRows = [
        { id: 1, kategori: 'Maaşlar', tutar: 50_000 },
        { id: 2, kategori: 'Vergiler', tutar: 12_500 },
        { id: 3, kategori: 'Kira', tutar: 18_000 },
        { id: 4, kategori: 'Pazarlama', tutar: 24_750 },
        { id: 5, kategori: 'Yazılım Lisansları', tutar: 9_300 },
      ];
      return {
        title: `Mali İşler Raporu (${year})`,
        description: `${year} yılına ait mali işler özet tablosudur.`,
        columns: [
          { key: 'id', label: 'ID', type: 'number' },
          { key: 'kategori', label: 'Kategori', type: 'string' },
          { key: 'tutar', label: 'Tutar', type: 'number', unit: '₺' },
        ],
        rows: baseRows.slice(0, input.limit),
      };
    }

    case 'sales': {
      const baseRows = [
        { id: 1, urun: 'Pulpy Pro Lisans', adet: 42, ciro: 168_000 },
        { id: 2, urun: 'Vizio Analytics', adet: 17, ciro: 85_000 },
        { id: 3, urun: 'Morf Add-on', adet: 63, ciro: 31_500 },
      ];
      return {
        title: `Satış Özeti (${year})`,
        description: 'Ürün bazlı satış adet ve ciro tablosu.',
        columns: [
          { key: 'id', label: 'ID', type: 'number' },
          { key: 'urun', label: 'Ürün', type: 'string' },
          { key: 'adet', label: 'Adet', type: 'number' },
          { key: 'ciro', label: 'Ciro', type: 'number', unit: '₺' },
        ],
        rows: baseRows.slice(0, input.limit),
      };
    }

    case 'hr': {
      const baseRows = [
        { id: 1, ad: 'Ayşe Yılmaz', departman: 'Mühendislik', kidem: 5 },
        { id: 2, ad: 'Mehmet Demir', departman: 'Satış', kidem: 3 },
        { id: 3, ad: 'Zeynep Kaya', departman: 'Tasarım', kidem: 2 },
      ];
      return {
        title: 'Aktif Çalışanlar',
        description: 'Departman ve kıdem bilgisi ile aktif çalışan listesi.',
        columns: [
          { key: 'id', label: 'ID', type: 'number' },
          { key: 'ad', label: 'Ad Soyad', type: 'string' },
          { key: 'departman', label: 'Departman', type: 'string' },
          { key: 'kidem', label: 'Kıdem', type: 'number', unit: 'yıl' },
        ],
        rows: baseRows.slice(0, input.limit),
      };
    }

    case 'inventory': {
      const baseRows = [
        { id: 1, sku: 'PLP-001', urun: 'Pulpy Server', stok: 124 },
        { id: 2, sku: 'PLP-002', urun: 'Pulpy Edge', stok: 38 },
        { id: 3, sku: 'PLP-003', urun: 'Pulpy Mini', stok: 256 },
      ];
      return {
        title: 'Stok Durumu',
        description: 'SKU bazlı güncel stok seviyeleri.',
        columns: [
          { key: 'id', label: 'ID', type: 'number' },
          { key: 'sku', label: 'SKU', type: 'string' },
          { key: 'urun', label: 'Ürün', type: 'string' },
          { key: 'stok', label: 'Stok', type: 'number', unit: 'adet' },
        ],
        rows: baseRows.slice(0, input.limit),
      };
    }

    case 'general':
    default: {
      return {
        title: input.query,
        description: `"${input.query}" sorgusu için örnek tablo.`,
        columns: [
          { key: 'id', label: 'ID', type: 'number' },
          { key: 'baslik', label: 'Başlık', type: 'string' },
          { key: 'deger', label: 'Değer', type: 'number' },
        ],
        rows: Array.from({ length: Math.min(input.limit, 5) }, (_, i) => ({
          id: i + 1,
          baslik: `Kayıt ${i + 1}`,
          deger: Math.round(Math.random() * 1000),
        })),
      };
    }
  }
}

// ─── Runtime Validation ───────────────────────────────────────────────────
// Mock veriyi production data ile değiştirdiğinizde sözleşme bozulursa burada
// erkenden patlayalım — LLM'in bozuk JSON ile döndüğü hatalı bir frame'i
// yakalamak için ucuz bir güvenlik ağı.

const AdvancedTablePayloadSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  columns: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.string().optional(),
        unit: z.string().optional(),
      }),
    )
    .min(1),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
});

// ─── Tool ─────────────────────────────────────────────────────────────────
// Factory pattern: ileride DB bağlantısı, kullanıcı context'i vs. enjekte
// edebilmek için. Şimdilik bağımsız.

export function createTableGeneratorTool() {
  return tool(
    async (rawInput): Promise<string> => {
      const input = TableGeneratorInputSchema.parse(rawInput);
      const payload = fetchMockTable(input);

      // Sözleşme doğrulaması — bozulursa exception → tool error → LLM tekrar dener.
      AdvancedTablePayloadSchema.parse(payload);

      return wrapAsAdvancedTableBlock(payload);
    },
    {
      name: 'generate_advanced_table',
      description: [
        'Kullanıcı tablo, liste veya yapısal veri istediğinde çağır. Örn:',
        '"mali işler raporunu çıkar", "son satışları göster", "aktif çalışanları listele".',
        'Tool, advanced-table kod bloğu içinde JSON döner — bu bloğu nihai',
        'cevabına AYNEN, hiçbir değişiklik yapmadan ekle. Etrafına kısa bir',
        'açıklama yazabilirsin ama bloğun içeriğine dokunma.',
      ].join(' '),
      schema: TableGeneratorInputSchema,
    },
  );
}

// Singleton convenience export — agent.service tarafında doğrudan kullanılabilir.
export const tableGeneratorTool = createTableGeneratorTool();
