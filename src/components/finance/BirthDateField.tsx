/**
 * Champ « date de naissance » bancaire — saisie JJ/MM/AAAA identique sur
 * TOUS les appareils (desktop, tablette, mobile iOS/Android).
 *
 * Pourquoi ne pas utiliser `<input type="date">` ?
 * Sur mobile, ce type impose le sélecteur natif (roue de dates) : impossible
 * de taper directement « 12/04/1989 », l'utilisateur doit faire défiler des
 * décennies. On implémente donc un masque numérique contrôlé :
 *   - `inputMode="numeric"` ouvre le pavé chiffré sur mobile ;
 *   - les « / » sont insérés automatiquement à la frappe ;
 *   - la suppression franchit les séparateurs sans blocage ;
 *   - la valeur remontée reste au format ISO (AAAA-MM-JJ) attendu par l'API.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** ISO (AAAA-MM-JJ) → affichage JJ/MM/AAAA. */
function isoToDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Applique le masque JJ/MM/AAAA sur une saisie brute. */
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Convertit un masque complet en date ISO valide, sinon "". */
function displayToIso(display: string): string {
  const digits = display.replace(/\D/g, "");
  if (digits.length !== 8) return "";

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  const date = new Date(year, month - 1, day);

  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    year >= 1900 &&
    date <= new Date();

  if (!valid) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function BirthDateField({
  id = "birth_date",
  value,
  error,
  label,
  onChange,
}: {
  id?: string;
  value: string;
  error?: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const displayValue = useMemo(() => isoToDisplay(value), [value]);
  const [draft, setDraft] = useState(displayValue);

  useEffect(() => {
    // On ne réécrase la saisie que si la valeur externe diverge réellement.
    if (displayToIso(draft) !== value) setDraft(displayValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue]);

  const commit = (raw: string) => {
    const formatted = mask(raw);
    setDraft(formatted);
    onChange(displayToIso(formatted));
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>

      <Input
        id={id}
        name={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9/]*"
        autoComplete="bday"
        placeholder={t("finance.fields.birthDatePlaceholder", { defaultValue: "JJ/MM/AAAA" })}
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          // Retour arrière sur un séparateur : on supprime aussi le chiffre.
          if (e.key === "Backspace" && draft.endsWith("/")) {
            e.preventDefault();
            commit(draft.slice(0, -2));
          }
        }}
        onBlur={() => {
          if (draft && displayToIso(draft) === "") onChange("");
        }}
        maxLength={10}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className={cn("h-11", error && "border-destructive focus-visible:ring-destructive")}
      />

      {!error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t("finance.fields.birthDateHint", { defaultValue: "Format : JJ/MM/AAAA" })}
        </p>
      )}

      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
