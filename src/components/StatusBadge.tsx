import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  APPLICATION_STATUS_VARIANT,
  statusLabel,
  type ApplicationStatus,
} from "@/lib/application-status";

const VARIANT_STYLES: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/25",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  // re-render when the language changes
  useTranslation();
  const variant = APPLICATION_STATUS_VARIANT[status] ?? "default";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        VARIANT_STYLES[variant],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {statusLabel(status)}
    </span>
  );
}
