"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { exportTable, type ExportColumn, type ExportFormat } from "@/lib/export-table";

interface TableExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  columns: ExportColumn[];
  rows: Record<string, string | number>[];
}

export function TableExportDialog({
  open,
  onOpenChange,
  title,
  columns,
  rows,
}: TableExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [withFormatting, setWithFormatting] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      await exportTable({ format, title, columns, rows, withFormatting });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Dışa Aktar</DialogTitle>
          <DialogDescription>
            Tabloyu dışa aktarmak için format seçin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="xlsx" id="fmt-xlsx" />
                <Label htmlFor="fmt-xlsx" className="font-normal cursor-pointer">
                  Excel (.xlsx)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="csv" id="fmt-csv" />
                <Label htmlFor="fmt-csv" className="font-normal cursor-pointer">
                  CSV (.csv)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pdf" id="fmt-pdf" />
                <Label htmlFor="fmt-pdf" className="font-normal cursor-pointer">
                  PDF (.pdf)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="formatting"
              checked={withFormatting}
              onCheckedChange={(v) => setWithFormatting(v === true)}
            />
            <Label htmlFor="formatting" className="font-normal cursor-pointer">
              Sayıları formatla (1.234,56)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            İptal
          </Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Dışa Aktar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
