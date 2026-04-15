/*
 * Smoke test for TableGeneratorTool.
 *
 * Çalıştırma:
 *   cd backend && npx ts-node -P tsconfig.json test/table-generator.smoke.ts
 *
 * LLM, NestJS veya HTTP gerektirmez — doğrudan tool.invoke() çağırıp
 * çıktıyı doğrular. Kontrol edilenler:
 *   1. Tool happy-path'te ```advanced-table``` fenced block döner.
 *   2. Fence içindeki JSON AdvancedTableProps sözleşmesine uyar.
 *   3. Kategori bazlı mock veriler üretilir.
 *   4. Bozuk input (Zod) uygun hatayı fırlatır.
 */

/* eslint-disable no-console */
import {
  tableGeneratorTool,
  ADVANCED_TABLE_LANG,
} from '../src/agent/tools/table-generator.tool';

type Row = Record<string, string | number>;
interface Column {
  key: string;
  label: string;
  type?: string;
  unit?: string;
}
interface Payload {
  title?: string;
  description?: string;
  columns: Column[];
  rows: Row[];
}

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function extractJson(blockString: string): Payload {
  const fence = '```' + ADVANCED_TABLE_LANG;
  const start = blockString.indexOf(fence);
  if (start === -1) throw new Error('advanced-table fence missing');
  const afterFence = blockString.slice(start + fence.length);
  const end = afterFence.indexOf('```');
  if (end === -1) throw new Error('closing fence missing');
  const json = afterFence.slice(0, end).trim();
  return JSON.parse(json) as Payload;
}

async function runCase(
  name: string,
  input: Record<string, unknown>,
  assertions: (payload: Payload, raw: string) => void,
) {
  console.log(`\n[${name}]`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await tableGeneratorTool.invoke(input as any)) as string;
    check('returns a string', typeof raw === 'string');
    check(
      'wraps in ```advanced-table fence',
      raw.startsWith('```' + ADVANCED_TABLE_LANG) && raw.trimEnd().endsWith('```'),
    );

    const payload = extractJson(raw);
    check('JSON parses', !!payload);
    check('has columns array', Array.isArray(payload.columns) && payload.columns.length > 0);
    check('has rows array', Array.isArray(payload.rows));
    check(
      'every column has key + label',
      payload.columns.every(
        (c: Column) => typeof c.key === 'string' && typeof c.label === 'string',
      ),
    );
    check(
      'every row only contains string|number values',
      payload.rows.every((r: Row) =>
        Object.values(r).every(
          (v: unknown) => typeof v === 'string' || typeof v === 'number',
        ),
      ),
    );

    assertions(payload, raw);
  } catch (err) {
    failed++;
    console.log(`  FAIL case threw: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('TableGeneratorTool smoke test\n================================');

  await runCase(
    'finance / default limit',
    { query: 'mali işler raporu', category: 'finance' },
    (p) => {
      check('title contains "Mali"', (p.title ?? '').includes('Mali'));
      check(
        'has kategori column',
        p.columns.some((c: Column) => c.key === 'kategori'),
      );
      check('has tutar column with ₺ unit', p.columns.some((c: Column) => c.key === 'tutar' && c.unit === '₺'));
      check('at least 1 row', p.rows.length >= 1);
    },
  );

  await runCase(
    'sales / limit=2',
    { query: 'son satışlar', category: 'sales', limit: 2 },
    (p) => {
      check('respects limit=2', p.rows.length === 2);
      check(
        'has urun column',
        p.columns.some((c: Column) => c.key === 'urun'),
      );
    },
  );

  await runCase(
    'hr with explicit year',
    { query: 'aktif çalışanlar', category: 'hr', year: 2024 },
    (p) => {
      check(
        'has ad column',
        p.columns.some((c: Column) => c.key === 'ad'),
      );
    },
  );

  await runCase(
    'general (fallback category)',
    { query: 'random stuff' },
    (p) => {
      check('title matches query', p.title === 'random stuff');
    },
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  console.log('\n[invalid-input: query missing]');
  try {
    await tableGeneratorTool.invoke({ category: 'finance' } as any);
    failed++;
    console.log('  FAIL expected Zod error, got success');
  } catch (err) {
    passed++;
    console.log(`  ok   rejected missing query (${(err as Error).message.split('\n')[0]})`);
  }

  console.log('\n[invalid-input: limit out of range]');
  try {
    await tableGeneratorTool.invoke({
      query: 'x',
      category: 'finance',
      limit: 9999,
    } as any);
    failed++;
    console.log('  FAIL expected Zod error, got success');
  } catch (err) {
    passed++;
    console.log(`  ok   rejected limit=9999 (${(err as Error).message.split('\n')[0]})`);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  console.log(`\n--------------------------------\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
