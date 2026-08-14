import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Suggestion {
  display_name: string;
  place_id: number;
}

interface Props {
  name: string;
  id?: string;
  defaultValue?: string;
  required?: boolean;
  label?: string;
  placeholder?: string;
}

/**
 * Champ d'adresse professionnel avec suggestions automatiques.
 * Utilise Nominatim (OpenStreetMap) — service public gratuit, sans clé API.
 * L'utilisateur peut aussi saisir manuellement s'il ne trouve pas son adresse.
 */
export function AddressAutocomplete({ name, id, defaultValue = "", required, label, placeholder }: Props) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setValue(q);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const lang = (i18n.language || "fr").split("-")[0];
        // Photon (Komoot) — geocoder public gratuit basé sur OSM, CORS activé, sans clé API.
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=${lang}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("network");
        const json = (await res.json()) as { features?: Array<{ properties: Record<string, string>; geometry?: { coordinates: [number, number] } }> };
        const feats = json.features ?? [];
        const list: Suggestion[] = feats.map((f, i) => {
          const p = f.properties || {};
          const parts = [
            [p.housenumber, p.street].filter(Boolean).join(" "),
            [p.postcode, p.city || p.town || p.village].filter(Boolean).join(" "),
            p.state,
            p.country,
          ].filter(Boolean);
          const display = parts.join(", ") || p.name || "";
          return { display_name: display, place_id: i };
        }).filter((s) => s.display_name);
        setSuggestions(list);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function pick(s: Suggestion) {
    setValue(s.display_name);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      {label && <Label htmlFor={id ?? name}>{label}</Label>}
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id ?? name}
          name={name}
          value={value}
          onChange={onChange}
          onFocus={() => value.length >= 3 && setOpen(true)}
          required={required}
          placeholder={placeholder ?? t("loanForm.addressPlaceholder")}
          className="h-11 pl-9"
          autoComplete="street-address"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {open && suggestions.length > 0 && (
          <ul className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-elevated">
            {suggestions.map((s) => (
              <li key={s.place_id}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="line-clamp-2">{s.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("loanForm.addressHint")}</p>
    </div>
  );
}
