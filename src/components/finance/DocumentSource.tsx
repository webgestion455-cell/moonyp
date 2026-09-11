/**
 * Justificatifs (domicile, relevé bancaire, revenus) — deux voies possibles :
 *
 *   1. import depuis les fichiers de l'appareil (PDF, JPEG, PNG…) ;
 *   2. scan avec la caméra, via le même moteur d'analyse d'image que la pièce
 *      d'identité (profil « papier », seuils adaptés à une feuille A4).
 *
 * Aucun des deux chemins n'est simulé : l'import contrôle réellement le type
 * MIME, la taille et — pour une image — la qualité mesurée du document, et le
 * scan produit une preuve de capture exploitable côté serveur.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentScanner } from "@/components/finance/DocumentScanner";
import { PAPER_THRESHOLDS, analyseFrame, evidenceFromVerdict, type CaptureEvidence } from "@/lib/kyc/image-analysis";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  hint: string;
  /** Types MIME réellement acceptés pour ce type de pièce. */
  accept: string[];
  maxSizeMb: number;
  onCapture: (file: File, evidence: CaptureEvidence) => void;
  onCancel?: () => void;
}

/** Mesure réelle d'un fichier image importé (aucune mesure pour un PDF). */
async function measureImport(file: File): Promise<CaptureEvidence> {
  const base: CaptureEvidence = {
    method: "upload",
    device: { width: 0, height: 0, facing: "file" },
  };
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return base;

  try {
    const bitmap = await createImageBitmap(file);
    const width = 320;
    const height = Math.max(2, Math.round((bitmap.height / (bitmap.width || 1)) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return base;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const verdict = analyseFrame(ctx.getImageData(0, 0, width, height), {
      thresholds: PAPER_THRESHOLDS,
      guide: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 },
    });
    bitmap.close?.();
    return evidenceFromVerdict(verdict, {
      method: "upload",
      auto: false,
      analysed_frames: 1,
      device: { width: bitmap.width, height: bitmap.height, facing: "file" },
    });
  } catch {
    return base;
  }
}

export function DocumentSource({ title, hint, accept, maxSizeMb, onCapture, onCancel }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"choice" | "scan">("choice");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const acceptAttr = accept.length > 0 ? accept.join(",") : "image/*,application/pdf";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (accept.length > 0 && !accept.includes(file.type)) {
      setError(t("kyc.source.badFormat"));
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(t("kyc.source.tooLarge", { size: maxSizeMb }));
      return;
    }
    setBusy(true);
    try {
      onCapture(file, await measureImport(file));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (mode === "scan") {
    return (
      <DocumentScanner
        shape="a4"
        profile="paper"
        title={title}
        hint={t("kyc.source.scanHint")}
        onCapture={onCapture}
        onCancel={() => setMode("choice")}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("common.close")}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="space-y-3 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("kyc.source.chooseMethod")}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-all",
              "hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              busy && "pointer-events-none opacity-60",
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileUp className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold">{t("kyc.source.import")}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{t("kyc.source.importDesc")}</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("scan")}
            className={cn(
              "flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-all",
              "hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              busy && "pointer-events-none opacity-60",
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScanLine className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold">{t("kyc.source.scan")}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{t("kyc.source.scanDesc")}</span>
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          className="sr-only"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("kyc.source.formats", { size: maxSizeMb })}
        </p>

        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="w-full sm:w-auto">
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
