import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AsYouType, parsePhoneNumberFromString, getExampleNumber } from "libphonenumber-js";
import examples from "libphonenumber-js/examples.mobile.json";
import type { CountryCode } from "libphonenumber-js";
import { Check, ChevronDown, Search } from "lucide-react";
import { COUNTRIES, countryByCode, countryName, flagUrl, searchCountries } from "@/lib/countries";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface PhoneValue {
  /** E.164 when valid, otherwise the raw national digits typed so far. */
  value: string;
  country: string;
}

interface Props {
  id: string;
  label: string;
  value: string;
  country: string;
  /** Country hints already collected earlier in the journey. */
  hints?: Array<string | null | undefined>;
  onChange: (next: PhoneValue) => void;
  error?: string;
  required?: boolean;
}

export function isValidPhone(value: string, country?: string): boolean {
  if (!value) return false;
  const parsed = parsePhoneNumberFromString(
    value,
    (country || undefined) as CountryCode | undefined,
  );
  return Boolean(parsed?.isValid());
}

/** Normalises any input to E.164 — the only format we persist. */
export function toE164(value: string, country?: string): string | null {
  const parsed = parsePhoneNumberFromString(
    value,
    (country || undefined) as CountryCode | undefined,
  );
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * International phone input: SVG flag, dial code, searchable country list
 * (every country in the world), live formatting and real validation via
 * libphonenumber. The initial country is inferred from data the applicant has
 * already provided (address country, then nationality) but stays editable.
 */
export function PhoneField({
  id,
  label,
  value,
  country,
  hints = [],
  onChange,
  error,
  required,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const touched = useRef(false);

  const active = countryByCode(country) ?? countryByCode("FR")!;
  const results = useMemo(() => searchCountries(query, locale), [query, locale]);

  // Auto-select from the applicant's own data until they pick a country.
  useEffect(() => {
    if (touched.current) return;
    const hint = hints.find((h) => h && countryByCode(h));
    if (hint) {
      const code = countryByCode(hint)!.code;
      if (code !== country) onChange({ value, country: code });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hints.join("|")]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const national = useMemo(() => {
    if (!value) return "";
    const parsed = parsePhoneNumberFromString(value, active.code as CountryCode);
    if (parsed) return parsed.formatNational().replace(/^0?\s*/, (m) => m);
    return value;
  }, [value, active.code]);

  const [draft, setDraft] = useState(national);
  useEffect(() => {
    setDraft(national);
  }, [national]);

  const placeholder = useMemo(() => {
    try {
      const ex = getExampleNumber(active.code as CountryCode, examples as never);
      return ex ? ex.formatNational() : "";
    } catch {
      return "";
    }
  }, [active.code]);

  const valid = isValidPhone(value, active.code);

  const commit = (raw: string) => {
    const formatter = new AsYouType(active.code as CountryCode);
    const shown = formatter.input(raw);
    setDraft(shown);
    const parsed = parsePhoneNumberFromString(raw, active.code as CountryCode);
    onChange({ value: parsed?.isValid() ? parsed.number : raw, country: active.code });
  };

  const pickCountry = (code: string) => {
    touched.current = true;
    setOpen(false);
    const digits = draft.replace(/\D+/g, "");
    const parsed = digits ? parsePhoneNumberFromString(digits, code as CountryCode) : null;
    onChange({ value: parsed?.isValid() ? parsed.number : digits, country: code });
  };

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <Label htmlFor={id} className="text-sm">
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>

      <div className="relative">
        <div
          className={cn(
            "flex h-11 items-stretch overflow-hidden rounded-md border bg-background transition-colors",
            error ? "border-destructive" : "border-input focus-within:border-ring",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={t("finance.fields.phoneCountry")}
            aria-expanded={open}
            className="flex shrink-0 items-center gap-1.5 border-r border-input px-2.5 text-sm transition-colors hover:bg-muted"
          >
            <img
              src={flagUrl(active.code)}
              alt=""
              width={22}
              height={16}
              className="h-4 w-[22px] rounded-[2px] object-cover ring-1 ring-border"
            />
            <span className="tabular-nums text-muted-foreground">{active.dial}</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          <input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => commit(e.target.value)}
            aria-invalid={Boolean(error)}
            className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />

          {value.length > 3 && (
            <span className="flex shrink-0 items-center pr-3">
              <span
                className={cn("h-2 w-2 rounded-full", valid ? "bg-success" : "bg-warning")}
                aria-label={
                  valid
                    ? t("finance.validation.phoneValid")
                    : t("finance.validation.phoneIncomplete")
                }
              />
            </span>
          )}
        </div>

        {open && (
          <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const c = results[highlight];
                    if (c) pickCountry(c.code);
                  } else if (e.key === "Escape") setOpen(false);
                }}
                placeholder={t("finance.fields.searchCountry")}
                aria-label={t("finance.fields.searchCountry")}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
              {results.map((c, index) => (
                <li key={c.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.code === active.code}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pickCountry(c.code)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
                      index === highlight && "bg-muted",
                    )}
                  >
                    <img
                      src={flagUrl(c.code)}
                      alt=""
                      width={22}
                      height={16}
                      loading="lazy"
                      className="h-4 w-[22px] shrink-0 rounded-[2px] object-cover ring-1 ring-border"
                    />
                    <span className="min-w-0 flex-1 truncate">{countryName(c.code, locale)}</span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {c.dial}
                    </span>
                    {c.code === active.code && (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("common.noResults")}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { COUNTRIES };
