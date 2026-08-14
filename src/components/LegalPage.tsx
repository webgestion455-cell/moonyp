import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { LegalLayout } from "@/components/LegalLayout";

interface LegalSection {
  h?: string;
  p?: string;
  list?: string[];
}

interface Props {
  i18nKey: string;
  updated?: string;
  showSubtitle?: boolean;
}

/**
 * Generic legal page renderer.
 * Expects `legal.{slug}.title`, `legal.{slug}.subtitle` (optional)
 * and `legal.{slug}.sections` as an array of { h, p, list }.
 */
export function LegalPage({ i18nKey, updated, showSubtitle = true }: Props) {
  const { t } = useTranslation();
  const sections = (t(`${i18nKey}.sections`, { returnObjects: true }) as LegalSection[]) || [];
  const safeSections = Array.isArray(sections) ? sections : [];
  const subtitle = showSubtitle ? (t(`${i18nKey}.subtitle`, { defaultValue: "" }) as string) : "";

  return (
    <LegalLayout
      title={t(`${i18nKey}.title`)}
      subtitle={subtitle || undefined}
      updated={updated}
    >
      {safeSections.map((s, i) => (
        <Fragment key={i}>
          {s.h && <h2>{s.h}</h2>}
          {s.p && <p dangerouslySetInnerHTML={{ __html: s.p }} />}
          {s.list && (
            <ul>
              {s.list.map((li, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: li }} />
              ))}
            </ul>
          )}
        </Fragment>
      ))}
    </LegalLayout>
  );
}
