import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Lightbulb,
  Loader2,
  RotateCcw,
  ScanLine,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ID_THRESHOLDS,
  PAPER_THRESHOLDS,
  analyseFrame,
  evidenceFromVerdict,
  rectDelta,
  type CaptureEvidence,
  type DocumentRect,
  type FrameVerdict,
  type SignalIssue,
} from "@/lib/kyc/image-analysis";

export type ScanShape = "card" | "passport" | "a4";

interface Props {
  /** Gabarit de visée : détermine le ratio de la zone utile. */
  shape: ScanShape;
  /** Pièce d'identité : contrôles stricts. Justificatif : contrôles papier. */
  profile?: "identity" | "paper";
  title: string;
  hint: string;
  onCapture: (file: File, evidence: CaptureEvidence) => void;
  onCancel?: () => void;
}

const SHAPE_RATIO: Record<ScanShape, number> = {
  card: 1.586,
  passport: 1.42,
  a4: 1 / 1.414,
};

/** Nombre d'images consécutives conformes avant déclenchement automatique. */
const STABLE_FRAMES_REQUIRED = 6;
/** Écart maximal du rectangle détecté entre deux images pour rester « stable ». */
const MAX_RECT_DRIFT = 0.02;
const ANALYSIS_INTERVAL_MS = 90;

/**
 * Scanner de document réel.
 *
 * La caméra arrière est ouverte en continu, chaque image est analysée
 * (contours, cadrage, stabilité, netteté, luminosité, reflets, tentative de
 * présentation d'écran) et la capture se déclenche seule dès que le document
 * est correctement présenté. Il n'y a aucun import de fichier : la pièce doit
 * être physiquement scannée.
 *
 * L'image finalement transmise est recadrée sur le document détecté, en pleine
 * résolution, accompagnée de ses mesures de qualité (preuve de capture
 * exploitable côté serveur).
 */
export function DocumentScanner({
  shape,
  profile = "identity",
  title,
  hint,
  onCapture,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastAnalysis = useRef(0);
  const lastRect = useRef<DocumentRect | null>(null);
  const stableRef = useRef(0);
  const framesRef = useRef(0);
  const startedAt = useRef(0);
  const capturedRef = useRef(false);

  const [status, setStatus] = useState<"idle" | "starting" | "live" | "captured" | "denied">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<FrameVerdict | null>(null);
  const [stable, setStable] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; evidence: CaptureEvidence } | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({
    available: false,
    on: false,
  });

  const thresholds = profile === "identity" ? ID_THRESHOLDS : PAPER_THRESHOLDS;
  const ratio = SHAPE_RATIO[shape];

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  /* --------------------------- Capture réelle --------------------------- */
  const capture = useCallback(
    (frameVerdict: FrameVerdict, auto: boolean) => {
      const video = videoRef.current;
      if (!video || capturedRef.current) return;
      capturedRef.current = true;

      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const rect = frameVerdict.signals.rect;

      // Recadrage sur le document détecté, avec une marge de sécurité de 3 %.
      const margin = 0.03;
      const sx = rect ? Math.max(0, (rect.x - margin) * vw) : 0;
      const sy = rect ? Math.max(0, (rect.y - margin) * vh) : 0;
      const sw = rect ? Math.min(vw - sx, (rect.width + margin * 2) * vw) : vw;
      const sh = rect ? Math.min(vh - sy, (rect.height + margin * 2) * vh) : vh;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            capturedRef.current = false;
            return;
          }
          const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
          const evidence = evidenceFromVerdict(frameVerdict, {
            method: "scan",
            auto,
            stable_frames: stableRef.current,
            analysed_frames: framesRef.current,
            duration_ms: Math.round(performance.now() - startedAt.current),
            device: { width: vw, height: vh, facing: "environment" },
          });
          setPreview(URL.createObjectURL(blob));
          setPending({ file, evidence });
          setStatus("captured");
          stop();
        },
        "image/jpeg",
        0.94,
      );
    },
    [stop],
  );

  /* ------------------------- Boucle d'analyse --------------------------- */
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const video = videoRef.current;
    if (!video || video.readyState < 2 || capturedRef.current) return;

    const now = performance.now();
    if (now - lastAnalysis.current < ANALYSIS_INTERVAL_MS) return;
    lastAnalysis.current = now;

    if (!workRef.current) workRef.current = document.createElement("canvas");
    const work = workRef.current;
    const width = 320;
    const height = Math.max(2, Math.round((video.videoHeight / (video.videoWidth || 1)) * width));
    work.width = width;
    work.height = height;
    const ctx = work.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    let image: ImageData;
    try {
      image = ctx.getImageData(0, 0, width, height);
    } catch {
      return;
    }

    const guideHeight = Math.min(0.88, (width * 0.88) / ratio / height);
    const guide = { x: 0.06, y: (1 - guideHeight) / 2, width: 0.88, height: guideHeight };
    const result = analyseFrame(image, { thresholds, guide });
    framesRef.current += 1;

    const drift = rectDelta(lastRect.current, result.signals.rect);
    lastRect.current = result.signals.rect;

    if (result.ok && drift < MAX_RECT_DRIFT) stableRef.current += 1;
    else stableRef.current = 0;

    setVerdict(result);
    setStable(stableRef.current);

    if (stableRef.current >= STABLE_FRAMES_REQUIRED) capture(result, true);
  }, [capture, ratio, thresholds]);

  /* --------------------------- Démarrage caméra ------------------------- */
  const start = useCallback(async () => {
    setError(null);
    setStatus("starting");
    capturedRef.current = false;
    stableRef.current = 0;
    framesRef.current = 0;
    lastRect.current = null;
    startedAt.current = performance.now();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("denied");
      setError(t("kyc.scanner.unsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
      };
      setTorch({ available: Boolean(caps.torch), on: false });
      try {
        await track?.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        } as unknown as MediaTrackConstraints);
      } catch {
        /* La mise au point continue n'est pas disponible partout. */
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("live");
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      setStatus("denied");
      setError(t("kyc.scanner.denied"));
    }
  }, [loop, t]);

  useEffect(() => {
    void start();
    // Une seule ouverture de caméra par montage du scanner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorch((prev) => ({ ...prev, on: next }));
    } catch {
      setTorch((prev) => ({ ...prev, available: false }));
    }
  };

  const restart = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPending(null);
    setVerdict(null);
    setStable(0);
    void start();
  };

  const issueKey: SignalIssue | "ready" = verdict ? (verdict.issue ?? "ready") : "no_document";
  const progress = Math.min(1, stable / STABLE_FRAMES_REQUIRED);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <ScanLine className="h-4 w-4 text-primary" aria-hidden />
            {title}
          </h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {torch.available && status === "live" && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={t("kyc.scanner.torch")}
              aria-pressed={torch.on}
              className={cn(
                "rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground",
                torch.on && "bg-primary/10 text-primary",
              )}
            >
              <Lightbulb className="h-4 w-4" aria-hidden />
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={() => {
                stop();
                onCancel();
              }}
              aria-label={t("common.close")}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </span>
      </div>

      <div className="relative bg-black">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-2xl overflow-hidden">
          {status === "captured" && preview ? (
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}

          {/* Zone de visée + rectangle détecté en temps réel */}
          {status === "live" && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 flex items-center justify-center px-[6%]">
                <div
                  style={{ aspectRatio: String(ratio) }}
                  className={cn(
                    "w-full rounded-xl border-2 transition-colors duration-200",
                    verdict?.ok ? "border-success" : "border-white/70",
                  )}
                />
              </div>
              {verdict?.signals.rect && (
                <div
                  className={cn(
                    "absolute rounded-md border-2 transition-all duration-100",
                    verdict.ok ? "border-success bg-success/10" : "border-warning/80",
                  )}
                  style={{
                    left: `${verdict.signals.rect.x * 100}%`,
                    top: `${verdict.signals.rect.y * 100}%`,
                    width: `${verdict.signals.rect.width * 100}%`,
                    height: `${verdict.signals.rect.height * 100}%`,
                  }}
                />
              )}
              {progress > 0 && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                  <div
                    className="h-full bg-success transition-[width] duration-100"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {status === "starting" && (
            <div className="absolute inset-0 grid place-items-center bg-black/70">
              <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
            </div>
          )}

          {status === "denied" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
              <AlertTriangle className="h-7 w-7 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-white/85">{error}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => void start()}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("kyc.scanner.retry")}
              </Button>
            </div>
          )}

          {/* Consigne temps réel */}
          {status === "live" && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
              <span
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur",
                  verdict?.ok ? "bg-success/90 text-white" : "bg-black/65 text-white",
                )}
              >
                {t(`kyc.scanner.guidance.${issueKey}`)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {status === "captured" && pending && (
          <>
            <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("kyc.scanner.captured", { score: pending.evidence.score ?? 0 })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={restart} className="min-w-[130px]">
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("kyc.scanner.rescan")}
              </Button>
              <Button
                type="button"
                className="min-w-[150px] flex-1"
                onClick={() => onCapture(pending.file, pending.evidence)}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t("kyc.scanner.validate")}
              </Button>
            </div>
          </>
        )}

        {status === "live" && (
          <>
            <ul className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
              <Check ok={Boolean(verdict?.signals.rect)} label={t("kyc.scanner.check.frame")} />
              <Check
                ok={Boolean(verdict && verdict.signals.sharpness >= thresholds.minSharpness)}
                label={t("kyc.scanner.check.sharpness")}
              />
              <Check
                ok={Boolean(
                  verdict &&
                  verdict.signals.brightness >= thresholds.minBrightness &&
                  verdict.signals.brightness <= thresholds.maxBrightness &&
                  verdict.signals.glare <= thresholds.maxGlare,
                )}
                label={t("kyc.scanner.check.light")}
              />
              <Check ok={stable > 0} label={t("kyc.scanner.check.stability")} />
            </ul>
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("kyc.scanner.autoNotice")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5",
        ok ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          ok ? "bg-success" : "bg-muted-foreground/50",
        )}
      />
      <span className="truncate">{label}</span>
    </li>
  );
}
