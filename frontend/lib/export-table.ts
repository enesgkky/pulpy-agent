// ─── Types ──────────────────────────────────────────────

export interface ExportColumn {
  key: string;
  label: string;
  type?: string;
  unit?: string;
}

export type ExportFormat = "csv" | "xlsx" | "pdf";

export interface ExportOptions {
  format: ExportFormat;
  title: string;
  columns: ExportColumn[];
  rows: Record<string, string | number>[];
  withFormatting: boolean;
}

// ─── Format Helpers ─────────────────────────────────────

export function formatNumber(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  const [intPart, decPart] = num.toFixed(2).split(".");
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted},${decPart}`;
}

export function formatCell(
  value: string | number,
  type?: string,
  unit?: string,
  key?: string,
  label?: string
): string {
  if (type === "number") {
    let num = typeof value === "string" ? parseFloat(value) : Number(value);
    if (isNaN(num)) return String(value);
    // Backend returns ratios (0.45 = %45), convert to percentage
    if (unit === "%") num = num * 100;

    // Check if this should be displayed as a whole number based on unit, key, or label
    const wholeNumberKeywords = ["adet", "ay", "yıl", "yil", "gün", "gun", "hafta", "miktar", "donem", "dönem"];
    const checkText = (text: string | undefined) =>
      text ? wholeNumberKeywords.some(keyword => text.toLocaleLowerCase("tr-TR").includes(keyword)) : false;

    const isWholeNumber = checkText(unit) || checkText(key) || checkText(label);

    const formatted = isWholeNumber
      ? String(Math.round(num))
      : formatNumber(num);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(value);
}

// ─── CSV Export ─────────────────────────────────────────

function exportAsCsv({ title, columns, rows, withFormatting }: ExportOptions) {
  const header = columns.map((c) => c.label).join("\t");
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const val = row[c.key] ?? "";
          return withFormatting ? formatCell(val, c.type, c.unit, c.key, c.label) : String(val);
        })
        .join("\t")
    )
    .join("\n");

  const csv = `${header}\n${body}`;
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `${title}.csv`);
}

// ─── XLSX Export ────────────────────────────────────────

async function exportAsXlsx({
  title,
  columns,
  rows,
  withFormatting,
}: ExportOptions) {
  const XLSX = await import("xlsx");

  const data = rows.map((row) => {
    const obj: Record<string, string | number> = {};
    for (const col of columns) {
      const val = row[col.key] ?? "";
      obj[col.label] =
        withFormatting ? formatCell(val, col.type, col.unit, col.key, col.label) : val;
    }
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, `${title}.xlsx`);
}

// ─── PDF Export ─────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function addRobotoFont(doc: InstanceType<typeof import("jspdf").jsPDF>) {
  const [regularBuf, boldBuf] = await Promise.all([
    fetch("/fonts/Roboto-Regular.ttf").then((r) => r.arrayBuffer()),
    fetch("/fonts/Roboto-Bold.ttf").then((r) => r.arrayBuffer()),
  ]);

  doc.addFileToVFS("Roboto-Regular.ttf", arrayBufferToBase64(regularBuf));
  doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");

  doc.addFileToVFS("Roboto-Bold.ttf", arrayBufferToBase64(boldBuf));
  doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");

  doc.setFont("Roboto");
}

async function exportAsPdf({
  title,
  columns,
  rows,
  withFormatting,
}: ExportOptions) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const orientation = columns.length >= 6 ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation });

  await addRobotoFont(doc);

  doc.setFontSize(14);
  doc.text(title, 14, 15);

  const head = [columns.map((c) => c.label)];
  const body = rows.map((row) =>
    columns.map((c) => {
      const val = row[c.key] ?? "";
      return withFormatting ? formatCell(val, c.type, c.unit, c.key, c.label) : String(val);
    })
  );

  autoTable(doc, {
    head,
    body,
    startY: 22,
    styles: { fontSize: 8, font: "Roboto" },
    headStyles: { fillColor: [41, 128, 185], fontStyle: "bold" },
  });

  doc.save(`${title}.pdf`);
}

// ─── Dispatcher ─────────────────────────────────────────

export async function exportTable(options: ExportOptions): Promise<void> {
  switch (options.format) {
    case "csv":
      exportAsCsv(options);
      break;
    case "xlsx":
      await exportAsXlsx(options);
      break;
    case "pdf":
      await exportAsPdf(options);
      break;
  }
}

// ─── Util ───────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
