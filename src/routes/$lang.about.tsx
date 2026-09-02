import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/use-lang";
import {
  ArrowRight,
  Award,
  Building2,
  Globe2,
  HeartHandshake,
  Landmark,
  Lock,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import hqImg from "@/assets/moonyp-about-hq.jpg";
import securityImg from "@/assets/moonyp-security.jpg";
import dashboardImg from "@/assets/moonyp-dashboard.jpg";

export const Route = createFileRoute("/$lang/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: i18n.t("about.metaTitle") },
      { name: "description", content: i18n.t("about.metaDesc") },
      { property: "og:title", content: i18n.t("about.metaTitle") },
      { property: "og:description", content: i18n.t("about.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function AboutPage() {
  const { t } = useTranslation();
  const lang = useLang();

  const kpis = [
    { v: "2.4M+", l: t("about.kpis.clients") },
    { v: "150+", l: t("about.kpis.countries") },
    { v: "€48Md", l: t("about.kpis.financed") },
    { v: "99.99%", l: t("about.kpis.uptime") },
  ];

  const values = [
    { Icon: ShieldCheck, title: t("about.values.v1t"), desc: t("about.values.v1d") },
    { Icon: Sparkles, title: t("about.values.v2t"), desc: t("about.values.v2d") },
    { Icon: HeartHandshake, title: t("about.values.v3t"), desc: t("about.values.v3d") },
    { Icon: Globe2, title: t("about.values.v4t"), desc: t("about.values.v4d") },
  ];

  const timeline = [
    { y: "2016", t: t("about.timeline.y1t"), d: t("about.timeline.y1d") },
    { y: "2019", t: t("about.timeline.y2t"), d: t("about.timeline.y2d") },
    { y: "2022", t: t("about.timeline.y3t"), d: t("about.timeline.y3d") },
    { y: "2026", t: t("about.timeline.y4t"), d: t("about.timeline.y4d") },
  ];

  const governance = [
    { Icon: Landmark, title: t("about.governance.g1t"), desc: t("about.governance.g1d") },
    { Icon: Lock, title: t("about.governance.g2t"), desc: t("about.governance.g2d") },
    { Icon: Award, title: t("about.governance.g3t"), desc: t("about.governance.g3d") },
    { Icon: Users, title: t("about.governance.g4t"), desc: t("about.governance.g4d") },
  ];

  return (
    <div className="flex flex-col overflow-x-hidden">
      {/* Hero */}
      <section className="border-b border-border bg-hero">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8 lg:py-20">
          <div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <Building2 className="h-3.5 w-3.5 text-accent" aria-hidden />
              {t("about.eyebrow")}
            </div>
            <h1 className="mt-6 font-serif text-3xl font-medium leading-[1.12] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              {t("about.title")}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">{t("about.intro")}</p>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">{t("about.intro2")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 rounded-full px-7 text-sm font-semibold">
                <Link to="/$lang/apply" params={{ lang }} search={{ product: undefined, amount: undefined, months: undefined }}>
                  {t("about.ctaPrimary")}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-7 text-sm font-semibold">
                <Link to="/$lang/contact" params={{ lang }}>{t("about.ctaSecondary")}</Link>
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border shadow-card">
            <img
              src={hqImg}
              alt={t("about.hqAlt")}
              width={1536}
              height={896}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.l} className="bg-card px-4 py-8 text-center sm:px-6">
              <div className="font-serif text-2xl font-medium text-foreground sm:text-3xl">{k.v}</div>
              <div className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground sm:text-xs">{k.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Mission */}
      <section className="bg-background py-16 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8">
          <div className="order-2 overflow-hidden rounded-3xl border border-border shadow-card lg:order-1">
            <img src={dashboardImg} alt={t("about.missionAlt")} loading="lazy" className="h-full w-full object-cover" />
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t("about.mission.eyebrow")}</p>
            <h2 className="mt-3 font-serif text-2xl font-medium text-foreground sm:text-3xl lg:text-4xl">
              {t("about.mission.title")}
            </h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">{t("about.mission.p1")}</p>
            <p className="mt-4 leading-relaxed text-muted-foreground">{t("about.mission.p2")}</p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-y border-border bg-surface py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("about.values.eyebrow")}</p>
            <h2 className="mt-3 font-serif text-2xl font-medium text-foreground sm:text-3xl lg:text-4xl">{t("about.values.title")}</h2>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {values.map((v) => (
              <div key={v.title} className="rounded-2xl border border-border bg-card p-6 shadow-card transition-transform duration-300 hover:-translate-y-1">
                <v.Icon className="h-6 w-6 text-accent" aria-hidden />
                <h3 className="mt-4 font-semibold text-foreground">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="bg-background py-16 lg:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="font-serif text-2xl font-medium text-foreground sm:text-3xl lg:text-4xl">{t("about.timeline.title")}</h2>
          <ol className="mt-10 space-y-8 border-l border-border pl-6">
            {timeline.map((item) => (
              <li key={item.y} className="relative">
                <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-accent bg-background" aria-hidden />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{item.y}</p>
                <h3 className="mt-1.5 font-semibold text-foreground">{item.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Governance & compliance */}
      <section className="border-t border-border bg-surface py-16 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t("about.governance.eyebrow")}</p>
            <h2 className="mt-3 font-serif text-2xl font-medium text-foreground sm:text-3xl lg:text-4xl">{t("about.governance.title")}</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">{t("about.governance.desc")}</p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {governance.map((g) => (
                <div key={g.title}>
                  <g.Icon className="h-5 w-5 text-accent" aria-hidden />
                  <h3 className="mt-3 text-sm font-semibold text-foreground">{g.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{g.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border shadow-card">
            <img src={securityImg} alt={t("about.governanceAlt")} loading="lazy" className="h-full w-full object-cover" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-wallet py-16 text-center text-white lg:py-20">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="font-serif text-2xl font-medium leading-tight sm:text-3xl lg:text-4xl">{t("about.cta.title")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-white/70 sm:text-base">{t("about.cta.desc")}</p>
          <Button asChild size="lg" variant="secondary" className="mt-8 h-13 rounded-full bg-white px-8 text-base font-semibold text-primary hover:bg-white/90">
            <Link to="/$lang/apply" params={{ lang }} search={{ product: undefined, amount: undefined, months: undefined }}>
              {t("about.cta.button")}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
