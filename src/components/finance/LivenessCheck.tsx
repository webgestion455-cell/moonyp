/**
 * Contrôle de vivacité — caméra frontale uniquement.
 *
 * Il n'y a ici ni import de fichier, ni simulation : la caméra avant est
 * ouverte directement, chaque image passe dans le moteur de repères faciaux
 * MediaPipe (`src/lib/kyc/liveness-engine.ts`) et les défis (clignement,
 * rotation de tête, sourire, ouverture de bouche) sont validés sur des mesures
 * réelles. La session produite (défis tirés au sort, mesures, durées) est
 * transmise au serveur avec le portrait, qui la revalide avant de statuer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  ScanFace,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LIVENESS_THRESHOLDS,
  challengeAtRest,
  challengeSatisfied,
  challengeValue,
  drawChallenges,
  issueMutedDuring,
  loadFaceEngine,
  readFace,
  type ChallengeResult,
  type FaceIssue,
  type FaceMetrics,
  type LivenessChallenge,
  type LivenessSessionEvidence,
} from "@/lib/kyc/liveness-engine";

interface Props {
  title: string;
  hint: string;
  onCapture: (file: File, evidence: LivenessSessionEvidence) => void;
  onCancel?: () => void;
}

const ANALYSIS_INTERVAL_MS = 70;
/** Une image sur cinq passe aussi par l'analyse photométrique / anti-écran. */
const PHOTOMETRY_EVERY = 5;
/**
 * Quatre défis tirés au hasard, dans un ordre imprévisible : c'est ce tirage
 * qui rend inopérant le rejeu d'une vidéo préenregistrée du client.
 */
const CHALLENGE_COUNT = 4;

type Phase = "loading" | "positioning" | "challenge" | "captured" | "error";

export function LivenessCheck({ title, hint, onCapture, onCancel }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRun = useRef(0);
  const frameCount = useRef(0);
  const startedAt = useRef(0);
  const startedIso = useRef("");
  const readyStreak = useRef(0);
  const restSeen = useRef(false);
  const challengeShownAt = useRef(0);
  const stepRef = useRef(0);
  const doneRef = useRef(false);
  const passedRef = useRef<ChallengeResult[]>([]);
  const challengesRef = useRef<LivenessChallenge[]>([]);
  const agg = useRef({
    yawMin: 0,
    yawMax: 0,
    blink: 0,
    smile: 0,
    jaw: 0,
    depthSum: 0,
    depthCount: 0,
    screenMax: 0,
    brightSum: 0,
    sharpSum: 0,
    photoCount: 0,
    multiFace: 0,
    noFace: 0,
  });

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<FaceIssue | null>("no_face");
  const [step, setStep] = useState(0);
  const [challenges, setChallenges] = useState<LivenessChallenge[]>([]);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; evidence: LivenessSessionEvidence } | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  /* ----------------------- Portrait + preuve finale ---------------------- */
  const finish = useCallback(
    (metrics: FaceMetrics) => {
      const video = videoRef.current;
      if (!video || doneRef.current) return;
      doneRef.current = true;

      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const canvas = document.createElement("canvas");
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Le portrait est enregistré tel qu'il est vu, sans effet miroir.
      ctx.drawImage(video, 0, 0, vw, vh);

      const a = agg.current;
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            doneRef.current = false;
            return;
          }
          const file = new File([blob], `liveness-${Date.now()}.jpg`, { type: "image/jpeg" });
          const evidence: LivenessSessionEvidence = {
            method: "liveness",
            session_id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `ls-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            started_at: startedIso.current,
            completed_at: new Date().toISOString(),
            duration_ms: Math.round(performance.now() - startedAt.current),
            analysed_frames: frameCount.current,
            requested: challengesRef.current,
            passed: passedRef.current,
            metrics: {
              yaw_min: Math.round(a.yawMin * 10) / 10,
              yaw_max: Math.round(a.yawMax * 10) / 10,
              blink_peak: Math.round(a.blink * 100) / 100,
              smile_peak: Math.round(a.smile * 100) / 100,
              jaw_peak: Math.round(a.jaw * 100) / 100,
              depth_variance_avg:
                Math.round((a.depthCount ? a.depthSum / a.depthCount : metrics.depthVariance) * 1000) / 1000,
              screen_likelihood_max: Math.round(a.screenMax * 100) / 100,
              brightness_avg: Math.round((a.photoCount ? a.brightSum / a.photoCount : 0) * 10) / 10,
              sharpness_avg: Math.round((a.photoCount ? a.sharpSum / a.photoCount : 0) * 10) / 10,
              multi_face_frames: a.multiFace,
              no_face_frames: a.noFace,
            },
            device: { width: vw, height: vh, facing: "user" },
            engine: { name: "mediapipe/face_landmarker", version: "1.0.1" },
          };
          setPreview(URL.createObjectURL(blob));
          setPending({ file, evidence });
          setPhase("captured");
          stop();
        },
        "image/jpeg",
        0.94,
      );
    },
    [stop],
  );

  /* -------------------------- Boucle d'analyse -------------------------- */
  const loop = useCallback(
    (engine: { detectForVideo: (v: HTMLVideoElement, ts: number) => unknown }) => {
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        const video = videoRef.current;
        if (!video || video.readyState < 2 || doneRef.current) return;

        const now = performance.now();
        if (now - lastRun.current < ANALYSIS_INTERVAL_MS) return;
        lastRun.current = now;

        let raw: unknown;
        try {
          raw = engine.detectForVideo(video, now);
        } catch {
          return;
        }

        frameCount.current += 1;
        let image: ImageData | null = null;
        if (frameCount.current % PHOTOMETRY_EVERY === 0) {
          if (!workRef.current) workRef.current = document.createElement("canvas");
          const work = workRef.current;
          const width = 256;
          const height = Math.max(2, Math.round((video.videoHeight / (video.videoWidth || 1)) * width));
          work.width = width;
          work.height = height;
          const ctx = work.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            try {
              image = ctx.getImageData(0, 0, width, height);
            } catch {
              image = null;
            }
          }
        }

        const verdict = readFace(raw, { image });
        const m = verdict.metrics;
        const a = agg.current;
        if (m.faces === 0) a.noFace += 1;
        if (m.faces > 1) a.multiFace += 1;
        a.yawMin = Math.min(a.yawMin, m.yaw);
        a.yawMax = Math.max(a.yawMax, m.yaw);
        a.blink = Math.max(a.blink, Math.max(m.blinkLeft, m.blinkRight));
        a.smile = Math.max(a.smile, m.smile);
        a.jaw = Math.max(a.jaw, m.jawOpen);
        if (m.faces > 0) {
          a.depthSum += m.depthVariance;
          a.depthCount += 1;
        }
        if (image) {
          a.screenMax = Math.max(a.screenMax, m.screenLikelihood);
          a.brightSum += m.brightness;
          a.sharpSum += m.sharpness;
          a.photoCount += 1;
        }

        // Consigne affichée. Pendant un défi de rotation, tourner la tête met
        // forcément le visage de trois quarts : signaler « regardez droit vers
        // la caméra » à ce moment-là contredit la consigne en cours et bloque
        // la personne. Ces reproches-là sont donc tus tant que le défi dure.
        const active =
          challengeShownAt.current === 0 ? null : (challengesRef.current[stepRef.current] ?? null);
        setIssue(issueMutedDuring(active, verdict.issue) ? null : verdict.issue);

        // Phase 1 — cadrage : le visage doit être conforme plusieurs images
        // d'affilée avant que le premier défi ne soit demandé.
        if (stepRef.current === 0 && challengesRef.current.length > 0 && challengeShownAt.current === 0) {
          readyStreak.current = verdict.ready ? readyStreak.current + 1 : 0;
          setProgress(Math.min(1, readyStreak.current / LIVENESS_THRESHOLDS.readyFrames));
          if (readyStreak.current >= LIVENESS_THRESHOLDS.readyFrames) {
            challengeShownAt.current = now;
            restSeen.current = false;
            setPhase("challenge");
            setProgress(0);
          }
          return;
        }
        if (challengeShownAt.current === 0) return;

        // Phase 2 — défis. Le visage doit rester unique, cadré et en relief.
        if (m.faces !== 1) return;
        if (m.depthVariance < LIVENESS_THRESHOLDS.minDepthVariance) {
          setIssue("flat");
          return;
        }

        const current = challengesRef.current[stepRef.current];
        if (!current) return;

        if (!restSeen.current) {
          if (challengeAtRest(current, m)) restSeen.current = true;
          return;
        }

        const value = challengeValue(current, m);
        const target =
          current === "turn_left" || current === "turn_right"
            ? LIVENESS_THRESHOLDS.turnYaw
            : current === "blink"
              ? LIVENESS_THRESHOLDS.blink
              : current === "smile"
                ? LIVENESS_THRESHOLDS.smile
                : LIVENESS_THRESHOLDS.jawOpen;
        setProgress(Math.min(1, value / target));

        if (challengeSatisfied(current, m)) {
          passedRef.current = [
            ...passedRef.current,
            {
              challenge: current,
              at_ms: Math.round(now - startedAt.current),
              reaction_ms: Math.round(now - challengeShownAt.current),
              value: Math.round(value * 100) / 100,
            },
          ];
          const next = stepRef.current + 1;
          stepRef.current = next;
          setStep(next);
          setProgress(0);
          restSeen.current = false;
          challengeShownAt.current = now;
          if (next >= challengesRef.current.length) finish(m);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [finish],
  );

  /* --------------------------- Démarrage session ------------------------ */
  const start = useCallback(async () => {
    setError(null);
    setPhase("loading");
    setStep(0);
    setProgress(0);
    setIssue("no_face");
    doneRef.current = false;
    stepRef.current = 0;
    passedRef.current = [];
    readyStreak.current = 0;
    challengeShownAt.current = 0;
    frameCount.current = 0;
    agg.current = {
      yawMin: 0, yawMax: 0, blink: 0, smile: 0, jaw: 0,
      depthSum: 0, depthCount: 0, screenMax: 0,
      brightSum: 0, sharpSum: 0, photoCount: 0, multiFace: 0, noFace: 0,
    };
    const drawn = drawChallenges(CHALLENGE_COUNT);
    challengesRef.current = drawn;
    setChallenges(drawn);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError(t("kyc.liveness.unsupported"));
      return;
    }

    try {
      // Caméra et moteur d'analyse démarrent ENSEMBLE, pas l'un après l'autre :
      // la demande d'accès part à la première milliseconde, si bien que l'image
      // apparaît pendant que le moteur finit de se charger. C'est ce qui
      // supprime l'attente écran noir avant l'ouverture de la caméra frontale.
      const streamPromise = navigator.mediaDevices.getUserMedia({
        // Caméra frontale imposée : contrairement au scanner de documents,
        // le contrôle de vivacité ne s'ouvre jamais sur la caméra arrière.
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      // Le moteur est lancé sans attendre la caméra ; si la personne refuse
      // l'accès, le flux rejeté est signalé plus bas et le moteur préchargé
      // resservira au prochain essai.
      const enginePromise = loadFaceEngine();
      streamPromise.catch(() => undefined);
      enginePromise.catch(() => undefined);

      const stream = await streamPromise;
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      // L'aperçu est déjà à l'écran : il ne reste qu'à attendre le moteur, qui
      // s'est chargé en même temps.
      const engine = await enginePromise;
      startedAt.current = performance.now();
      startedIso.current = new Date().toISOString();
      setPhase("positioning");
      loop(engine);
    } catch (err) {
      setPhase("error");
      const name = (err as { name?: string } | null)?.name ?? "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? t("kyc.liveness.denied")
          : t("kyc.liveness.engineError"),
      );
    }
  }, [loop, t]);

  useEffect(() => {
    void start();
    // Une seule ouverture de caméra par montage du contrôle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPending(null);
    stop();
    void start();
  };

  const currentChallenge = challenges[step];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <ScanFace className="h-4 w-4 text-primary" aria-hidden />
            {title}
          </h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={() => { stop(); onCancel(); }}
            aria-label={t("common.close")}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="relative bg-black">
        <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden sm:aspect-[4/3]">
          {phase === "captured" && preview ? (
            <img src={preview} alt="" className="absolute inset-0 h-full w-full scale-x-[-1] object-cover" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
            />
          )}

          {(phase === "positioning" || phase === "challenge") && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 flex items-center justify-center p-8">
                <div
                  className={cn(
                    "h-full w-full max-w-[78%] rounded-[50%] border-2 transition-colors duration-200",
                    issue === null ? "border-success" : "border-white/70",
                  )}
                />
              </div>
              <div className="absolute inset-x-0 top-0 flex justify-center p-3">
                <span
                  className={cn(
                    "max-w-[92%] rounded-full px-3 py-1.5 text-center text-xs font-medium backdrop-blur",
                    issue === null ? "bg-success/90 text-white" : "bg-black/65 text-white",
                  )}
                >
                  {phase === "challenge" && issue === null && currentChallenge
                    ? t(`kyc.liveness.challenge.${currentChallenge}`)
                    : t(`kyc.liveness.guidance.${issue ?? "ready"}`)}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                <div
                  className="h-full bg-success transition-[width] duration-100"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {phase === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
              <p className="text-xs text-white/80">{t("kyc.liveness.loading")}</p>
            </div>
          )}

          {phase === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
              <AlertTriangle className="h-7 w-7 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-white/85">{error}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => void start()}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("kyc.liveness.retry")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {(phase === "positioning" || phase === "challenge") && (
          <>
            <ol className="grid grid-cols-3 gap-1.5 text-[11px]">
              {challenges.map((c, i) => (
                <li
                  key={`${c}-${i}`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5",
                    i < step
                      ? "bg-success/10 text-success"
                      : i === step && phase === "challenge"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      i < step ? "bg-success" : i === step ? "bg-primary" : "bg-muted-foreground/50",
                    )}
                  />
                  <span className="truncate">{t(`kyc.liveness.short.${c}`)}</span>
                </li>
              ))}
            </ol>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("kyc.liveness.notice")}</p>
          </>
        )}

        {phase === "captured" && pending && (
          <>
            <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("kyc.liveness.passed", { count: pending.evidence.passed.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={restart} className="min-w-[130px]">
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("kyc.liveness.restart")}
              </Button>
              <Button
                type="button"
                className="min-w-[150px] flex-1"
                onClick={() => onCapture(pending.file, pending.evidence)}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t("kyc.liveness.validate")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
