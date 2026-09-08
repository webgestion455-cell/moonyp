/**
 * Dépôt de pièces depuis l'espace client sécurisé.
 *
 * Aucun système parallèle : ce composant réutilise exactement les mêmes
 * fonctions serveur que le parcours de souscription
 * (`createUploadUrl` → dépôt signé → `registerDocuments`), donc le même
 * bucket privé, les mêmes contrôles de type/taille et la même trace KYC.
 */
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Loader2, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { documentLabel } from "@/lib/document-labels";
import { createUploadUrl, registerDocuments } from "@/lib/applications.functions";

export interface PortalDocumentType {
  slug: string;
  i18n_key: string | null;
  label: string;
  max_size_mb: number;
  allowed_mime: string[];
  category: string;
}

/** Téléverse un fichier et renvoie le nom enregistré, ou null en cas d'échec. */
export function usePortalUpload(token: string) {
  const getUrl = useServerFn(createUploadUrl);
  const register = useServerFn(registerDocuments);

  return async function upload(file: File, slug: string): Promise<string | null> {
    const mime = file.type || "application/octet-stream";
    const signed = await getUrl({
      data: {
        token,
        document_type_slug: slug,
        file_name: file.name,
        mime_type: mime,
        file_size: file.size,
      },
    });

    const put = await fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "content-type": mime },
      body: file,
    });
    if (!put.ok) return null;

    await register({
      data: {
        token,
        documents: [
          {
            document_type_slug: slug,
            storage_path: signed.path,
            file_name: file.name,
            mime_type: mime,
            file_size: file.size,
          },
        ],
      },
    });
    return file.name;
  };
}

export function PortalUpload({
  token,
  documentTypes,
  fixedSlug,
  compact,
  onUploaded,
}: {
  token: string;
  documentTypes: PortalDocumentType[];
  /** Demande ciblée : le type de pièce est imposé par le back-office. */
  fixedSlug?: string | null;
  compact?: boolean;
  onUploaded: (fileName: string, slug: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = usePortalUpload(token);

  const options = useMemo(
    () => documentTypes.filter((d) => !fixedSlug || d.slug === fixedSlug),
    [documentTypes, fixedSlug],
  );
  const [slug, setSlug] = useState(fixedSlug ?? options[0]?.slug ?? "");
  const [busy, setBusy] = useState(false);

  const selected = options.find((d) => d.slug === slug) ?? options[0];
  const accept = selected?.allowed_mime.join(",") || "application/pdf,image/jpeg,image/png";

  async function handleFile(file: File | undefined) {
    if (!file || !selected || busy) return;
    if (file.size > selected.max_size_mb * 1024 * 1024) {
      toast.error(t("kyc.camera.tooLarge", { size: selected.max_size_mb }));
      return;
    }
    if (selected.allowed_mime.length > 0 && !selected.allowed_mime.includes(file.type)) {
      toast.error(t("kyc.camera.badFormat"));
      return;
    }
    setBusy(true);
    try {
      const name = await upload(file, selected.slug);
      if (!name) throw new Error("upload_failed");
      toast.success(t("finance.portal.upload.success"));
      await onUploaded(name, selected.slug);
    } catch {
      toast.error(t("finance.portal.upload.error"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (options.length === 0) return null;

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "mt-4 space-y-2"}>
      {!fixedSlug && (
        <label className="block">
          <span className="sr-only">{t("finance.portal.upload.chooseType")}</span>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            {options.map((d) => (
              <option key={d.slug} value={d.slug}>
                {documentLabel(t as never, d.slug, d.i18n_key, d.label)}
              </option>
            ))}
          </select>
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <Button
        type="button"
        size="sm"
        variant={compact ? "outline" : "default"}
        className="gap-2"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : compact ? (
          <Paperclip className="h-4 w-4" aria-hidden />
        ) : (
          <Upload className="h-4 w-4" aria-hidden />
        )}
        {compact ? t("finance.portal.upload.attach") : t("finance.portal.upload.send")}
      </Button>

      {!compact && selected && (
        <p className="text-[11px] text-muted-foreground">
          {t("finance.portal.upload.limits", { size: selected.max_size_mb })}
        </p>
      )}
    </div>
  );
}
