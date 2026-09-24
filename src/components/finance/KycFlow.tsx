import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { assessKyc, type KycAssessment } from "@/lib/kyc.functions";
import { documentLabel } from "@/lib/document-labels";
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FileText,
  Home,
  IdCard,
  Loader2,
  Lock,
  RefreshCw,
  ScanFace,
  ScanLine,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentScanner, type ScanShape } from "@/components/finance/DocumentScanner";
import { DocumentSource } from "@/components/finance/DocumentSource";
import { LivenessCheck } from "@/components/finance/LivenessCheck";
import { KycArtApproved, KycArtRejected, KycArtReview } from "@/components/finance/KycDecisionArt";
import type { CaptureEvidence } from "@/lib/kyc/image-analysis";
import type { LivenessSessionEvidence } from "@/lib/kyc/liveness-engine";
import { useImmersiveMode } from "@/lib/kyc/immersive";
import {
  readIdentityDocument,
  releaseOcrEngine,
  warmOcrEngine,
  type OcrResult,
} from "@/lib/kyc/ocr";
import { loadFaceEngine } from "@/lib/kyc/liveness-engine";
import { cn } from "@/lib/utils";

export interface KycDocumentType {
  slug: string;
  i18n_key: string | null;
  label: string;
  required: boolean;
  accepts_multiple: boolean;
  max_size_mb: number;
  allowed_mime: string[];
  sort_order: number;
  category: "identity" | "address" | "income" | "bank" | "selfie" | "other";
  capture_mode: "scan" | "scan_double" | "selfie" | "upload";
  sides: number;
  employment_statuses: string[];
  countries: string[];
  product_slugs: string[];
}

export type KycStatus =
  | "todo"
  | "in_progress"
  | "capturing"
  | "verifying"
  | "passed"
  | "failed"
  | "retry"
  | "manual_review";

/** Preuve de capture réelle attachée à chaque pièce (revalidée côté serveur). */
export type KycEvidence = CaptureEvidence | LivenessSessionEvidence;

export interface KycCaptureFile {
  file: File;
  preview: string;
  side: number;
  /** Mesures produites par le scanner, l'import mesuré ou la session de vivacité. */
  evidence?: KycEvidence;
  /**
   * Lecture OCR/MRZ de la pièce d'identité, faite sur l'appareil du client.
   * Seul le texte brut part au serveur, qui re-décode et revérifie tout :
   * la lecture du navigateur n'est jamais une décision, seulement une source.
   */
  ocr?: OcrResult;
}

export type KycFiles = Record<string, KycCaptureFile[]>;

export interface KycState {
  files: KycFiles;
  /** Per-category progress, mirrored server-side in application_kyc_checks. */
  statuses: Record<string, KycStatus>;
  /** Identity / address document actually chosen by the applicant. */
  choices: Record<string, string>;
}

export const EMPTY_KYC: KycState = { files: {}, statuses: {}, choices: {} };

const CATEGORY_ORDER = ["identity", "address", "selfie", "bank", "income"] as const;
export type KycCategory = (typeof CATEGORY_ORDER)[number];

const CATEGORY_ICON: Record<KycCategory, React.ComponentType<{ className?: string }>> = {
  identity: IdCard,
  address: Home,
  selfie: ScanFace,
  bank: Banknote,
  income: FileText,
};

/**
 * Gabarit de visée du scanner : le passeport se présente ouvert (format plus
 * allongé), les autres pièces d'identité sont au format carte.
 */
function scanShape(doc: KycDocumentType): ScanShape {
  if (doc.category !== "identity") return "a4";
  return doc.slug.includes("passport") ? "passport" : "card";
}

export function docLabel(d: KycDocumentType, t: (k: string) => string): string {
  return documentLabel(t as never, d.slug, d.i18n_key, d.label);
}

/**
 * The KYC requirement set is entirely data-driven: it comes from the
 * `document_types` catalogue, filtered by the product's compliance rules and
 * the applicant's employment situation. Nothing is hardcoded in the UI.
 */
export function resolveKycPlan(
  documentTypes: KycDocumentType[],
  options: {
    employmentStatus: string;
    productSlug: string;
    allowedIdDocuments: string[];
    countryCode: string;
  },
): Record<KycCategory, KycDocumentType[]> {
  const plan = {} as Record<KycCategory, KycDocumentType[]>;
  for (const category of CATEGORY_ORDER) {
    plan[category] = documentTypes
      .filter((d) => d.category === category)
      .filter((d) => d.product_slugs.length === 0 || d.product_slugs.includes(options.productSlug))
      .filter((d) => d.countries.length === 0 || d.countries.includes(options.countryCode))
      .filter(
        (d) =>
          d.employment_statuses.length === 0 ||
          d.employment_statuses.includes(options.employmentStatus),
      )
      .filter((d) => {
        if (category !== "identity") return true;
        const key = d.slug.replace(/^id_/, "");
        return options.allowedIdDocuments.length === 0 || options.allowedIdDocuments.includes(key);
      })
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  return plan;
}

export function isKycComplete(
  plan: Record<KycCategory, KycDocumentType[]>,
  state: KycState,
): boolean {
  return CATEGORY_ORDER.every((category) => {
    const docs = plan[category];
    if (docs.length === 0) return true;
    if (!docs.some((d) => d.required)) return true;
    const chosen = state.choices[category] ?? (docs.length === 1 ? docs[0]!.slug : "");
    if (!chosen) return false;
    const doc = docs.find((d) => d.slug === chosen);
    if (!doc) return false;
    const captured = state.files[chosen] ?? [];
    return captured.length >= (doc.capture_mode === "scan_double" ? doc.sides : 1);
  });
}

interface Props {
  documentTypes: KycDocumentType[];
  employmentStatus: string;
  productSlug: string;
  allowedIdDocuments: string[];
  countryCode: string;
  state: KycState;
  onChange: (next: KycState) => void;
  /** Identité déclarée au formulaire, croisée au serveur avec la MRZ lue. */
  identity?: { first_name?: string; last_name?: string; birth_date?: string; nationality?: string };
  /** Sortie du parcours vers l'étape suivante de la demande (récapitulatif). */
  onComplete?: () => void;
}

export function KycFlow({
  documentTypes,
  employmentStatus,
  productSlug,
  allowedIdDocuments,
  countryCode,
  state,
  onChange,
  identity,
  onComplete,
}: Props) {
  const { t } = useTranslation();
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState<KycCategory | null>(null);
  const [capturing, setCapturing] = useState<{ slug: string; side: number } | null>(null);
  /** Lecture OCR en cours : la pièce vient d'être prise, on lit la MRZ. */
  const [reading, setReading] = useState(false);
  /**
   * Le parcours plein écran est monté dans `document.body` (portail). C'est
   * indispensable : la zone principale du site porte une animation de page
   * avec `transform`, et un ancêtre transformé devient le référentiel de tout
   * enfant `position: fixed` — l'écran de vérification se retrouvait alors
   * enfermé dans la hauteur de l'étape, apparemment vide. Le portail n'est
   * disponible qu'après hydratation, d'où ce drapeau.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * Références toujours à jour sur l'état et sur le rappel de changement.
   * Elles sont indispensables depuis la lecture de pièce, qui se termine en
   * arrière-plan : sans elles, la lecture écraserait un état déjà périmé.
   */
  const stateRef = useRef(state);
  stateRef.current = state;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Nombre de lectures de pièce encore en cours. */
  const readingCount = useRef(0);

  /**
   * Décision d'identité rendue par le serveur. Le navigateur ne calcule rien :
   * il envoie les mesures et le texte lu, et affiche la réponse du back-end.
   * La politique actuelle du serveur place chaque résultat en revue manuelle ;
   * les branches passed/failed restent disponibles pour une évolution future.
   */
  const assessFn = useServerFn(assessKyc);
  const [assessment, setAssessment] = useState<KycAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [assessError, setAssessError] = useState(false);
  const assessedSignature = useRef<string>("");

  // Dès le lancement, le parcours occupe l'écran entier : le chrome du site
  // s'efface et la page ne défile plus. Une étape = un écran = un geste.
  useImmersiveMode(started);

  /**
   * Préchargement. Dès que le parcours s'ouvre, le moteur de lecture de pièce
   * et le moteur de repères faciaux sont téléchargés en tâche de fond, pendant
   * que la personne lit les consignes. Quand elle scanne sa pièce ou lance le
   * contrôle du visage, tout est déjà prêt : plus d'attente au moment du geste.
   * Les moteurs sont relâchés à la sortie du parcours.
   */
  useEffect(() => {
    if (!started) return;
    void warmOcrEngine();
    void loadFaceEngine().catch(() => undefined);
    return () => {
      void releaseOcrEngine();
    };
  }, [started]);

  const plan = useMemo(
    () =>
      resolveKycPlan(documentTypes, {
        employmentStatus,
        productSlug,
        allowedIdDocuments,
        countryCode,
      }),
    [documentTypes, employmentStatus, productSlug, allowedIdDocuments, countryCode],
  );
  const categories = CATEGORY_ORDER.filter((c) => plan[c].length > 0);

  const categoryStatus = (category: KycCategory): KycStatus => {
    const docs = plan[category];
    const chosen = state.choices[category] ?? (docs.length === 1 ? docs[0]!.slug : "");
    if (!chosen) return "todo";
    const doc = docs.find((d) => d.slug === chosen);
    const needed = doc?.capture_mode === "scan_double" ? doc.sides : 1;
    const got = (state.files[chosen] ?? []).length;
    if (got === 0) return "in_progress";
    if (got < needed) return "capturing";
    // Une capture complète n'est pas une validation KYC : elle reste en
    // vérification jusqu'à la revue de conformité.
    return state.statuses[category] ?? "verifying";
  };

  const patch = (next: Partial<KycState>) => onChange({ ...state, ...next });

  const choose = (category: KycCategory, slug: string) => {
    const previous = state.choices[category];
    const files = { ...state.files };
    if (previous && previous !== slug) {
      (files[previous] ?? []).forEach((f) => URL.revokeObjectURL(f.preview));
      delete files[previous];
    }
    patch({ choices: { ...state.choices, [category]: slug }, files });
    // Le choix du type de pièce ouvre directement l'écran de capture, en plein
    // écran : plus de cadre qui apparaît en bas de page, plus de défilement.
    const doc = plan[category].find((d) => d.slug === slug);
    if (doc) setCapturing({ slug, side: 1 });
  };

  /**
   * Enregistre une capture puis enchaîne de lui-même : verso après recto, puis
   * retour à l'écran de l'étape. Le client ne revient jamais chercher un
   * bouton — l'écran suivant vient à lui.
   *
   * Pour une pièce d'identité, la bande MRZ est lue ici, sur l'appareil, avant
   * l'enchaînement : l'image ne quitte pas le téléphone pour être lue.
   */
  const addCapture = useCallback(
    async (
      category: KycCategory,
      doc: KycDocumentType,
      side: number,
      file: File,
      evidence?: KycEvidence,
    ) => {
      const preview = URL.createObjectURL(file);
      const current = stateRef.current.files[doc.slug] ?? [];
      current.filter((f) => f.side === side).forEach((f) => URL.revokeObjectURL(f.preview));

      // L'enchaînement est immédiat : la capture est retenue tout de suite et
      // l'écran suivant s'affiche sans attendre quoi que ce soit.
      const next = current.filter((f) => f.side !== side).concat({ file, preview, side, evidence });
      next.sort((a, b) => a.side - b.side);
      onChangeRef.current({
        ...stateRef.current,
        files: { ...stateRef.current.files, [doc.slug]: next },
      });

      const needed = doc.capture_mode === "scan_double" ? doc.sides : 1;
      const missing = Array.from({ length: needed }, (_, i) => i + 1).find(
        (s) => !next.some((f) => f.side === s),
      );
      setCapturing(missing ? { slug: doc.slug, side: missing } : null);

      // Lecture de la pièce : en arrière-plan, jamais devant le client. Elle se
      // fait sur l'appareil pendant que la personne continue son parcours, et
      // vient compléter la capture déjà enregistrée dès qu'elle aboutit.
      if (category !== "identity" || !file.type.startsWith("image/")) return;
      readingCount.current += 1;
      setReading(true);
      void readIdentityDocument(file)
        .then((ocr) => {
          const shots = stateRef.current.files[doc.slug] ?? [];
          // La capture a pu être reprise ou supprimée entre-temps : dans ce
          // cas la lecture est simplement abandonnée.
          if (!shots.some((f) => f.side === side && f.file === file)) return;
          onChangeRef.current({
            ...stateRef.current,
            files: {
              ...stateRef.current.files,
              [doc.slug]: shots.map((f) =>
                f.side === side && f.file === file ? { ...f, ocr } : f,
              ),
            },
          });
        })
        .catch(() => {
          // Une lecture impossible n'arrête jamais le client : la pièce part
          // telle quelle et la conformité tranchera.
        })
        .finally(() => {
          readingCount.current = Math.max(0, readingCount.current - 1);
          if (readingCount.current === 0) setReading(false);
        });
    },
    [],
  );

  const removeCapture = (slug: string, side: number) => {
    const current = state.files[slug] ?? [];
    current.filter((f) => f.side === side).forEach((f) => URL.revokeObjectURL(f.preview));
    patch({ files: { ...state.files, [slug]: current.filter((f) => f.side !== side) } });
  };

  const complete = (c: KycCategory) =>
    ["passed", "verifying", "manual_review"].includes(categoryStatus(c));
  const index = active ? categories.indexOf(active) : categories.length;
  const goNext = () => setActive(categories[index + 1] ?? null);
  const goPrev = () => setActive(index > 0 ? categories[index - 1]! : null);

  /* --------------------- Décision d'identité (serveur) -------------------
   * Le récapitulatif n'affiche jamais un verdict fabriqué à l'écran : les
   * mesures de capture et le texte OCR/MRZ partent au serveur, qui revalide
   * tout et renvoie la décision. Rien n'est conservé côté navigateur. */
  const assessPayload = useMemo(() => {
    const documents: {
      document_type_slug: string;
      category: string;
      capture_method: "scan" | "upload" | "liveness";
      capture_evidence?: unknown;
      ocr?: unknown;
    }[] = [];
    for (const category of categories) {
      const docs = plan[category];
      const chosen = state.choices[category] ?? (docs.length === 1 ? docs[0]!.slug : "");
      const doc = docs.find((d) => d.slug === chosen);
      if (!doc) continue;
      for (const shot of state.files[doc.slug] ?? []) {
        documents.push({
          document_type_slug: doc.slug,
          category: doc.category,
          capture_method:
            doc.capture_mode === "selfie"
              ? "liveness"
              : doc.capture_mode === "upload"
                ? "upload"
                : "scan",
          capture_evidence: shot.evidence,
          ocr: shot.ocr
            ? {
                mrz_text: shot.ocr.mrz_text,
                viz_text: shot.ocr.viz_text,
                confidence: shot.ocr.confidence,
                engine: shot.ocr.engine,
              }
            : undefined,
        });
      }
    }
    return documents;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, categories.join("|")]);

  const assessSignature = useMemo(
    () =>
      JSON.stringify([
        assessPayload,
        identity?.first_name,
        identity?.last_name,
        identity?.birth_date,
        identity?.nationality,
      ]),
    [assessPayload, identity],
  );

  const onRecap = started && !active;

  useEffect(() => {
    if (!onRecap || reading || assessPayload.length === 0) return;
    if (assessedSignature.current === assessSignature) return;
    assessedSignature.current = assessSignature;
    let cancelled = false;
    setAssessing(true);
    setAssessment(null);
    setAssessError(false);
    void assessFn({
      data: {
        identity: {
          first_name: identity?.first_name ?? "",
          last_name: identity?.last_name ?? "",
          birth_date: identity?.birth_date ?? "",
          nationality: identity?.nationality ?? "",
        },
        documents: assessPayload,
      },
    })
      .then((res) => {
        if (!cancelled) setAssessment(res);
      })
      .catch(() => {
        if (cancelled) return;
        // Une erreur technique n'est jamais une décision de conformité.
        assessedSignature.current = "";
        setAssessError(true);
      })
      .finally(() => {
        if (!cancelled) setAssessing(false);
      });
    return () => {
      cancelled = true;
      assessedSignature.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRecap, assessSignature, reading]);

  /**
   * Écran plein du parcours. Le contenu occupe l'affichage entier, le chrome
   * du site est masqué, et chaque changement d'étape glisse latéralement : le
   * client perçoit une page qui succède à une page, pas un bloc qui s'ouvre.
   */
  const screen = (key: string, content: ReactNode, bare = false) => {
    const overlay = (
      <div className="fixed inset-0 z-[70] flex min-h-0 flex-col overflow-hidden bg-background">
        {bare ? (
          <div key={key} className="flex min-h-0 flex-1 flex-col duration-300 animate-in fade-in">
            {content}
          </div>
        ) : (
          <div
            key={key}
            className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[max(env(safe-area-inset-top),1.5rem)] duration-300 animate-in fade-in slide-in-from-right-6"
          >
            {content}
          </div>
        )}
        {/* La lecture de la pièce se fait en arrière-plan : elle ne barre plus
            l'écran ni n'interrompt le parcours. Un simple bandeau discret
            indique qu'elle est en cours, et la personne continue. */}
        {reading && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-3.5 py-2 shadow-lg backdrop-blur-sm">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
              <p className="text-xs font-medium">{t("kyc.reading.title")}</p>
            </div>
          </div>
        )}
      </div>
    );
    // Hors du flux de la page : sinon l'animation de page (`transform`) de la
    // zone principale confine ce `fixed` et l'écran paraît vide.
    return mounted ? createPortal(overlay, document.body) : overlay;
  };

  /** Barre supérieure commune : sortie du parcours et retour d'étape. */
  const topBar = (onBack?: () => void) => (
    <div className="flex items-center justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
          {t("common.back")}
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={() => {
          setCapturing(null);
          setStarted(false);
        }}
        aria-label={t("common.close")}
        className="-mr-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );

  /* ------------------------------- Intro ------------------------------- */
  if (!started) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-4 rounded-xl border border-border bg-gradient-to-br from-primary/5 to-transparent p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t("kyc.intro.title")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("kyc.intro.why")}
            </p>
          </div>
        </div>

        <ol className="space-y-2.5">
          {categories.map((category, i) => {
            const Icon = CATEGORY_ICON[category];
            return (
              <li
                key={category}
                className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {t(`kyc.category.${category}.title`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`kyc.category.${category}.desc`)}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              </li>
            );
          })}
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("kyc.intro.camera")}
          </p>
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("kyc.intro.privacy")}
          </p>
        </div>

        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => {
            setStarted(true);
            setActive(categories[0] ?? null);
          }}
        >
          {t("kyc.intro.start")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  /* ------------------------- Active capture screen ----------------------
   *
   * Trois chemins distincts, jamais interchangeables :
   *   - pièce d'identité  : scanner caméra arrière, déclenchement automatique,
   *                         recto/verso uniquement si la pièce l'exige ;
   *   - vivacité          : caméra frontale imposée, aucun import possible ;
   *   - justificatifs     : import depuis les fichiers OU scan caméra.
   * -------------------------------------------------------------------- */
  if (active && capturing) {
    const doc = plan[active].find((d) => d.slug === capturing.slug);
    if (doc) {
      const twoSided = doc.capture_mode === "scan_double" && doc.sides > 1;
      const sideKey = twoSided ? (capturing.side === 1 ? "front" : "back") : "single";
      const label = twoSided
        ? `${docLabel(doc, t)} — ${t(`kyc.side.${sideKey}`)}`
        : docLabel(doc, t);
      const close = () => setCapturing(null);

      if (doc.capture_mode === "selfie") {
        return screen(
          `${doc.slug}-liveness`,
          <LivenessCheck
            title={label}
            hint={t("kyc.hint.selfie")}
            onCapture={(file, evidence) =>
              void addCapture(active, doc, capturing.side, file, evidence)
            }
            onCancel={close}
          />,
          true,
        );
      }

      if (doc.capture_mode === "upload") {
        return screen(
          `${doc.slug}-upload-${capturing.side}`,
          <DocumentSource
            title={label}
            hint={t("kyc.hint.upload")}
            accept={doc.allowed_mime}
            maxSizeMb={doc.max_size_mb}
            onCapture={(file, evidence) =>
              void addCapture(active, doc, capturing.side, file, evidence)
            }
            onCancel={close}
          />,
          true,
        );
      }

      return screen(
        `${doc.slug}-scan-${capturing.side}`,
        <DocumentScanner
          shape={scanShape(doc)}
          profile="identity"
          title={label}
          hint={t(`kyc.hint.${doc.capture_mode}`)}
          onCapture={(file, evidence) =>
            void addCapture(active, doc, capturing.side, file, evidence)
          }
          onCancel={close}
        />,
        true,
      );
    }
  }

  /* ---------------------------- Progress rail --------------------------- */
  const rail = (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium tabular-nums">
          {t("kyc.stepOf", {
            current: Math.min(index + 1, categories.length),
            total: categories.length,
          })}
        </span>
        <span className="tabular-nums">
          {categories.filter(complete).length}/{categories.length}
        </span>
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={categories.length}
        aria-valuenow={index}
      >
        {categories.map((c, i) => (
          <span
            key={c}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              complete(c) ? "bg-success" : i === index ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );

  /* --------------------------- Final recap step ------------------------- */
  if (!active) {
    return screen(
      "recap",
      <>
        {topBar()}
        {rail}
        <div className="flex items-start gap-4 rounded-xl border border-success/30 bg-success/5 p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success text-white">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t("kyc.done.title")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("kyc.done.desc")}
            </p>
          </div>
        </div>

        {/* Verdict d'identité — rendu par le serveur, jamais par l'écran. */}
        <DecisionCard assessment={assessment} loading={assessing || reading} failed={assessError} />

        <ul className="space-y-2">
          {categories.map((category) => {
            const Icon = CATEGORY_ICON[category];
            const docs = plan[category];
            const chosen = state.choices[category] ?? (docs.length === 1 ? docs[0]!.slug : "");
            const doc = docs.find((d) => d.slug === chosen);
            return (
              <li
                key={category}
                className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {t(`kyc.category.${category}.title`)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {doc ? docLabel(doc, t) : t(`kyc.category.${category}.desc`)}
                  </span>
                </span>
                <StatusPill status={categoryStatus(category)} />
                <button
                  type="button"
                  onClick={() => setActive(category)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline"
                >
                  {t("common.edit")}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("kyc.storageNotice")}
        </p>

        {/* Sortie du parcours : retour à la dernière étape, ou passage au
         * récapitulatif de la demande. Une identité refusée ne peut pas
         * continuer : la pièce doit être reprise. */}
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setActive(categories[categories.length - 1] ?? null)}
            disabled={categories.length === 0}
          >
            {t("common.back")}
          </Button>
          {assessment?.decision === "failed" ? (
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={() => setActive(categories[0] ?? null)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t("kyc.decision.retry")}
            </Button>
          ) : (
            <Button
              type="button"
              className="flex-1"
              disabled={assessing}
              onClick={() => {
                setCapturing(null);
                setStarted(false);
                onComplete?.();
              }}
            >
              {assessing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("common.continue")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </>,
    );
  }

  /* ------------------------- One category at a time --------------------- */
  const docs = plan[active];
  const chosen = state.choices[active] ?? (docs.length === 1 ? docs[0]!.slug : "");
  const doc = docs.find((d) => d.slug === chosen);
  const needed = doc?.capture_mode === "scan_double" ? doc.sides : 1;
  const captured = state.files[chosen] ?? [];
  const ActiveIcon = CATEGORY_ICON[active];
  const canContinue = complete(active) || !docs.some((d) => d.required);

  return screen(
    active,
    <>
      {topBar(index > 0 ? goPrev : undefined)}
      {rail}

      <header className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ActiveIcon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{t(`kyc.category.${active}.title`)}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {t(`kyc.category.${active}.desc`)}
          </p>
        </div>
        <StatusPill status={categoryStatus(active)} />
      </header>

      {docs.length > 1 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("kyc.chooseDocument")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {docs.map((d) => (
              <button
                key={d.slug}
                type="button"
                onClick={() => choose(active, d.slug)}
                aria-pressed={d.slug === chosen}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                  d.slug === chosen
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-ring/50",
                )}
              >
                <BadgeCheck
                  className={cn(
                    "h-4 w-4 shrink-0",
                    d.slug === chosen ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{docLabel(d, t)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {doc && (
        <div className="space-y-3">
          <div className={cn("grid gap-3", needed > 1 ? "sm:grid-cols-2" : "")}>
            {Array.from({ length: needed }, (_, i) => i + 1).map((side) => {
              const shot = captured.find((f) => f.side === side);
              const sideKey = needed > 1 ? (side === 1 ? "front" : "back") : "single";
              return (
                <div key={side} className="overflow-hidden rounded-lg border border-border">
                  <div className="relative aspect-[1.586/1] bg-muted/60">
                    {shot && shot.file.type.startsWith("image/") ? (
                      <img
                        src={shot.preview}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : shot ? (
                      <div className="absolute inset-0 grid place-items-center gap-1 text-muted-foreground">
                        <FileText className="h-6 w-6" aria-hidden />
                        <span className="max-w-[85%] truncate px-2 text-[11px]">
                          {shot.file.name}
                        </span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                        <CircleDashed className="h-6 w-6" aria-hidden />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate text-xs font-medium">{t(`kyc.side.${sideKey}`)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={shot ? "outline" : "default"}
                        onClick={() => setCapturing({ slug: doc.slug, side })}
                      >
                        {shot ? (
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        ) : doc.capture_mode === "selfie" ? (
                          <ScanFace className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ScanLine className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {shot
                          ? t("kyc.retake")
                          : doc.capture_mode === "selfie"
                            ? t("kyc.startLiveness")
                            : doc.capture_mode === "upload"
                              ? t("kyc.addDocument")
                              : t("kyc.scan")}
                      </Button>
                      {shot && (
                        <button
                          type="button"
                          onClick={() => removeCapture(doc.slug, side)}
                          aria-label={t("common.delete")}
                          className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(`kyc.hint.${doc.capture_mode}`)}
          </p>
        </div>
      )}

      {docs.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("kyc.nothingRequired")}</p>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={goPrev} disabled={index === 0}>
          {t("common.back")}
        </Button>
        <Button type="button" className="flex-1" onClick={goNext} disabled={!canContinue}>
          {index === categories.length - 1 ? t("kyc.finish") : t("common.continue")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("kyc.storageNotice")}
      </p>
    </>,
  );
}

function StatusPill({ status }: { status: KycStatus }) {
  const { t } = useTranslation();
  const map: Record<
    KycStatus,
    { className: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    todo: { className: "bg-muted text-muted-foreground", Icon: CircleDashed },
    in_progress: { className: "bg-info/15 text-info", Icon: CircleDashed },
    capturing: { className: "bg-warning/15 text-warning", Icon: Loader2 },
    verifying: { className: "bg-info/15 text-info", Icon: Loader2 },
    passed: { className: "bg-success/15 text-success", Icon: CheckCircle2 },
    failed: { className: "bg-destructive/15 text-destructive", Icon: RefreshCw },
    retry: { className: "bg-warning/15 text-warning", Icon: RefreshCw },
    manual_review: { className: "bg-warning/15 text-warning", Icon: ShieldCheck },
  };
  const { className, Icon } = map[status];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span className="hidden sm:inline">{t(`kyc.status.${status}`)}</span>
    </span>
  );
}

/**
 * Verdict d'identité affiché au client.
 *
 * Le composant ne juge rien et ne montre rien d'interne : il rend la seule
 * décision renvoyée par le serveur. La politique actuelle impose l'examen par
 * le service conformité pour tous les dossiers ; les rendus passed/failed
 * restent présents sans pouvoir être choisis par le navigateur. Le score, les
 * motifs machine et les contrôles champ par champ
 * restent dans le dossier de conformité ; ils ne sont jamais présentés au
 * client. En l'absence de réponse du serveur, le dossier est simplement
 * annoncé en examen.
 */
function DecisionCard({
  assessment,
  loading,
  failed,
}: {
  assessment: KycAssessment | null;
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("kyc.decision.checking")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("kyc.decision.checkingDesc")}</p>
        </div>
      </div>
    );
  }

  if (failed || !assessment) {
    return (
      <div role="alert" className="border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium">{t("kyc.decision.unavailable")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("kyc.decision.unavailableNotice")}</p>
      </div>
    );
  }
  const decision = assessment.decision;

  const view =
    decision === "passed"
      ? {
          box: "border-success/40 bg-success/5",
          Art: KycArtApproved,
          notice: "kyc.decision.passedNotice",
        }
      : decision === "failed"
        ? {
            box: "border-destructive/40 bg-destructive/5",
            Art: KycArtRejected,
            notice: "kyc.decision.failedNotice",
          }
        : {
            box: "border-warning/40 bg-warning/5",
            Art: KycArtReview,
            notice: "kyc.decision.reviewNotice",
          };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-4 rounded-xl border p-6 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left",
        view.box,
      )}
    >
      <view.Art />
      <div className="min-w-0">
        <p className="text-base font-semibold">{t(`kyc.decision.${decision}`)}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(view.notice)}</p>
      </div>
    </div>
  );
}
