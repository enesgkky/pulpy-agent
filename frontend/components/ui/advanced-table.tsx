"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Grid,
  useClientDataSource,
  computeField,
} from "@1771technologies/lytenyte-core";
import { LyteNyte } from "@/components/lytenyte-core";
import { formatCell } from "@/lib/export-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { TableExportDialog } from "@/components/ui/table-export-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Kbd } from "@/components/ui/kbd";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  ArrowUpDown,
  Filter,
  X,
  Search,
  MoreVertical,
  Sigma,
  Percent,
  PinIcon,
  ArrowLeft,
  ArrowRight,
  Columns3,
  EyeOff,
  CalendarDays,
  Copy,
  Check,
  Download,
  Info,
  ZoomIn,
  FilterX,
  RotateCcw,
  Maximize2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────

function turkishLower(s: string): string {
  return s.toLocaleLowerCase("tr-TR");
}

/** Measure text pixel width using an offscreen canvas (cached context). */
let _measureCtx: CanvasRenderingContext2D | null = null;
function measureTextWidth(text: string, font = "500 12px Inter, system-ui, sans-serif"): number {
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
  }
  if (!_measureCtx) return text.length * 9; // fallback
  _measureCtx.font = font;
  return Math.ceil(_measureCtx.measureText(text).width);
}

const TR_MONTHS: Record<string, number> = {
  oca: 0, sub: 1, mar: 2, nis: 3, may: 4, haz: 5,
  tem: 6, ağu: 7, eyl: 8, eki: 9, kas: 10, ara: 11,
};

function parseTurkishDate(s: string): number | null {
  // "7 Ara 2025", "31 Ara 2025", "07.12.2025", "2025-12-07" etc.
  const trimmed = s.trim();

  // ISO format: 2025-12-07
  const iso = Date.parse(trimmed);
  if (!isNaN(iso)) return iso;

  // "7 Ara 2025" or "07 Aralık 2025"
  const m = trimmed.match(/^(\d{1,2})\s+([a-zA-ZçğıöşüÇĞİÖŞÜ]+)\s+(\d{4})$/);
  if (m) {
    const day = parseInt(m[1]);
    const monthStr = turkishLower(m[2]).slice(0, 3);
    const year = parseInt(m[3]);
    const month = TR_MONTHS[monthStr];
    if (month !== undefined) return new Date(year, month, day).getTime();
  }

  // "07.12.2025" (dd.mm.yyyy)
  const dot = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return new Date(parseInt(dot[3]), parseInt(dot[2]) - 1, parseInt(dot[1])).getTime();

  return null;
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = turkishLower(text);
  const q = turkishLower(query);
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <mark className="bg-yellow-200 text-inherit rounded-sm px-px">{match}</mark>
      {highlightText(after, query)}
    </>
  );
}

// ─── Types ──────────────────────────────────────────────

export interface AdvancedTableColumn {
  key: string;
  label: string;
  type?: string;
  unit?: string;
}

export interface AdvancedTableProps {
  title?: string;
  description?: string;
  columns: AdvancedTableColumn[];
  rows: Record<string, string | number>[];
}

const METRIC_KEY = "__metric__";
type RowData = Record<string, string | number>;

interface TableSpec {
  data: RowData;
  column: { sort?: "asc" | "desc" | null; sortIndex?: number };
}

type AggMode = "sum" | "avg";
type ColumnAlign = "left" | "center" | "right";
type SetFilterModel = Record<string, Set<string>>;
type RangeFilter = [number, number];
type RangeFilterModel = Record<string, RangeFilter>;

type ComparisonOp = ">" | "<" | "=" | ">=" | "<=";
interface ComparisonFilter { operator: ComparisonOp; value: number; }
type ComparisonFilterModel = Record<string, ComparisonFilter[]>;

interface DateRangeFilter { from: number; to: number; } // epoch ms
type DateRangeFilterModel = Record<string, DateRangeFilter>;

type HideNegativesModel = Record<string, boolean>;

interface ActiveFilterBadge {
  id: string;
  label: string;
  detail: string;
  onRemove: () => void;
}

type TextMatchOp = "contains" | "startsWith";
interface TextExpressionFilter { operator: TextMatchOp; value: string; }
type TextExpressionFilterModel = Record<string, TextExpressionFilter[]>;

// ─── Filter Content Components ──────────────────────────

function StringFilterContent({
  uniqueValues,
  activeFilter,
  activeExpressions,
  onApply,
  onClear,
}: {
  uniqueValues: string[];
  activeFilter: Set<string> | undefined;
  activeExpressions?: TextExpressionFilter[];
  onApply: (selected: Set<string>, expressions: TextExpressionFilter[] | null) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => activeFilter ?? new Set(uniqueValues)
  );
  const [expressions, setExpressions] = useState<{ operator: TextMatchOp; value: string }[]>(
    () => activeExpressions?.length
      ? activeExpressions.map((e) => ({ ...e }))
      : []
  );

  const filtered = useMemo(
    () =>
      search
        ? uniqueValues.filter((v) =>
            v.toLowerCase().includes(search.toLowerCase())
          )
        : uniqueValues,
    [uniqueValues, search]
  );

  const allSelected =
    filtered.length > 0 && filtered.every((v) => selected.has(v));

  const handleToggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filtered.forEach((v) => next.delete(v));
      } else {
        filtered.forEach((v) => next.add(v));
      }
      return next;
    });
  };

  const handleToggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const updateExpression = (idx: number, patch: Partial<{ operator: TextMatchOp; value: string }>) => {
    setExpressions((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  return (
    <>
      {/* ── Expression filters ── */}
      <div className="px-3 py-2 space-y-1.5 border-b">
        <p className="text-xs font-medium text-muted-foreground">İfade Filtresi</p>
        {expressions.map((expr, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <Select value={expr.operator} onValueChange={(v) => updateExpression(idx, { operator: v as TextMatchOp })}>
              <SelectTrigger size="sm" className="w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">İçeren</SelectItem>
                <SelectItem value="startsWith">İle başlayan</SelectItem>
              </SelectContent>
            </Select>
            <input
              className="h-8 flex-1 min-w-0 border border-input rounded-md bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Değer"
              value={expr.value}
              onChange={(e) => updateExpression(idx, { value: e.target.value })}
            />
            <button
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent shrink-0"
              onClick={() => setExpressions((prev) => prev.filter((_, i) => i !== idx))}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        ))}
        <button
          className="text-xs text-primary hover:underline"
          onClick={() => setExpressions((prev) => [...prev, { operator: "contains", value: "" }])}
        >
          + Koşul ekle
        </button>
      </div>
      {/* ── Search + checkbox list ── */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        <label className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent">
          <Checkbox checked={allSelected} onCheckedChange={handleToggleAll} />
          <span className="font-medium">(Tümünü Seç)</span>
        </label>
        {filtered.map((value) => (
          <label
            key={value}
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
          >
            <Checkbox
              checked={selected.has(value)}
              onCheckedChange={() => handleToggle(value)}
            />
            <span className="truncate">{value}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Temizle
        </Button>
        <Button size="sm" onClick={() => {
          const valid = expressions.filter((e) => e.value.trim() !== "");
          onApply(selected, valid.length ? valid : null);
        }}>
          Uygula
        </Button>
      </div>
    </>
  );
}

function NumberFilterContent({
  rangeMin,
  rangeMax,
  activeRange,
  activeComparisons,
  activeHideNegatives,
  unit,
  onApply,
  onClear,
}: {
  rangeMin: number;
  rangeMax: number;
  activeRange?: RangeFilter;
  activeComparisons?: ComparisonFilter[];
  activeHideNegatives?: boolean;
  unit?: string;
  onApply: (range: RangeFilter | null, comparisons: ComparisonFilter[] | null, hideNeg: boolean) => void;
  onClear: () => void;
}) {
  const [rangeValue, setRangeValue] = useState<[number, number]>(
    () => activeRange ?? [rangeMin, rangeMax]
  );
  const [comparisons, setComparisons] = useState<{ operator: ComparisonOp; value: string }[]>(
    () => activeComparisons?.length
      ? activeComparisons.map((c) => ({
          operator: c.operator,
          // Raw → display: convert back to percentage for UI
          value: String(unit === "%" ? c.value * 100 : c.value),
        }))
      : [{ operator: ">", value: "" }]
  );
  const [hideNeg, setHideNeg] = useState(activeHideNegatives ?? false);

  const hasRange = rangeMin < rangeMax;
  const rangeStep = hasRange
    ? (rangeMax - rangeMin > 100
        ? Math.pow(10, Math.floor(Math.log10((rangeMax - rangeMin) / 100)))
        : (rangeMax - rangeMin) / 100 || 1)
    : 1;

  const isPercent = unit === "%";
  const fmt = (v: number) => {
    if (isPercent) return `${(v * 100).toFixed(1)}%`;
    return v.toLocaleString("tr-TR");
  };

  const updateComparison = (idx: number, patch: Partial<{ operator: ComparisonOp; value: string }>) => {
    setComparisons((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const handleApply = () => {
    const rangeResult: RangeFilter | null =
      rangeValue[0] <= rangeMin && rangeValue[1] >= rangeMax ? null : rangeValue;
    const valid = comparisons
      .filter((c) => c.value !== "" && !isNaN(Number(c.value)))
      .map((c) => ({
        operator: c.operator,
        // User enters in display units (e.g. 45 for 45%), convert back to raw (0.45)
        value: isPercent ? Number(c.value) / 100 : Number(c.value),
      }));
    onApply(rangeResult, valid.length ? valid : null, hideNeg);
  };

  return (
    <>
      {hasRange && (
        <div className="px-3 py-2 space-y-1.5 border-b">
          <p className="text-xs font-medium text-muted-foreground">Aralık</p>
          <div className="flex items-center justify-between text-xs">
            <span>{fmt(rangeValue[0])}</span>
            <span>{fmt(rangeValue[1])}</span>
          </div>
          <Slider
            min={rangeMin}
            max={rangeMax}
            step={rangeStep}
            value={rangeValue}
            onValueChange={(v) => setRangeValue(v as [number, number])}
          />
        </div>
      )}
      <div className="px-3 py-2 space-y-1.5 border-b">
        <p className="text-xs font-medium text-muted-foreground">Karşılaştırma</p>
        {comparisons.map((comp, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <Select value={comp.operator} onValueChange={(v) => updateComparison(idx, { operator: v as ComparisonOp })}>
              <SelectTrigger size="sm" className="w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=">">&gt;</SelectItem>
                <SelectItem value="<">&lt;</SelectItem>
                <SelectItem value="=">=</SelectItem>
                <SelectItem value=">=">&gt;=</SelectItem>
                <SelectItem value="<=">&lt;=</SelectItem>
              </SelectContent>
            </Select>
            <input
              type="number"
              className="h-8 flex-1 min-w-0 border border-input rounded-md bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={isPercent ? "% değer" : "Değer"}
              value={comp.value}
              onChange={(e) => updateComparison(idx, { value: e.target.value })}
            />
            {comparisons.length > 1 && (
              <button
                className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent shrink-0"
                onClick={() => setComparisons((prev) => prev.filter((_, i) => i !== idx))}
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        ))}
        <button
          className="text-xs text-primary hover:underline"
          onClick={() => setComparisons((prev) => [...prev, { operator: ">", value: "" }])}
        >
          + Koşul ekle
        </button>
      </div>
      {rangeMin < 0 && (
        <div className="px-3 py-1.5 border-b">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={hideNeg} onCheckedChange={(v) => setHideNeg(!!v)} />
            <span className="text-xs">Negatifleri Gizle</span>
          </label>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Temizle
        </Button>
        <Button size="sm" onClick={handleApply}>
          Uygula
        </Button>
      </div>
    </>
  );
}

function DateFilterContent({
  dateMin,
  dateMax,
  activeDateRange,
  onApply,
  onClear,
}: {
  dateMin: number;
  dateMax: number;
  activeDateRange?: DateRangeFilter;
  onApply: (range: DateRangeFilter | null) => void;
  onClear: () => void;
}) {
  const [selected, setSelected] = useState<{ from?: Date; to?: Date }>(() => {
    if (activeDateRange) {
      return { from: new Date(activeDateRange.from), to: new Date(activeDateRange.to) };
    }
    return {};
  });

  const handleApply = () => {
    if (selected.from && selected.to) {
      onApply({ from: selected.from.getTime(), to: selected.to.getTime() });
    } else if (selected.from) {
      // Single day selection: from start of day to end of day
      const dayStart = selected.from.getTime();
      const dayEnd = dayStart + 86400000 - 1;
      onApply({ from: dayStart, to: dayEnd });
    } else {
      onApply(null);
    }
  };

  return (
    <>
      <div className="px-2 pt-2 pb-1">
        {selected.from && (
          <div className="flex items-center gap-1.5 px-2 pb-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>
              {format(selected.from, "d MMM yyyy", { locale: tr })}
              {selected.to && selected.to.getTime() !== selected.from.getTime()
                ? ` – ${format(selected.to, "d MMM yyyy", { locale: tr })}`
                : ""}
            </span>
          </div>
        )}
        <Calendar
          mode="range"
          locale={tr}
          selected={selected.from ? { from: selected.from, to: selected.to } : undefined}
          onSelect={(range) => {
            if (range) setSelected({ from: range.from, to: range.to });
            else setSelected({});
          }}
          defaultMonth={activeDateRange ? new Date(activeDateRange.from) : new Date(dateMin)}
          fromDate={new Date(dateMin)}
          toDate={new Date(dateMax)}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Temizle
        </Button>
        <Button size="sm" onClick={handleApply}>
          Uygula
        </Button>
      </div>
    </>
  );
}

// ─── Column Filter Popover (wrapper) ────────────────────

function ColumnFilterPopover({
  columnId,
  columnType,
  uniqueValues,
  setFilter,
  activeSetFilter,
  activeTextExpressions,
  setTextExpressions,
  rangeMin,
  rangeMax,
  activeRange,
  setRange,
  unit,
  activeComparisons,
  setComparisons,
  activeHideNegatives,
  setHideNegatives,
  dateMin,
  dateMax,
  activeDateRange,
  setDateRange,
}: {
  columnId: string;
  columnType?: string;
  uniqueValues: string[];
  setFilter: (id: string, values: Set<string> | null) => void;
  activeSetFilter: Set<string> | undefined;
  activeTextExpressions?: TextExpressionFilter[];
  setTextExpressions?: (id: string, filters: TextExpressionFilter[] | null) => void;
  rangeMin?: number;
  rangeMax?: number;
  activeRange?: RangeFilter;
  setRange?: (id: string, range: RangeFilter | null) => void;
  unit?: string;
  activeComparisons?: ComparisonFilter[];
  setComparisons?: (id: string, filters: ComparisonFilter[] | null) => void;
  activeHideNegatives?: boolean;
  setHideNegatives?: (id: string, hide: boolean) => void;
  dateMin?: number;
  dateMax?: number;
  activeDateRange?: DateRangeFilter;
  setDateRange?: (id: string, range: DateRangeFilter | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const isActive =
    columnType === "number"
      ? (activeRange !== undefined || (activeComparisons !== undefined && activeComparisons.length > 0) || !!activeHideNegatives)
      : columnType === "date"
        ? activeDateRange !== undefined
        : (activeSetFilter !== undefined || (activeTextExpressions !== undefined && activeTextExpressions.length > 0));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent shrink-0">
          <Filter
            className={`h-3.5 w-3.5 ${isActive ? "text-primary fill-primary/20" : "text-muted-foreground"}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={columnType === "date" ? "w-auto p-0" : "w-56 p-0"}>
        {columnType === "number" && rangeMin != null && rangeMax != null ? (
          <NumberFilterContent
            rangeMin={rangeMin}
            rangeMax={rangeMax}
            activeRange={activeRange}
            activeComparisons={activeComparisons}
            activeHideNegatives={activeHideNegatives}
            unit={unit}
            onApply={(range, comparisons, hideNeg) => {
              setRange?.(columnId, range);
              setComparisons?.(columnId, comparisons);
              setHideNegatives?.(columnId, hideNeg);
              setOpen(false);
            }}
            onClear={() => {
              setRange?.(columnId, null);
              setComparisons?.(columnId, null);
              setHideNegatives?.(columnId, false);
              setOpen(false);
            }}
          />
        ) : columnType === "date" && dateMin != null && dateMax != null ? (
          <DateFilterContent
            dateMin={dateMin}
            dateMax={dateMax}
            activeDateRange={activeDateRange}
            onApply={(range) => {
              setDateRange?.(columnId, range);
              setOpen(false);
            }}
            onClear={() => {
              setDateRange?.(columnId, null);
              setOpen(false);
            }}
          />
        ) : (
          <StringFilterContent
            uniqueValues={uniqueValues}
            activeFilter={activeSetFilter}
            activeExpressions={activeTextExpressions}
            onApply={(selected, expressions) => {
              if (selected.size === uniqueValues.length) {
                setFilter(columnId, null);
              } else {
                setFilter(columnId, new Set(selected));
              }
              setTextExpressions?.(columnId, expressions);
              setOpen(false);
            }}
            onClear={() => {
              setFilter(columnId, null);
              setTextExpressions?.(columnId, null);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Floating Filter Row Cell ───────────────────────────

function FloatingFilterCell({
  column,
  textFilter,
  onTextFilterChange,
  columnType,
  uniqueValues,
  activeSetFilter,
  onSetFilter,
  activeTextExpressions,
  onTextExpressions,
  rangeMin,
  rangeMax,
  activeRangeFilter,
  onRangeFilter,
  unit,
  activeComparisons,
  onComparisonsFilter,
  activeHideNegatives,
  onHideNegatives,
  dateMin,
  dateMax,
  activeDateRange,
  onDateRangeFilter,
}: Grid.T.HeaderParams<TableSpec> & {
  textFilter: string;
  onTextFilterChange: (id: string, value: string) => void;
  columnType?: string;
  uniqueValues: string[];
  activeSetFilter: Set<string> | undefined;
  onSetFilter: (id: string, values: Set<string> | null) => void;
  activeTextExpressions?: TextExpressionFilter[];
  onTextExpressions?: (id: string, filters: TextExpressionFilter[] | null) => void;
  rangeMin?: number;
  rangeMax?: number;
  activeRangeFilter?: RangeFilter;
  onRangeFilter?: (id: string, range: RangeFilter | null) => void;
  unit?: string;
  activeComparisons?: ComparisonFilter[];
  onComparisonsFilter?: (id: string, filters: ComparisonFilter[] | null) => void;
  activeHideNegatives?: boolean;
  onHideNegatives?: (id: string, hide: boolean) => void;
  dateMin?: number;
  dateMax?: number;
  activeDateRange?: DateRangeFilter;
  onDateRangeFilter?: (id: string, range: DateRangeFilter | null) => void;
}) {
  return (
    <div className="flex items-center h-full w-full py-1">
      <input
        className="h-full flex-1 min-w-0 border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        value={textFilter}
        placeholder="Filtrele..."
        onChange={(e) => onTextFilterChange(column.id, e.target.value)}
      />
      <ColumnFilterPopover
        columnId={column.id}
        columnType={columnType}
        uniqueValues={uniqueValues}
        setFilter={onSetFilter}
        activeSetFilter={activeSetFilter}
        activeTextExpressions={activeTextExpressions}
        setTextExpressions={onTextExpressions}
        rangeMin={rangeMin}
        rangeMax={rangeMax}
        activeRange={activeRangeFilter}
        setRange={onRangeFilter}
        unit={unit}
        activeComparisons={activeComparisons}
        setComparisons={onComparisonsFilter}
        activeHideNegatives={activeHideNegatives}
        setHideNegatives={onHideNegatives}
        dateMin={dateMin}
        dateMax={dateMax}
        activeDateRange={activeDateRange}
        setDateRange={onDateRangeFilter}
      />
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────

// ─── Cell Context Menu ───────────────────────────────────

function CellContextMenu({ x, y, isMac, onCopy }: { x: number; y: number; isMac: boolean; onCopy: () => void }) {
  return createPortal(
    <div
      data-cell-ctx-menu
      className="fixed z-[9999] min-w-40 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="relative flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
      >
        <Copy className="h-4 w-4" />
        Kopyala
        <span className="ml-auto flex items-center gap-1">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>C</Kbd>
        </span>
      </button>
    </div>,
    document.body
  );
}

// ─── Toolbar ─────────────────────────────────────────────

function ToolbarIconButton({
  tooltip,
  children,
  onClick,
}: {
  tooltip: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

type ScaleLevel = "xs" | "sm" | "md" | "lg" | "xl";
const SCALE_OPTIONS: { value: ScaleLevel; label: string; rowH: number; headerH: number; floatingH: number; fontSize: string }[] = [
  { value: "xs", label: "Çok Küçük", rowH: 24, headerH: 28, floatingH: 28, fontSize: "text-[10px]" },
  { value: "sm", label: "Küçük",     rowH: 28, headerH: 32, floatingH: 32, fontSize: "text-[11px]" },
  { value: "md", label: "Normal",    rowH: 32, headerH: 36, floatingH: 36, fontSize: "text-xs" },
  { value: "lg", label: "Büyük",     rowH: 38, headerH: 42, floatingH: 42, fontSize: "text-sm" },
  { value: "xl", label: "Çok Büyük", rowH: 44, headerH: 48, floatingH: 48, fontSize: "text-sm" },
];
const DEFAULT_SCALE: ScaleLevel = "md";

function TableToolbar({
  columns,
  columnVisibility,
  onColumnVisibilityChange,
  quickSearch,
  onQuickSearchChange,
  activeFilters,
  onClearFilters,
  onResetTable,
  onAutosize,
  onCopy,
  onExport,
  onInfo,
  scale,
  onScaleChange,
}: {
  columns: AdvancedTableColumn[];
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (id: string, visible: boolean) => void;
  quickSearch: string;
  onQuickSearchChange: (value: string) => void;
  activeFilters: ActiveFilterBadge[];
  onClearFilters: () => void;
  onResetTable: () => void;
  onAutosize: () => void;
  onCopy: () => Promise<boolean>;
  onExport: () => void;
  onInfo?: () => void;
  scale: ScaleLevel;
  onScaleChange: (scale: ScaleLevel) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30">
        {/* ── Quick search ── */}
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            className="h-8 w-52 rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Hızlı ara..."
            value={quickSearch}
            onChange={(e) => onQuickSearchChange(e.target.value)}
          />
          {quickSearch && (
            <button
              className="absolute right-2 text-muted-foreground hover:text-foreground"
              onClick={() => onQuickSearchChange("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* ── Active filter badges ── */}
        {activeFilters.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto min-w-0">
            {activeFilters.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs whitespace-nowrap shrink-0"
              >
                <span className="font-medium">{f.label}</span>
                <span className="text-primary/60">{f.detail}</span>
                <button
                  className="ml-0.5 rounded-sm hover:bg-primary/20 p-0.5"
                  onClick={f.onRemove}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* ── Column visibility ── */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center justify-center h-8 gap-1.5 rounded-md border border-input bg-background px-2.5 hover:bg-accent hover:text-accent-foreground transition-colors">
              <Columns3 className="h-3.5 w-3.5" />
              <span className="text-xs">Sütunlar</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-0">
            <div className="max-h-64 overflow-y-auto p-1">
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
                >
                  <Checkbox
                    checked={columnVisibility[col.key] !== false}
                    onCheckedChange={(checked) =>
                      onColumnVisibilityChange(col.key, !!checked)
                    }
                  />
                  <span className="truncate text-xs">{col.label}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <ToolbarIconButton tooltip="Filtreleri Temizle" onClick={onClearFilters}>
          <FilterX className="h-3.5 w-3.5" />
        </ToolbarIconButton>

        <ToolbarIconButton tooltip="Tabloyu Sıfırla" onClick={onResetTable}>
          <RotateCcw className="h-3.5 w-3.5" />
        </ToolbarIconButton>

        <ToolbarIconButton tooltip="Otomatik Boyutla" onClick={onAutosize}>
          <Maximize2 className="h-3.5 w-3.5" />
        </ToolbarIconButton>

        <div className="h-5 w-px bg-border" />

        {/* ── Action buttons ── */}
        <ToolbarIconButton
          tooltip={copied ? "Kopyalandı" : "Kopyala"}
          onClick={async () => {
            const ok = await onCopy();
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-green-600" />
            : <Copy className="h-3.5 w-3.5" />
          }
        </ToolbarIconButton>

        <ToolbarIconButton tooltip="Dışa Aktar" onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
        </ToolbarIconButton>

        {onInfo && (
          <ToolbarIconButton tooltip="Bilgi" onClick={onInfo}>
            <Info className="h-3.5 w-3.5" />
          </ToolbarIconButton>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center justify-center h-8 gap-1.5 rounded-md border border-input bg-background px-2.5 hover:bg-accent hover:text-accent-foreground transition-colors">
              <ZoomIn className="h-3.5 w-3.5" />
              <span className="text-xs">{SCALE_OPTIONS.find((o) => o.value === scale)?.label ?? "Normal"}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-36 p-1">
            {SCALE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`flex items-center w-full gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent ${scale === opt.value ? "bg-accent font-medium" : ""}`}
                onClick={() => onScaleChange(opt.value)}
              >
                {scale === opt.value && <Check className="h-3.5 w-3.5 text-primary" />}
                {scale !== opt.value && <span className="w-3.5" />}
                <span className="text-xs">{opt.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}

// ─── Component ──────────────────────────────────────────

export function AdvancedTable({ title, description, columns, rows }: AdvancedTableProps) {
  const apiRef = useRef<Grid.API<TableSpec>>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [setFilterModel, setSetFilterModel] = useState<SetFilterModel>({});
  const [textFilterModel, setTextFilterModel] = useState<
    Record<string, string>
  >({});
  const [rangeFilterModel, setRangeFilterModel] = useState<RangeFilterModel>({});
  const [comparisonFilterModel, setComparisonFilterModel] = useState<ComparisonFilterModel>({});
  const [dateRangeFilterModel, setDateRangeFilterModel] = useState<DateRangeFilterModel>({});
  const [hideNegativesModel, setHideNegativesModel] = useState<HideNegativesModel>({});
  const [textExpressionFilterModel, setTextExpressionFilterModel] = useState<TextExpressionFilterModel>({});
  const [quickSearch, setQuickSearch] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [scale, setScale] = useState<ScaleLevel>(DEFAULT_SCALE);
  const scaleConfig = SCALE_OPTIONS.find((o) => o.value === scale) ?? SCALE_OPTIONS[2];

  // ── Min/Max per numeric column ────────────────────

  const numericRangeMap = useMemo(() => {
    const map: Record<string, { min: number; max: number }> = {};
    for (const col of columns) {
      if (col.type !== "number") continue;
      let min = Infinity;
      let max = -Infinity;
      for (const row of rows) {
        const val = row[col.key];
        const num = typeof val === "string" ? parseFloat(val) : Number(val);
        if (!isNaN(num)) {
          if (num < min) min = num;
          if (num > max) max = num;
        }
      }
      if (min !== Infinity) map[col.key] = { min, max };
    }
    return map;
  }, [columns, rows]);

  // ── Min/Max per date column ─────────────────────

  const dateRangeMap = useMemo(() => {
    const map: Record<string, { min: number; max: number }> = {};
    for (const col of columns) {
      if (col.type !== "date") continue;
      let min = Infinity;
      let max = -Infinity;
      for (const row of rows) {
        const val = row[col.key];
        if (val == null) continue;
        const ts = parseTurkishDate(String(val));
        if (ts !== null) {
          if (ts < min) min = ts;
          if (ts > max) max = ts;
        }
      }
      if (min !== Infinity) map[col.key] = { min, max };
    }
    return map;
  }, [columns, rows]);

  // ── Aggregate mode per column (% → avg, others → sum) ──

  const [aggregateMode, setAggregateMode] = useState<Record<string, AggMode>>(
    () => {
      const modes: Record<string, AggMode> = {};
      for (const col of columns) {
        if (col.type === "number") {
          modes[col.key] = col.unit === "%" ? "avg" : "sum";
        }
      }
      return modes;
    }
  );

  // ── Column alignment ────────────────────────────────

  const [columnAlignModel, setColumnAlignModel] = useState<Record<string, ColumnAlign>>(
    () => {
      const aligns: Record<string, ColumnAlign> = {};
      for (const col of columns) {
        if (col.type === "number") aligns[col.key] = "right";
      }
      return aligns;
    }
  );

  // ── Unique values per column ────────────────────────

  const uniqueValuesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      const seen = new Set<string>();
      for (const row of rows) {
        const val = row[col.key];
        if (val != null) seen.add(String(val));
      }
      map[col.key] = Array.from(seen).sort();
    }
    return map;
  }, [columns, rows]);

  // ── Refs for renderers ──────────────────────────────

  const quickSearchRef = useRef(quickSearch);
  quickSearchRef.current = quickSearch;

  const setFilterModelRef = useRef(setFilterModel);
  setFilterModelRef.current = setFilterModel;

  const textFilterModelRef = useRef(textFilterModel);
  textFilterModelRef.current = textFilterModel;

  const uniqueValuesMapRef = useRef(uniqueValuesMap);
  uniqueValuesMapRef.current = uniqueValuesMap;

  const numericRangeMapRef = useRef(numericRangeMap);
  numericRangeMapRef.current = numericRangeMap;

  const rangeFilterModelRef = useRef(rangeFilterModel);
  rangeFilterModelRef.current = rangeFilterModel;

  const comparisonFilterModelRef = useRef(comparisonFilterModel);
  comparisonFilterModelRef.current = comparisonFilterModel;

  const dateRangeFilterModelRef = useRef(dateRangeFilterModel);
  dateRangeFilterModelRef.current = dateRangeFilterModel;

  const hideNegativesModelRef = useRef(hideNegativesModel);
  hideNegativesModelRef.current = hideNegativesModel;

  const dateRangeMapRef = useRef(dateRangeMap);
  dateRangeMapRef.current = dateRangeMap;

  const handleRangeFilter = useCallback(
    (id: string, range: RangeFilter | null) => {
      setRangeFilterModel((prev) => {
        const next = { ...prev };
        if (range === null) delete next[id];
        else next[id] = range;
        return next;
      });
    },
    []
  );
  const handleRangeFilterRef = useRef(handleRangeFilter);
  handleRangeFilterRef.current = handleRangeFilter;

  const handleComparisonFilter = useCallback(
    (id: string, filters: ComparisonFilter[] | null) => {
      setComparisonFilterModel((prev) => {
        const next = { ...prev };
        if (filters === null || filters.length === 0) delete next[id];
        else next[id] = filters;
        return next;
      });
    },
    []
  );
  const handleComparisonFilterRef = useRef(handleComparisonFilter);
  handleComparisonFilterRef.current = handleComparisonFilter;

  const handleDateRangeFilter = useCallback(
    (id: string, range: DateRangeFilter | null) => {
      setDateRangeFilterModel((prev) => {
        const next = { ...prev };
        if (range === null) delete next[id];
        else next[id] = range;
        return next;
      });
    },
    []
  );
  const handleDateRangeFilterRef = useRef(handleDateRangeFilter);
  handleDateRangeFilterRef.current = handleDateRangeFilter;

  const handleHideNegatives = useCallback(
    (id: string, hide: boolean) => {
      setHideNegativesModel((prev) => {
        const next = { ...prev };
        if (!hide) delete next[id];
        else next[id] = true;
        return next;
      });
    },
    []
  );
  const handleHideNegativesRef = useRef(handleHideNegatives);
  handleHideNegativesRef.current = handleHideNegatives;

  const textExpressionFilterModelRef = useRef(textExpressionFilterModel);
  textExpressionFilterModelRef.current = textExpressionFilterModel;

  const handleTextExpressionFilter = useCallback(
    (id: string, filters: TextExpressionFilter[] | null) => {
      setTextExpressionFilterModel((prev) => {
        const next = { ...prev };
        if (filters === null || filters.length === 0) delete next[id];
        else next[id] = filters;
        return next;
      });
    },
    []
  );
  const handleTextExpressionFilterRef = useRef(handleTextExpressionFilter);
  handleTextExpressionFilterRef.current = handleTextExpressionFilter;

  const handleColumnVisibility = useCallback(
    (id: string, visible: boolean) => {
      setColumnVisibility((prev) => ({ ...prev, [id]: visible }));
      apiRef.current?.columnUpdate({ [id]: { hide: !visible } });
    },
    []
  );
  const handleColumnVisibilityRef = useRef(handleColumnVisibility);
  handleColumnVisibilityRef.current = handleColumnVisibility;

  const gridColumnsRef = useRef<Grid.Column<TableSpec>[]>([]);
  const columnsMetaRef = useRef(columns);

  const aggregateModeRef = useRef(aggregateMode);
  aggregateModeRef.current = aggregateMode;

  const handleAggregateMode = useCallback(
    (id: string, mode: AggMode) => {
      setAggregateMode((prev) => ({ ...prev, [id]: mode }));
    },
    []
  );
  const handleAggregateModeRef = useRef(handleAggregateMode);
  handleAggregateModeRef.current = handleAggregateMode;

  const columnAlignRef = useRef(columnAlignModel);
  columnAlignRef.current = columnAlignModel;

  const handleColumnAlign = useCallback(
    (id: string, align: ColumnAlign) => {
      setColumnAlignModel((prev) => ({ ...prev, [id]: align }));
    },
    []
  );
  const handleColumnAlignRef = useRef(handleColumnAlign);
  handleColumnAlignRef.current = handleColumnAlign;

  const handleSetFilter = useCallback(
    (id: string, values: Set<string> | null) => {
      setSetFilterModel((prev) => {
        const next = { ...prev };
        if (values === null) delete next[id];
        else next[id] = values;
        return next;
      });
    },
    []
  );
  const handleSetFilterRef = useRef(handleSetFilter);
  handleSetFilterRef.current = handleSetFilter;

  const handleTextFilter = useCallback((id: string, value: string) => {
    setTextFilterModel((prev) => {
      const next = { ...prev };
      if (value === "") delete next[id];
      else next[id] = value;
      return next;
    });
  }, []);
  const handleTextFilterRef = useRef(handleTextFilter);
  handleTextFilterRef.current = handleTextFilter;

  const handleSort = useCallback(
    (id: string, dir: "asc" | "desc" | null) => {
      setGridColumns((prev) =>
        prev.map((col) => {
          if (col.id === id) {
            const next = { ...col };
            if (dir === null) delete next.sort;
            else next.sort = dir;
            return next;
          }
          if (col.sort) {
            const next = { ...col };
            delete next.sort;
            return next;
          }
          return col;
        })
      );
    },
    []
  );
  const handleSortRef = useRef(handleSort);
  handleSortRef.current = handleSort;

  // Ref to access latest rows data from callbacks
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const autosizeWithHeader = useCallback(
    (colIds?: string[]) => {
      const api = apiRef.current;
      if (!api) return;
      const HEADER_EXTRA = 100; // padding(16) + sort btn(20) + menu btn(20) + safety margin(44)
      const INDEX_EXTRA = 55; // Adjusted to 55 as requested
      const CELL_PADDING = 24; // left + right padding for cell content
      const DATA_FONT = "400 12px Inter, system-ui, sans-serif";
      const sizes: Record<string, number> = {};
      const targets = colIds ?? columnsMetaRef.current.map((c) => c.key);
      const currentRows = rowsRef.current;
      const sampleRows = currentRows.slice(0, 100);
      for (const id of targets) {
        if (id === "__index") continue; // Re-enabling skip as requested: No column shouldn't be affected by auto-resize
        const meta = columnsMetaRef.current.find((c) => c.key === id);
        // Header width
        const headerW = meta ? measureTextWidth(meta.label) + HEADER_EXTRA : 100;
        // Data content width — measure actual text from row data
        let maxDataW = 0;
        for (const row of sampleRows) {
          const val = row[id];
          if (val == null) continue;
          const text = (meta?.type === "number" || meta?.unit)
            ? formatCell(val, meta.type, meta.unit, meta.key, meta.label)
            : String(val);
          const w = measureTextWidth(text, DATA_FONT) + CELL_PADDING;
          if (w > maxDataW) maxDataW = w;
        }
        sizes[id] = Math.max(headerW, maxDataW);
      }
      api.columnResize(sizes);

      // Persist the new widths in React state so they don't reset on re-renders
      setGridColumns((prev) =>
        prev.map((col) => {
          if (sizes[col.id] != null) {
            const next = { ...col };
            next.width = sizes[col.id];
            next.widthMin = Math.max(30, sizes[col.id] - 20);
            return next;
          }
          return col;
        })
      );
    },
    [measureTextWidth]
  );
  const autosizeWithHeaderRef = useRef(autosizeWithHeader);
  autosizeWithHeaderRef.current = autosizeWithHeader;

  const isCompactActive = columns.length > 10;
  const [gridColumns, setGridColumns] = useState<Grid.Column<TableSpec>[]>(
    () =>
      columns.map((col) => {
        const isIndex = col.key === "__index";
        const headerWidthFull = isIndex
          ? 55
          : measureTextWidth(col.label) + 100;
        // Conditional logic: use compact width (125) if >10 columns, otherwise use full header width.
        const width = isIndex ? 55 : (isCompactActive ? 125 : Math.max(125, headerWidthFull));
        const widthMin = isIndex ? 55 : (isCompactActive ? 40 : Math.max(125, headerWidthFull));

        return {
        id: col.key,
        name: col.label,
        field: col.key,
        type: col.type === "number" ? "number" : "string",
        width,
        widthMin,
        resizable: col.key !== "__index",
        movable: col.key !== "__index",
        pin: col.key === "__index" ? "start" : undefined,
        cellRenderer: (props: Grid.T.CellRendererParams<TableSpec>) => {
          const data = props.row.data as RowData;
          const metric = data[METRIC_KEY];
          const qs = quickSearchRef.current;

          const align = columnAlignRef.current[col.key] ?? (col.type === "number" ? "right" : "left");
          const justifyClass = isIndex ? "justify-center" : align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

          if (metric != null) {
            if (col.type === "number") {
              const val = data[col.key];
              const mode = aggregateModeRef.current[col.key] ?? "sum";
              const label = mode === "avg" ? "Ort" : "Top";
              return (
                <div className={`flex items-center w-full h-full ${justifyClass}`}>
                  <span className="font-semibold text-xs" title={mode === "avg" ? "Ortalama" : "Toplam"}>
                    <span className="text-muted-foreground mr-1">{label}:</span>
                    {val != null ? formatCell(val, col.type, col.unit, col.key, col.label) : ""}
                  </span>
                </div>
              );
            }
            return null;
          }

          let content: ReactNode;
          if (col.key === "__index") {
            content = String(props.rowIndex + 1);
          } else if (col.type === "number" || col.unit) {
            const val = data[col.key] ?? "";
            const text = formatCell(val, col.type, col.unit, col.key, col.label);
            content = qs ? highlightText(text, qs) : text;
          } else {
            const text = String(data[col.key] ?? "");
            content = qs ? highlightText(text, qs) : text;
          }

          return (
            <div
              data-cell-select
              className={`flex items-center w-[calc(100%+20px)] h-full -mx-[10px] px-[10px] data-[selected]:bg-primary/15 ${justifyClass} ${isIndex ? "text-center" : ""}`}
            >
              {content}
            </div>
          );
        },
        headerRenderer: (props: Grid.T.HeaderParams<TableSpec>) => {
          if (col.key === "__index") {
            return (
              <div className="flex items-center justify-center w-full h-full px-2 gap-1 text-muted-foreground">
                <span className="truncate text-xs font-medium">
                  {props.column.name}
                </span>
              </div>
            );
          }
          const currentSort = props.column.sort;
          const currentPin = props.column.pin;
          return (
            <div className="flex items-center justify-between w-full h-full px-2 gap-1">
              <span className="truncate text-xs font-medium">
                {props.column.name}
              </span>
              <div className="flex items-center shrink-0">
                <button
                  className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent shrink-0"
                  onClick={() => {
                    const next = currentSort === "asc" ? "desc" : currentSort === "desc" ? null : "asc";
                    handleSortRef.current(col.key, next);
                  }}
                >
                  {currentSort === "asc" ? (
                    <ArrowUpNarrowWide className="h-3.5 w-3.5 text-primary" />
                  ) : currentSort === "desc" ? (
                    <ArrowDownWideNarrow className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent shrink-0">
                      <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[210px]">
                    {/* ── Sort ── */}
                    <DropdownMenuItem onClick={() => handleSortRef.current(col.key, "asc")}>
                      <ArrowUpNarrowWide className="h-4 w-4" />
                      Artan Sırala
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleSortRef.current(col.key, "desc")}>
                      <ArrowDownWideNarrow className="h-4 w-4" />
                      Azalan Sırala
                    </DropdownMenuItem>
                    {currentSort && (
                      <DropdownMenuItem onClick={() => handleSortRef.current(col.key, null)}>
                        <X className="h-4 w-4" />
                        Sıralamayı Kaldır
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {/* ── Pin ── */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <PinIcon className="h-4 w-4" />
                        Sabitle
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => apiRef.current?.columnUpdate({ [col.key]: { pin: "start" } })}>
                          <ArrowLeft className="h-4 w-4" />
                          Sola Sabitle
                          {currentPin === "start" && <span className="ml-auto text-primary">✓</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => apiRef.current?.columnUpdate({ [col.key]: { pin: "end" } })}>
                          <ArrowRight className="h-4 w-4" />
                          Sağa Sabitle
                          {currentPin === "end" && <span className="ml-auto text-primary">✓</span>}
                        </DropdownMenuItem>
                        {currentPin && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => apiRef.current?.columnUpdate({ [col.key]: { pin: null } })}>
                              <X className="h-4 w-4" />
                              Sabitlemeyi Kaldır
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {/* ── Move ── */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <ArrowRight className="h-4 w-4" />
                        Taşı
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => {
                          const idx = gridColumnsRef.current.findIndex((c) => c.id === col.key);
                          if (idx > 0) apiRef.current?.columnMove({ moveColumns: [col.key], moveTarget: gridColumnsRef.current[idx - 1].id, before: true });
                        }}>
                          <ArrowLeft className="h-4 w-4" />
                          Sola Taşı
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          const idx = gridColumnsRef.current.findIndex((c) => c.id === col.key);
                          if (idx < gridColumnsRef.current.length - 1) apiRef.current?.columnMove({ moveColumns: [col.key], moveTarget: gridColumnsRef.current[idx + 1].id, before: false });
                        }}>
                          <ArrowRight className="h-4 w-4" />
                          Sağa Taşı
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    {/* ── Autosize ── */}
                    <DropdownMenuItem onClick={() => autosizeWithHeaderRef.current([col.key])}>
                      <Columns3 className="h-4 w-4" />
                      Otomatik Boyutla
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => autosizeWithHeaderRef.current()}>
                      <Columns3 className="h-4 w-4" />
                      Tüm Kolonları Boyutla
                    </DropdownMenuItem>
                    {/* ── Align ── */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <AlignLeft className="h-4 w-4" />
                        Hizalama
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => handleColumnAlignRef.current(col.key, "left")}>
                          <AlignLeft className="h-4 w-4" />
                          Sol
                          {(columnAlignRef.current[col.key] ?? (col.type === "number" ? "right" : "left")) === "left" && <span className="ml-auto text-primary">✓</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleColumnAlignRef.current(col.key, "center")}>
                          <AlignCenter className="h-4 w-4" />
                          Orta
                          {columnAlignRef.current[col.key] === "center" && <span className="ml-auto text-primary">✓</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleColumnAlignRef.current(col.key, "right")}>
                          <AlignRight className="h-4 w-4" />
                          Sağ
                          {(columnAlignRef.current[col.key] ?? (col.type === "number" ? "right" : "left")) === "right" && <span className="ml-auto text-primary">✓</span>}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    {/* ── Hide ── */}
                    <DropdownMenuItem onClick={() => handleColumnVisibilityRef.current(col.key, false)}>
                      <EyeOff className="h-4 w-4" />
                      Kolonu Gizle
                    </DropdownMenuItem>
                    {/* ── Aggregate (numeric only) ── */}
                    {col.type === "number" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Sigma className="h-4 w-4" />
                            Hesaplama
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => handleAggregateModeRef.current(col.key, "sum")}>
                              <Sigma className="h-4 w-4" />
                              Toplam
                              {aggregateModeRef.current[col.key] === "sum" && <span className="ml-auto text-primary">✓</span>}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAggregateModeRef.current(col.key, "avg")}>
                              <Percent className="h-4 w-4" />
                              Ortalama
                              {aggregateModeRef.current[col.key] === "avg" && <span className="ml-auto text-primary">✓</span>}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        },
        floatingCellRenderer: (props: Grid.T.HeaderParams<TableSpec>) => {
          if (col.key === "__index") {
            return <div className="h-full w-full py-1 bg-muted/5 pointer-events-none" />;
          }
          return (
            <FloatingFilterCell
              {...props}
              textFilter={textFilterModelRef.current[props.column.id] ?? ""}
              onTextFilterChange={handleTextFilterRef.current}
              columnType={col.type}
              uniqueValues={
                uniqueValuesMapRef.current[props.column.id] ?? []
              }
              activeSetFilter={
                setFilterModelRef.current[props.column.id]
              }
              onSetFilter={handleSetFilterRef.current}
              activeTextExpressions={textExpressionFilterModelRef.current[col.key]}
              onTextExpressions={handleTextExpressionFilterRef.current}
              rangeMin={numericRangeMapRef.current[col.key]?.min}
              rangeMax={numericRangeMapRef.current[col.key]?.max}
              activeRangeFilter={rangeFilterModelRef.current[col.key]}
              onRangeFilter={handleRangeFilterRef.current}
              unit={col.unit}
              activeComparisons={comparisonFilterModelRef.current[col.key]}
              onComparisonsFilter={handleComparisonFilterRef.current}
              activeHideNegatives={hideNegativesModelRef.current[col.key]}
              onHideNegatives={handleHideNegativesRef.current}
              dateMin={dateRangeMapRef.current[col.key]?.min}
              dateMax={dateRangeMapRef.current[col.key]?.max}
              activeDateRange={dateRangeFilterModelRef.current[col.key]}
              onDateRangeFilter={handleDateRangeFilterRef.current}
            />
          );
        },
      };})
  );

  gridColumnsRef.current = gridColumns;

  // ── Sorting ─────────────────────────────────────────

  const sort = useMemo(() => {
    const sorted = gridColumns
      .filter((c) => c.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    if (!sorted.length) return null;
    return sorted.map((col) => ({
      dim: {
        ...col,
        field: (p: { row: Grid.T.RowNode<RowData> }) => {
          const val = computeField(col.id, p.row);
          if (col.type === "number") {
            const num = typeof val === "string" ? parseFloat(val) : Number(val);
            return isNaN(num) ? 0 : num;
          }
          if (typeof val === "string") {
            const ts = parseTurkishDate(val);
            if (ts !== null) return ts;
            return turkishLower(val);
          }
          return val;
        },
      },
      descending: col.sort === "desc",
    }));
  }, [gridColumns]);

  // ── Filtering ──────────────────────────────────────

  const filter = useMemo(() => {
    const fns: Grid.T.FilterFn<RowData>[] = [];

    // Quick search (across all columns)
    if (quickSearch) {
      const q = turkishLower(quickSearch);
      fns.push((row) => {
        for (const col of columns) {
          const data = row.data[col.key];
          if (data == null) continue;
          // Check raw value
          if (turkishLower(String(data)).includes(q)) return true;
          // Check formatted value for number/unit columns
          if (col.type === "number" || col.unit) {
            if (turkishLower(formatCell(data, col.type, col.unit, col.key, col.label)).includes(q)) return true;
          }
        }
        return false;
      });
    }

    // Text filters
    for (const [key, value] of Object.entries(textFilterModel)) {
      const lower = turkishLower(value);
      const colMeta = columns.find((c) => c.key === key);
      fns.push((row) => {
        const data = row.data[key];
        if (data == null) return false;
        const raw = turkishLower(String(data));
        if (raw.includes(lower)) return true;
        if (colMeta?.type || colMeta?.unit) {
          const formatted = turkishLower(formatCell(data, colMeta.type, colMeta.unit, colMeta.key, colMeta.label));
          if (formatted.includes(lower)) return true;
        }
        return false;
      });
    }

    // Set filters
    for (const [key, allowedSet] of Object.entries(setFilterModel)) {
      fns.push((row) => {
        const data = row.data[key];
        if (data == null) return false;
        return allowedSet.has(String(data));
      });
    }

    // Text expression filters
    for (const [key, filters] of Object.entries(textExpressionFilterModel)) {
      for (const { operator, value } of filters) {
        const lower = turkishLower(value);
        fns.push((row) => {
          const data = row.data[key];
          if (data == null) return false;
          const raw = turkishLower(String(data));
          if (operator === "startsWith") return raw.startsWith(lower);
          return raw.includes(lower);
        });
      }
    }

    // Range filters
    for (const [key, [lo, hi]] of Object.entries(rangeFilterModel)) {
      fns.push((row) => {
        const data = row.data[key];
        if (data == null) return false;
        const num = typeof data === "string" ? parseFloat(data) : Number(data);
        if (isNaN(num)) return false;
        return num >= lo && num <= hi;
      });
    }

    // Comparison filters
    for (const [key, filters] of Object.entries(comparisonFilterModel)) {
      for (const { operator, value } of filters) {
        fns.push((row) => {
          const data = row.data[key];
          if (data == null) return false;
          const num = typeof data === "string" ? parseFloat(data) : Number(data);
          if (isNaN(num)) return false;
          switch (operator) {
            case ">": return num > value;
            case "<": return num < value;
            case "=": return num === value;
            case ">=": return num >= value;
            case "<=": return num <= value;
            default: return true;
          }
        });
      }
    }

    // Hide negatives
    for (const [key, hide] of Object.entries(hideNegativesModel)) {
      if (!hide) continue;
      fns.push((row) => {
        const data = row.data[key];
        if (data == null) return false;
        const num = typeof data === "string" ? parseFloat(data) : Number(data);
        if (isNaN(num)) return false;
        return num >= 0;
      });
    }

    // Date range filters
    for (const [key, { from, to }] of Object.entries(dateRangeFilterModel)) {
      fns.push((row) => {
        const data = row.data[key];
        if (data == null) return false;
        const ts = parseTurkishDate(String(data));
        if (ts === null) return false;
        return ts >= from && ts <= to;
      });
    }

    return fns.length ? fns : null;
  }, [quickSearch, textFilterModel, setFilterModel, textExpressionFilterModel, rangeFilterModel, comparisonFilterModel, hideNegativesModel, dateRangeFilterModel, columns]);

  const filteredRows = useMemo(() => {
    if (!filter) return rows;
    const result = [];
    for (const row of rows) {
      const rowNode = { data: row } as any;
      let pass = true;
      for (const fn of filter) {
        if (!fn(rowNode)) {
          pass = false;
          break;
        }
      }
      if (pass) result.push(row);
    }
    return result;
  }, [rows, filter]);

  const filteredRowCount = filteredRows.length;

  // ── Bottom aggregate row ────────────────────────────

  const bottomData = useMemo(() => {
    const numCols = columns.filter((c) => c.type === "number");
    if (!numCols.length) return undefined;

    const metricRow: RowData = { [METRIC_KEY]: "" };

    for (const col of numCols) {
      let sum = 0;
      let count = 0;
      for (const row of filteredRows) {
        const val = row[col.key];
        const num = typeof val === "string" ? parseFloat(val) : Number(val);
        if (!isNaN(num)) {
          sum += num;
          count++;
        }
      }
      const mode = aggregateMode[col.key] ?? "sum";
      metricRow[col.key] = mode === "avg" ? (count > 0 ? sum / count : 0) : sum;
    }

    return [metricRow];
  }, [columns, filteredRows, aggregateMode]);

  // ── Data Source ─────────────────────────────────────

  const ds = useClientDataSource<RowData>({ data: rows, sort, filter, bottomData });

  // ── Active filter badges ────────────────────────────

  const colLabel = useCallback(
    (key: string) => columns.find((c) => c.key === key)?.label ?? key,
    [columns]
  );

  const activeFilters = useMemo<ActiveFilterBadge[]>(() => {
    const badges: ActiveFilterBadge[] = [];

    // Set filters (checkbox)
    for (const [key, set] of Object.entries(setFilterModel)) {
      badges.push({
        id: `set-${key}`,
        label: colLabel(key),
        detail: set.size === 1 ? `= ${[...set][0]}` : `${set.size} seçili`,
        onRemove: () => setSetFilterModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    // Text expression filters
    for (const [key, filters] of Object.entries(textExpressionFilterModel)) {
      const descs = filters.map((f) =>
        f.operator === "startsWith" ? `"${f.value}" ile başlayan` : `"${f.value}" içeren`
      );
      badges.push({
        id: `expr-${key}`,
        label: colLabel(key),
        detail: descs.join(", "),
        onRemove: () => setTextExpressionFilterModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    // Range filters
    for (const [key, [lo, hi]] of Object.entries(rangeFilterModel)) {
      const colUnit = columns.find((c) => c.key === key)?.unit;
      const fmtBadge = (v: number) => colUnit === "%" ? `${(v * 100).toFixed(1)}%` : v.toLocaleString("tr-TR");
      badges.push({
        id: `range-${key}`,
        label: colLabel(key),
        detail: `${fmtBadge(lo)} – ${fmtBadge(hi)}`,
        onRemove: () => setRangeFilterModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    // Comparison filters
    for (const [key, filters] of Object.entries(comparisonFilterModel)) {
      const colUnit = columns.find((c) => c.key === key)?.unit;
      const descs = filters.map((f) => {
        const display = colUnit === "%" ? `${(f.value * 100).toFixed(1)}%` : f.value.toLocaleString("tr-TR");
        return `${f.operator} ${display}`;
      });
      badges.push({
        id: `comp-${key}`,
        label: colLabel(key),
        detail: descs.join(", "),
        onRemove: () => setComparisonFilterModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    // Hide negatives
    for (const key of Object.keys(hideNegativesModel)) {
      badges.push({
        id: `neg-${key}`,
        label: colLabel(key),
        detail: "negatifler gizli",
        onRemove: () => setHideNegativesModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    // Date range filters
    for (const [key, { from, to }] of Object.entries(dateRangeFilterModel)) {
      const fmt = (ts: number) => format(new Date(ts), "d MMM yyyy", { locale: tr });
      badges.push({
        id: `date-${key}`,
        label: colLabel(key),
        detail: `${fmt(from)} – ${fmt(to)}`,
        onRemove: () => setDateRangeFilterModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    // Per-column text filters (floating row input)
    for (const [key, value] of Object.entries(textFilterModel)) {
      badges.push({
        id: `text-${key}`,
        label: colLabel(key),
        detail: `"${value}"`,
        onRemove: () => setTextFilterModel((p) => { const n = { ...p }; delete n[key]; return n; }),
      });
    }

    return badges;
  }, [setFilterModel, textExpressionFilterModel, rangeFilterModel, comparisonFilterModel, hideNegativesModel, dateRangeFilterModel, textFilterModel, colLabel]);

  // ── Toolbar actions ────────────────────────────────

  const handleClearFilters = useCallback(() => {
    setTextFilterModel({});
    setSetFilterModel({});
    setTextExpressionFilterModel({});
    setRangeFilterModel({});
    setComparisonFilterModel({});
    setHideNegativesModel({});
    setDateRangeFilterModel({});
    setQuickSearch("");
  }, []);

  const handleResetTable = useCallback(() => {
    handleClearFilters();
    setColumnVisibility({});
    setScale(DEFAULT_SCALE);
    // Reset column widths back to compact (header-only) sizes
    const compactSizes: Record<string, number> = {};
    const isCompactActiveReset = columnsMetaRef.current.length > 10;
    for (const meta of columnsMetaRef.current) {
      const isIdx = meta.key === "__index";
      const headerW = measureTextWidth(meta.label) + (isIdx ? 55 : 100);
      compactSizes[meta.key] = isIdx ? 55 : (isCompactActiveReset ? 125 : Math.max(125, headerW));
    }
    apiRef.current?.columnResize(compactSizes);
    setGridColumns((prev) => {
      const originalOrder = columns.map((c) => c.key);
      const reordered = [...prev].sort((a, b) => originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id));
      return reordered.map((col) => {
        const next = { ...col };
        delete next.sort;
        if (col.id === "__index") {
          next.pin = "start";
        } else {
          delete next.pin;
        }
        next.hide = false;
        // Reset width to compact
        const isCompactActiveReset = columnsMetaRef.current.length > 10;
        const isIdx = col.id === "__index";
        const meta = columnsMetaRef.current.find((c) => c.key === col.id);
        const headerW = meta ? measureTextWidth(meta.label) + (isIdx ? 55 : 100) : 100;
        if (isIdx) {
          next.width = 55;
          next.widthMin = 55;
        } else {
          next.width = isCompactActiveReset ? 125 : Math.max(125, headerW);
          next.widthMin = isCompactActiveReset ? 40 : Math.max(125, headerW);
        }
        return next;
      });
    });
  }, [handleClearFilters, columns, measureTextWidth]);

  const handleAutosize = useCallback(() => {
    autosizeWithHeader();
  }, [autosizeWithHeader]);

  const handleCopy = useCallback(async (): Promise<boolean> => {
    try {
      const api = apiRef.current;
      if (!api) return false;
      const visibleCols = columns.filter((c) => columnVisibility[c.key] !== false);
      const header = visibleCols.map((c) => c.label).join("\t");
      const lines = rows.map((row) =>
        visibleCols.map((c) => {
          const val = row[c.key];
          if (val == null) return "";
          if (c.type === "number" || c.unit) return formatCell(val, c.type, c.unit, c.key, c.label);
          return String(val);
        }).join("\t")
      );
      await navigator.clipboard.writeText([header, ...lines].join("\n"));
      return true;
    } catch {
      return false;
    }
  }, [columns, rows, columnVisibility]);

  // ── Cell selection (drag-to-select) ────────────────

  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxCopyDataRef = useRef<string>("");
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

  const clearCellSelection = useCallback(() => {
    gridWrapperRef.current
      ?.querySelectorAll<HTMLElement>("[data-cell-select][data-selected]")
      .forEach((el) => el.removeAttribute("data-selected"));
  }, []);

  /** Only pick up cells whose centre sits inside the wrapper's visible rect */
  const getVisibleCells = useCallback(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return [];
    const wr = wrapper.getBoundingClientRect();
    return Array.from(
      wrapper.querySelectorAll<HTMLElement>("[data-cell-select]")
    ).filter((el) => {
      const cr = el.getBoundingClientRect();
      const cy = (cr.top + cr.bottom) / 2;
      return cy >= wr.top && cy <= wr.bottom;
    });
  }, []);

  const updateCellSelection = useCallback(
    (sx: number, sy: number, ex: number, ey: number) => {
      const wrapper = gridWrapperRef.current;
      if (!wrapper) return;
      const wr = wrapper.getBoundingClientRect();
      // Clip drag rect to visible grid bounds
      const r = {
        left: Math.max(Math.min(sx, ex), wr.left),
        top: Math.max(Math.min(sy, ey), wr.top),
        right: Math.min(Math.max(sx, ex), wr.right),
        bottom: Math.min(Math.max(sy, ey), wr.bottom),
      };
      getVisibleCells().forEach((el) => {
        const cr = el.getBoundingClientRect();
        const hit = !(
          cr.right < r.left ||
          cr.left > r.right ||
          cr.bottom < r.top ||
          cr.top > r.bottom
        );
        if (hit) el.setAttribute("data-selected", "");
        else el.removeAttribute("data-selected");
      });
    },
    [getVisibleCells]
  );

  /** Build TSV string from currently selected cells in the DOM */
  const buildSelectedTsv = useCallback(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return "";
    const wr = wrapper.getBoundingClientRect();
    const els = Array.from(
      wrapper.querySelectorAll<HTMLElement>("[data-cell-select][data-selected]")
    ).filter((el) => {
      const cr = el.getBoundingClientRect();
      const cy = (cr.top + cr.bottom) / 2;
      return cy >= wr.top && cy <= wr.bottom;
    });
    if (!els.length) return "";

    const ROW_TOL = 4;
    const groups: { y: number; cells: { x: number; text: string }[] }[] = [];
    for (const el of els) {
      const cr = el.getBoundingClientRect();
      let group = groups.find((g) => Math.abs(g.y - cr.top) <= ROW_TOL);
      if (!group) {
        group = { y: cr.top, cells: [] };
        groups.push(group);
      }
      group.cells.push({ x: cr.left, text: (el.textContent ?? "").trim() });
    }

    return groups
      .sort((a, b) => a.y - b.y)
      .map((g) =>
        g.cells.sort((a, b) => a.x - b.x).map((c) => c.text).join("\t")
      )
      .join("\n");
  }, []);

  const copySelectedCells = useCallback(() => {
    const tsv = buildSelectedTsv();
    if (!tsv) return false;
    navigator.clipboard.writeText(tsv);
    return true;
  }, [buildSelectedTsv]);

  useEffect(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, button, select, [role=combobox], [data-radix-popper-content-wrapper]")) return;

      // Always clear previous selection first
      clearCellSelection();

      const cell = target.closest("[data-cell-select]") as HTMLElement | null;
      if (cell) {
        e.preventDefault();
        selStartRef.current = { x: e.clientX, y: e.clientY };
        isSelectingRef.current = true;
        cell.setAttribute("data-selected", "");
        document.body.style.userSelect = "none";
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isSelectingRef.current || !selStartRef.current) return;
      updateCellSelection(
        selStartRef.current.x,
        selStartRef.current.y,
        e.clientX,
        e.clientY
      );
    };

    const onMouseUp = () => {
      selStartRef.current = null;
      if (isSelectingRef.current) {
        isSelectingRef.current = false;
        document.body.style.userSelect = "";
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (wrapper.querySelector("[data-cell-select][data-selected]")) {
          e.preventDefault();
          copySelectedCells();
        }
      }
      if (e.key === "Escape") {
        clearCellSelection();
        setCtxMenu(null);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only open menu when right-clicking on a selected cell
      if (!target.closest("[data-cell-select][data-selected]")) return;
      const tsv = buildSelectedTsv();
      if (tsv) {
        e.preventDefault();
        ctxCopyDataRef.current = tsv;
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }
    };

    // Clear selection when clicking anywhere outside the grid wrapper & context menu
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't clear if clicking inside the context menu
      if (target.closest("[data-cell-ctx-menu]")) return;
      if (!wrapper.contains(target)) {
        clearCellSelection();
      }
      setCtxMenu(null);
    };

    wrapper.addEventListener("mousedown", onMouseDown);
    wrapper.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      wrapper.removeEventListener("mousedown", onMouseDown);
      wrapper.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearCellSelection, updateCellSelection, copySelectedCells, buildSelectedTsv]);

  return (
    <div className="flex flex-col h-full">
      <TableToolbar
        columns={columns}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={handleColumnVisibility}
        quickSearch={quickSearch}
        onQuickSearchChange={setQuickSearch}
        activeFilters={activeFilters}
        onClearFilters={handleClearFilters}
        onResetTable={handleResetTable}
        onAutosize={handleAutosize}
        onCopy={handleCopy}
        onExport={() => setExportOpen(true)}
        onInfo={description ? () => setInfoOpen(true) : undefined}
        scale={scale}
        onScaleChange={setScale}
      />
      <div ref={gridWrapperRef} className={`flex-1 min-h-0 ${scaleConfig.fontSize}`}>
        <LyteNyte<TableSpec>
          ref={apiRef}
          columns={gridColumns}
          onColumnsChange={(newCols) => {
            const noColIdx = newCols.findIndex((c) => c.id === "__index");
            if (noColIdx > 0) {
              const noCol = newCols[noColIdx];
              const rest = newCols.filter((c) => c.id !== "__index");
              setGridColumns([noCol, ...rest]);
            } else {
              setGridColumns(newCols);
            }
          }}
          rowSource={ds}
          rowHeight={scaleConfig.rowH}
          headerHeight={scaleConfig.headerH}
          floatingRowEnabled
          floatingRowHeight={scaleConfig.floatingH}
          rowSelectionMode="none"
          columnBase={{ resizable: true }}
        />
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/30 shrink-0">
        <div>
          Gösterilen: <span className="font-medium text-foreground">{filteredRowCount.toLocaleString("tr-TR")}</span> / Toplam: <span className="font-medium text-foreground">{rows.length.toLocaleString("tr-TR")}</span>
        </div>
      </div>
      {/* ── Cell selection context menu (portal to body) ── */}
      {ctxMenu && <CellContextMenu x={ctxMenu.x} y={ctxMenu.y} isMac={isMac} onCopy={() => {
        navigator.clipboard.writeText(ctxCopyDataRef.current);
        setCtxMenu(null);
      }} />}
      <TableExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={title ?? "Tablo"}
        columns={columns}
        rows={rows}
      />
      {description && (
        <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{title ?? "Tablo"}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <div className="prose prose-sm dark:prose-invert w-full max-w-full pr-4 break-words prose-p:break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:whitespace-pre-wrap [&_code]:break-all">
                <Markdown>{description}</Markdown>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
