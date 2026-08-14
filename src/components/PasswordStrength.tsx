import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { checkPassword, passwordScore } from "@/lib/password";
import { cn } from "@/lib/utils";

type Props = { password: string };

export function PasswordStrength({ password }: Props) {
  const { t } = useTranslation();
  const score = passwordScore(password);
  const checks = checkPassword(password);

  const labels = [
    t("password.veryWeak"),
    t("password.weak"),
    t("password.fair"),
    t("password.good"),
    t("password.strong"),
    t("password.excellent"),
  ];
  const colors = [
    "bg-destructive",
    "bg-destructive",
    "bg-orange-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-emerald-600",
  ];

  if (!password) return null;

  const items: Array<{ ok: boolean; label: string }> = [
    { ok: checks.length, label: t("password.ruleLength") },
    { ok: checks.upper, label: t("password.ruleUpper") },
    { ok: checks.lower, label: t("password.ruleLower") },
    { ok: checks.digit, label: t("password.ruleDigit") },
    { ok: checks.special, label: t("password.ruleSpecial") },
  ];

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < score ? colors[score] : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{labels[score]}</span>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {items.map((it) => (
          <li
            key={it.label}
            className={cn(
              "flex items-center gap-1.5 text-[11px]",
              it.ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {it.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            <span>{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
