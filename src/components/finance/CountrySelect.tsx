import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search } from "lucide-react";
import { COUNTRIES, countryName, flagUrl, searchCountries } from "@/lib/countries";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  label: string;
  /** ISO 3166-1 alpha-2 code. */
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

/**
 * Searchable country combobox covering every ISO 3166-1 territory, with
 * SVG flags and accent-insensitive instant search. Keyboard accessible.
 */
export function CountrySelect({ id, label, value, onChange, placeholder, error, required, className }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => searchCountries(query, locale), [query, locale]);
  const selected = COUNTRIES.find((c) => c.code === value?.toUpperCase());

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
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const node = listRef.current?.children[highlight] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div className={cn("space-y-1.5", className)} ref={boxRef}>
      <Label htmlFor={id} className="text-sm">
        {label}
        {required && <span className="ml-1 text-destructive" aria-hidden>*</span>}
      </Label>

      <div className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          className={cn(
            "flex h-11 w-full items-center gap-2.5 rounded-md border bg-background px-3 text-left text-sm transition-colors",
            error ? "border-destructive" : "border-input hover:border-ring/60",
          )}
        >
          {selected ? (
            <>
              <img
                src={flagUrl(selected.code)}
                alt=""
                width={22}
                height={16}
                loading="lazy"
                className="h-4 w-[22px] shrink-0 rounded-[2px] object-cover ring-1 ring-border"
              />
              <span className="min-w-0 flex-1 truncate">{countryName(selected.code, locale)}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {placeholder ?? t("finance.fields.chooseCountry")}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>

        {open && (
          <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); const c = results[highlight]; if (c) pick(c.code); }
                  else if (e.key === "Escape") setOpen(false);
                }}
                placeholder={t("finance.fields.searchCountry")}
                aria-label={t("finance.fields.searchCountry")}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul ref={listRef} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</li>
              )}
              {results.map((c, index) => {
                const active = c.code === value?.toUpperCase();
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(c.code)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                        index === highlight && "bg-muted",
                        active && "font-medium",
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
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.code}</span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
