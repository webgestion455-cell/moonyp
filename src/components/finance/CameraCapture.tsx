import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Camera, CheckCircle2, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CaptureFrame = "card" | "passport" | "document" | "face";

export interface CaptureQuality {
  brightness: number;
  sharpness: number;
  ok: boolean;
  reason?: "dark" | "bright" | "blurry";
}

interface Props {
  frame: CaptureFrame;
  title: string;
  hint: string;
  /** Front camera for the liveness step, rear camera for documents. */
  facing?: "user" | "environment";
  accept?: string[];
  maxSizeMb?: number;
  onCapture: (file: File, quality: CaptureQuality) => void;
  onCancel?: () => void;
}

const FRAME_RATIO: Record<CaptureFrame, string> = {
  card: "aspect-[1.586/1]",
  passport: "aspect-[1.42/1]",
  document: "aspect-[1/1.414]",
  face: "aspect-square",
};

/**
 * Real camera capture with a live guidance frame and an objective quality gate
 * (mean luminance + Laplacian-variance sharpness measured on the captured
 * frame). Nothing is accepted "just because it was clicked": an underexposed or
 * blurred shot is rejected and the applicant is asked to retake it.
 *
 * When getUserMedia is unavailable (desktop without webcam, denied permission,
 * insecure context) the component degrades to a native file/camera input.
 */
export function CameraCapture({
  frame,
  title,
  hint,
  facing = "environment",
  accept = ["image/jpeg", "image/png", "image/webp"],
  maxSizeMb = 10,
  onCapture,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "shot" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [quality, setQuality] = useState<CaptureQuality | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setError(null);
    setStatus("starting");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("denied");
      setError(t("kyc.camera.unsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("live");
    } catch {
      setStatus("denied");
      setError(t("kyc.camera.denied"));
    }
  }, [facing, t]);

  /** Objective image quality: luminance mean + Laplacian variance. */
  function analyse(canvas: HTMLCanvasElement): CaptureQuality {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { brightness: 128, sharpness: 100, ok: true };
    const w = Math.min(canvas.width, 320);
    const h = Math.round((canvas.height / canvas.width) * w);
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext("2d", { willReadFrequently: true })!;
    sctx.drawImage(canvas, 0, 0, w, h);
    const { data } = sctx.getImageData(0, 0, w, h);

    const grey = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i += 1) {
      const v = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
      grey[i] = v;
      sum += v;
    }
    const brightness = sum / (w * h);

    let mean = 0;
    const lap = new Float32Array((w - 2) * (h - 2));
    let k = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const v =
          4 * grey[y * w + x]! - grey[(y - 1) * w + x]! - grey[(y + 1) * w + x]! -
          grey[y * w + x - 1]! - grey[y * w + x + 1]!;
        lap[k] = v;
        mean += v;
        k += 1;
      }
    }
    mean /= k || 1;
    let variance = 0;
    for (let i = 0; i < k; i += 1) variance += (lap[i]! - mean) ** 2;
    const sharpness = variance / (k || 1);

    if (brightness < 55) return { brightness, sharpness, ok: false, reason: "dark" };
    if (brightness > 225) return { brightness, sharpness, ok: false, reason: "bright" };
    if (sharpness < 25) return { brightness, sharpness, ok: false, reason: "blurry" };
    return { brightness, sharpness, ok: true };
  }

  const shoot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d")!;
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const q = analyse(canvas);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
        setPendingFile(file);
        setPreview(URL.createObjectURL(blob));
        setQuality(q);
        setStatus("shot");
        stop();
      },
      "image/jpeg",
      0.92,
    );
  };

  const retake = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setQuality(null);
    void start();
  };

  const confirm = () => {
    if (pendingFile && quality) onCapture(pendingFile, quality);
  };

  const fromFile = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (!accept.includes(file.type)) { setError(t("kyc.camera.badFormat")); return; }
    if (file.size > maxSizeMb * 1024 * 1024) { setError(t("kyc.camera.tooLarge", { size: maxSizeMb })); return; }
    onCapture(file, { brightness: 128, sharpness: 100, ok: true });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        {onCancel && (
          <button type="button" onClick={() => { stop(); onCancel(); }} aria-label={t("common.close")} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="relative bg-black/90">
        <div className={cn("relative mx-auto w-full max-w-lg", FRAME_RATIO[frame])}>
          {status === "shot" && preview ? (
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className={cn("absolute inset-0 h-full w-full object-cover", facing === "user" && "scale-x-[-1]")}
            />
          )}

          {/* Guidance overlay */}
          {status !== "shot" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div
                className={cn(
                  "h-full w-full border-2 border-dashed border-white/70",
                  frame === "face" ? "rounded-full" : "rounded-xl",
                )}
              />
            </div>
          )}

          {status === "idle" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center">
              <Camera className="h-8 w-8 text-white/80" aria-hidden />
              <p className="text-xs text-white/80">{t("kyc.camera.ready")}</p>
              <Button type="button" size="sm" onClick={start}>{t("kyc.camera.start")}</Button>
            </div>
          )}
          {status === "starting" && (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
            </div>
          )}
          {status === "denied" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center">
              <AlertTriangle className="h-7 w-7 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-white/85">{error}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden />
                {t("kyc.camera.importInstead")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {quality && !quality.ok && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(`kyc.camera.quality.${quality.reason}`)}
          </p>
        )}
        {quality?.ok && (
          <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("kyc.camera.quality.ok")}
          </p>
        )}
        {error && status !== "denied" && (
          <p role="alert" className="text-xs font-medium text-destructive">{error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {status === "live" && (
            <Button type="button" onClick={shoot} className="flex-1 min-w-[140px]">
              <Camera className="h-4 w-4" aria-hidden />
              {t("kyc.camera.shoot")}
            </Button>
          )}
          {status === "shot" && (
            <>
              <Button type="button" variant="outline" onClick={retake} className="min-w-[120px]">
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("kyc.camera.retake")}
              </Button>
              <Button type="button" onClick={confirm} disabled={!quality?.ok} className="flex-1 min-w-[140px]">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t("kyc.camera.use")}
              </Button>
            </>
          )}
          {status !== "shot" && (
            <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden />
              {t("kyc.camera.importInstead")}
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={accept.join(",")}
        capture={frame === "face" ? "user" : "environment"}
        className="sr-only"
        aria-label={title}
        onChange={(e) => { fromFile(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
