import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CountrySelect } from "@/components/finance/CountrySelect";
import { resolveCountryCode } from "@/lib/countries";
import { cn } from "@/lib/utils";

export interface AddressValue {
  address: string;
  postal_code: string;
  city: string;
  country: string;
}

interface Suggestion {
  id: string;
  line: string;
  secondary: string;
  value: AddressValue;
}

interface Props {
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  errors?: Partial<Record<keyof AddressValue, string>>;
}

interface PhotonFeature {
  properties: Record<string, string | undefined>;
}

const PHOTON = "https://photon.komoot.io/api/";

function toSuggestion(feature: PhotonFeature, index: number): Suggestion | null {
  const p = feature.properties ?? {};
  const street = [p.housenumber, p.street ?? p.name].filter(Boolean).join(" ").trim();
  const city = p.city ?? p.town ?? p.village ?? p.county ?? "";
  const postal = p.postcode ?? "";
  const countryCode = resolveCountryCode(p.countrycode ?? p.country) ?? "";
  if (!street && !city) return null;
  return {
    id: `${p.osm_id ?? index}-${index}`,
    line: street || city,
    secondary: [postal, city, p.country].filter(Boolean).join(", "),
    value: {
      address: street || city,
      postal_code: postal,
      city,
      country: countryCode,
    },
  };
}

/**
 * Worldwide address entry. Every field is visible from the start — the
 * applicant simply types their street and live suggestions appear underneath,
 * filling postcode, city and country on selection. A discreet manual notice is
 * only surfaced when the lookup returns nothing (or is unreachable).
 */
export function AddressField({ value, onChange, errors = {} }: Props) {
  const { t, i18n } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [noResult, setNoResult] = useState(false);
  const [picked, setPicked] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function search(q: string) {
    onChange({ address: q });
    setPicked(false);
    setNoResult(false);
    setHighlight(-1);
    setOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const lang = (i18n.resolvedLanguage || "en").split("-")[0]!;
        const supported = ["en", "de", "fr", "it"].includes(lang) ? lang : "en";
        const params = new URLSearchParams({ q, limit: "6", lang: supported });
        if (value.country) params.set("countrycode", value.country.toLowerCase());
        const res = await fetch(`${PHOTON}?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("network");
        const json = (await res.json()) as { features?: PhotonFeature[] };
        const list = (json.features ?? [])
          .map(toSuggestion)
          .filter((s): s is Suggestion => s !== null)
          .filter(
            (s, i, arr) =>
              arr.findIndex((o) => o.line === s.line && o.secondary === s.secondary) === i,
          );
        setSuggestions(list);
        setNoResult(list.length === 0);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setSuggestions([]);
        setNoResult(true);
      } finally {
        setLoading(false);
      }
    }, 280);
  }

  const choose = (s: Suggestion) => {
    onChange({
      address: s.value.address,
      postal_code: s.value.postal_code || value.postal_code,
      city: s.value.city || value.city,
      country: s.value.country || value.country,
    });
    setSuggestions([]);
    setOpen(false);
    setPicked(true);
    setNoResult(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5" ref={boxRef}>
        <Label htmlFor="address" className="text-sm">
          {t("finance.fields.address")}
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        </Label>
        <div className="relative">
          <MapPin
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="address"
            value={value.address}
            onChange={(e) => search(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (!open || suggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter" && highlight >= 0) {
                e.preventDefault();
                choose(suggestions[highlight]!);
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder={t("finance.fields.addressPlaceholder")}
            autoComplete="street-address"
            aria-invalid={Boolean(errors.address)}
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
            className="h-11 pl-9 pr-9"
          />
          {loading && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          )}

          {open && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
            >
              {suggestions.map((s, index) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(s)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                      index === highlight && "bg-muted",
                    )}
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.line}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.secondary}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {errors.address && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {errors.address}
          </p>
        )}

        {/* Discreet fallback: only after a lookup came back empty. */}
        {noResult && !picked && value.address.trim().length >= 3 && !loading && (
          <p className="text-xs text-muted-foreground">{t("finance.fields.addressNoMatch")}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="postal_code" className="text-sm">
            {t("finance.fields.postalCode")}
            <span className="ml-1 text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="postal_code"
            value={value.postal_code}
            onChange={(e) => onChange({ postal_code: e.target.value })}
            autoComplete="postal-code"
            aria-invalid={Boolean(errors.postal_code)}
            className="h-11"
          />
          {errors.postal_code && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.postal_code}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="city" className="text-sm">
            {t("finance.fields.city")}
            <span className="ml-1 text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="city"
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
            autoComplete="address-level2"
            aria-invalid={Boolean(errors.city)}
            className="h-11"
          />
          {errors.city && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.city}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <CountrySelect
            id="country"
            required
            label={t("finance.fields.country")}
            value={value.country}
            onChange={(code) => onChange({ country: code })}
            error={errors.country}
          />
        </div>
      </div>
    </div>
  );
}
