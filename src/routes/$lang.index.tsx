import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/use-lang";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ShieldCheck,
  Zap,
  ArrowRight,
  Lock,
  Wallet,
  FileSignature,
  Smartphone,
  Globe2,
  Headphones,
  TrendingUp,
  Star,
  Quote,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import i18n from "@/i18n";
import heroImg from "@/assets/moonyp-hero.jpg";
import dashboardImg from "@/assets/moonyp-dashboard.jpg";
import mobileImg from "@/assets/moonyp-mobile.jpg";
import securityImg from "@/assets/moonyp-security.jpg";

export const Route = createFileRoute("/$lang/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: i18n.t("landing.metaTitle") },
      { name: "description", content: i18n.t("landing.metaDesc") },
      { property: "og:title", content: i18n.t("landing.metaTitle") },
      { property: "og:description", content: i18n.t("landing.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const PARTNER_BANKS = [
  "Société Générale",
  "Crédit Agricole",
  "ING",
  "Revolut",
  "N26",
  "Boursorama",
  "LCL",
  "Caisse d'Épargne",
  "Crédit Mutuel",
  "Deutsche Bank",
  "Santander",
];

function Landing() {
  const { t } = useTranslation();
  const lang = useLang();

  const slides = [
    { img: heroImg, title: t("landing.slides.s1t"), desc: t("landing.slides.s1d") },
    { img: dashboardImg, title: t("landing.slides.s2t"), desc: t("landing.slides.s2d") },
    { img: mobileImg, title: t("landing.slides.s3t"), desc: t("landing.slides.s3d") },
    { img: securityImg, title: t("landing.slides.s4t"), desc: t("landing.slides.s4d") },
  ];

  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCurrent((c) => (c + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, [slides.length]);

  const steps = [
    { Icon: FileSignature, title: t("landing.how.s1t"), desc: t("landing.how.s1d") },
    { Icon: CheckCircle2, title: t("landing.how.s2t"), desc: t("landing.how.s2d") },
    { Icon: ShieldCheck, title: t("landing.how.s3t"), desc: t("landing.how.s3d") },
    { Icon: Wallet, title: t("landing.how.s4t"), desc: t("landing.how.s4d") },
  ];

  const values = [
    {
      Icon: Zap,
      title: t("landing.values.response.title"),
      desc: t("landing.values.response.desc"),
    },
    {
      Icon: ShieldCheck,
      title: t("landing.values.secure.title"),
      desc: t("landing.values.secure.desc"),
    },
    {
      Icon: CheckCircle2,
      title: t("landing.values.nofees.title"),
      desc: t("landing.values.nofees.desc"),
    },
  ];

  const kpis = [
    { v: "2.4M+", l: t("landing.kpis.clients") },
    { v: "150+", l: t("landing.kpis.countries") },
    { v: "€48Md", l: t("landing.kpis.assets") },
    { v: "99.99%", l: t("landing.kpis.uptime") },
  ];

  const securityFeatures = [
    { Icon: Lock, title: t("landing.security.f1t"), desc: t("landing.security.f1d") },
    { Icon: ShieldCheck, title: t("landing.security.f2t"), desc: t("landing.security.f2d") },
    { Icon: Smartphone, title: t("landing.security.f3t"), desc: t("landing.security.f3d") },
    { Icon: Headphones, title: t("landing.security.f4t"), desc: t("landing.security.f4d") },
  ];

  const testimonials = [
    { name: t("landing.testi.t1n"), role: t("landing.testi.t1r"), quote: t("landing.testi.t1q") },
    { name: t("landing.testi.t2n"), role: t("landing.testi.t2r"), quote: t("landing.testi.t2q") },
    { name: t("landing.testi.t3n"), role: t("landing.testi.t3r"), quote: t("landing.testi.t3q") },
  ];

  const faqs = [
    { q: t("landing.faq.q1"), a: t("landing.faq.a1") },
    { q: t("landing.faq.q2"), a: t("landing.faq.a2") },
    { q: t("landing.faq.q3"), a: t("landing.faq.a3") },
    { q: t("landing.faq.q4"), a: t("landing.faq.a4") },
  ];

  return (
    <div className="flex min-w-0 flex-col overflow-x-hidden">
      {/* Hero with carousel */}
      <section className="relative overflow-hidden bg-hero">
        <div className="container relative z-10 mx-auto grid max-w-7xl gap-10 px-3 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
          <div className="flex min-w-0 flex-col justify-center">
            <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur sm:px-4">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="min-w-0 break-words">{t("landing.badge")}</span>
            </div>

            <h1 className="mt-6 max-w-2xl break-words font-serif text-3xl font-medium leading-[1.1] tracking-tight text-foreground sm:text-4xl md:text-5xl xl:text-6xl">
              {t("landing.heroTitleA")}
              <br />
              <span className="text-gradient">{t("landing.heroTitleB")}</span>
            </h1>

            <p className="mt-6 max-w-xl break-words text-base leading-relaxed text-muted-foreground md:text-lg">
              {t("landing.heroDesc")}
            </p>

            <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                asChild
                size="lg"
                className="h-12 w-full rounded-full px-6 text-sm shadow-glow sm:h-14 sm:w-auto sm:px-8 sm:text-base"
              >
                <Link
                  to="/$lang/apply"
                  params={{ lang }}
                  search={{ product: undefined, amount: undefined, months: undefined }}
                >
                  {t("landing.ctaPrimary")}
                  <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
                </Link>
              </Button>

              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 w-full rounded-full bg-card px-6 text-sm sm:h-14 sm:w-auto sm:px-8 sm:text-base"
              >
                <Link to="/$lang/simulation" params={{ lang }} search={{ product: undefined }}>
                  {t("landing.ctaSecondary")}
                </Link>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-start gap-x-5 gap-y-3 text-sm text-muted-foreground sm:gap-x-6">
              <div className="flex min-w-0 items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="break-words">{t("landing.trust1")}</span>
              </div>

              <div className="flex min-w-0 items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="break-words">{t("landing.trust2")}</span>
              </div>

              <div className="flex min-w-0 items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="break-words">{t("landing.trust3")}</span>
              </div>
            </div>
          </div>

          {/* Carousel */}
          <div className="relative min-w-0">
            <div className="relative aspect-[4/3] min-h-[220px] overflow-hidden rounded-2xl border border-border bg-card shadow-card sm:min-h-[320px] lg:min-h-[500px] lg:rounded-3xl">
              {slides.map((s, i) => (
                <div
                  key={i}
                  className={`absolute inset-0 transition-opacity duration-1000 ${
                    i === current ? "opacity-100" : "opacity-0"
                  }`}
                  aria-hidden={i !== current}
                >
                  <img
                    src={s.img}
                    alt={s.title}
                    className="h-full w-full object-cover"
                    loading={i === 0 ? "eager" : "lazy"}
                    width={1536}
                    height={896}
                  />

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 text-white sm:p-6">
                    <h3 className="break-words font-serif text-lg font-medium sm:text-xl md:text-2xl">
                      {s.title}
                    </h3>
                    <p className="mt-1 break-words text-sm leading-relaxed text-white/80">
                      {s.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-center gap-2">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`slide ${i + 1}`}
                  onClick={() => setCurrent(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === current ? "w-8 bg-accent" : "w-2 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="border-y border-border bg-card py-12">
        <div className="container mx-auto grid max-w-6xl grid-cols-2 gap-6 px-3 sm:gap-8 sm:px-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.l} className="min-w-0 text-center">
              <div className="break-words font-serif text-3xl font-medium text-primary md:text-4xl">
                {k.v}
              </div>
              <div className="mt-1 break-words text-xs uppercase leading-tight tracking-wider text-muted-foreground">
                {k.l}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Value Props */}
      <section className="bg-background py-20">
        <div className="container mx-auto px-3 sm:px-4">
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-3">
            {values.map(({ Icon, title, desc }) => (
              <div key={title} className="min-w-0 space-y-4 text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Icon size={32} />
                </div>
                <h3 className="break-words font-serif text-xl font-medium text-foreground">
                  {title}
                </h3>
                <p className="break-words leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security section */}
      <section className="bg-surface py-20 sm:py-24">
        <div className="container mx-auto grid max-w-6xl gap-10 px-3 sm:gap-12 sm:px-4 md:grid-cols-2 md:items-center">
          <div className="relative overflow-hidden rounded-3xl border border-border shadow-card">
            <img
              src={dashboardImg}
              alt={t("landing.security.title")}
              className="h-full w-full object-cover"
              loading="lazy"
              width={1536}
              height={896}
            />
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              {t("landing.security.eyebrow")}
            </p>

            <h2 className="mt-3 break-words font-serif text-3xl font-medium text-foreground md:text-4xl">
              {t("landing.security.title")}
            </h2>

            <p className="mt-4 break-words leading-relaxed text-muted-foreground">
              {t("landing.security.desc")}
            </p>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {securityFeatures.map(({ Icon, title, desc }) => (
                <div key={title} className="flex min-w-0 gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="break-words font-semibold text-foreground">{title}</h4>
                    <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
                      {desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-background py-20 sm:py-24">
        <div className="container mx-auto max-w-4xl px-3 sm:px-4">
          <h2 className="break-words text-center font-serif text-3xl font-medium text-primary sm:text-4xl md:text-5xl">
            {t("landing.how.title")}
          </h2>

          <div className="relative mt-12 space-y-8 before:absolute before:inset-0 before:ml-5 before:h-full before:w-0.5 before:-translate-x-px before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent sm:mt-16 md:before:mx-auto md:before:translate-x-0">
            {steps.map((step, i) => (
              <div
                key={i}
                className="group relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse"
              >
                <div className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-background bg-primary font-bold text-primary-foreground shadow-md md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                  {i + 1}
                </div>

                <div className="min-w-0 w-[calc(100%-3rem)] rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-accent/40 sm:p-6 md:w-[calc(50%-2.5rem)]">
                  <div className="mb-2 flex min-w-0 items-start gap-2">
                    <step.Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <h4 className="min-w-0 break-words font-semibold">{step.title}</h4>
                  </div>

                  <p className="break-words text-sm leading-relaxed text-muted-foreground">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-surface py-20 sm:py-24">
        <div className="container mx-auto max-w-6xl px-3 sm:px-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("landing.testi.eyebrow")}
            </p>

            <h2 className="mt-4 break-words font-serif text-3xl font-medium text-foreground md:text-4xl">
              {t("landing.testi.title")}
            </h2>
          </div>

          <div className="mt-10 grid gap-6 sm:mt-12 md:grid-cols-2 xl:grid-cols-3">
            {testimonials.map((tm) => (
              <div
                key={tm.name}
                className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-8"
              >
                <Quote className="h-6 w-6 text-accent" />

                <p className="mt-4 break-words leading-relaxed text-foreground">
                  "{tm.quote}"
                </p>

                <div className="mt-6 flex items-center gap-1 text-accent">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  <div className="break-words font-semibold text-foreground">{tm.name}</div>
                  <div className="break-words text-sm text-muted-foreground">{tm.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mobile app */}
      <section className="bg-background py-20 sm:py-24">
        <div className="container mx-auto grid max-w-6xl gap-10 px-3 sm:gap-12 sm:px-4 md:grid-cols-2 md:items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              {t("landing.mobile.eyebrow")}
            </p>

            <h2 className="mt-3 break-words font-serif text-3xl font-medium text-foreground md:text-4xl">
              {t("landing.mobile.title")}
            </h2>

            <p className="mt-4 break-words leading-relaxed text-muted-foreground">
              {t("landing.mobile.desc")}
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex min-w-0 items-start gap-3">
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="break-words">{t("landing.mobile.b1")}</span>
              </li>

              <li className="flex min-w-0 items-start gap-3">
                <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="break-words">{t("landing.mobile.b2")}</span>
              </li>

              <li className="flex min-w-0 items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="break-words">{t("landing.mobile.b3")}</span>
              </li>
            </ul>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-border shadow-card">
            <img
              src={mobileImg}
              alt={t("landing.mobile.title")}
              className="h-full w-full object-cover"
              loading="lazy"
              width={1536}
              height={896}
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-surface py-20 sm:py-24">
        <div className="container mx-auto max-w-3xl px-3 sm:px-4">
          <h2 className="break-words text-center font-serif text-3xl font-medium text-foreground md:text-4xl">
            {t("landing.faq.title")}
          </h2>

          <div className="mt-10 space-y-4 sm:mt-12">
            {faqs.map((f, i) => (
              <details
                key={i}
                className="group rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6"
              >
                <summary className="flex cursor-pointer items-start justify-between gap-3 font-semibold text-foreground">
                  <span className="min-w-0 break-words">{f.q}</span>
                  <span className="shrink-0 text-accent transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>

                <p className="mt-4 break-words text-sm leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Partner banks */}
      <section className="border-t border-border bg-background py-16 sm:py-20">
        <div className="container mx-auto max-w-6xl px-3 sm:px-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("landing.partners.eyebrow")}
            </p>

            <h2 className="mt-4 break-words font-serif text-3xl font-medium text-foreground md:text-4xl">
              {t("landing.partners.title")}
            </h2>

            <p className="mx-auto mt-4 max-w-xl break-words text-sm leading-relaxed text-muted-foreground">
              {t("landing.partners.desc")}
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:mt-12 sm:grid-cols-3 xl:grid-cols-6">
            {PARTNER_BANKS.map((bank) => (
              <div
                key={bank}
                className="flex min-w-0 items-center justify-center break-words bg-card px-3 py-6 text-center text-sm font-semibold leading-tight text-muted-foreground transition-colors hover:bg-surface hover:text-foreground sm:px-4 sm:py-8"
              >
                {bank}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-wallet py-16 text-center text-white sm:py-20">
        <div className="container mx-auto px-3 sm:px-4">
          <h2 className="break-words font-serif text-2xl font-medium leading-tight sm:text-3xl lg:text-5xl">
            {t("landing.finalCta.title")}
          </h2>

          <p className="mx-auto mt-4 max-w-xl break-words leading-relaxed text-white/70">
            {t("landing.finalCta.desc")}
          </p>

          <Button
            asChild
            size="lg"
            variant="secondary"
            className="mt-8 h-14 w-full max-w-sm rounded-full bg-white px-8 text-base font-semibold text-primary hover:bg-white/90 sm:w-auto"
          >
            <Link
              to="/$lang/apply"
              params={{ lang }}
              search={{ product: undefined, amount: undefined, months: undefined }}
            >
              {t("landing.finalCta.button")}
              <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="border-t border-border bg-card py-14 sm:py-16">
        <div className="container mx-auto grid max-w-6xl gap-10 px-3 sm:gap-12 sm:px-4 md:grid-cols-2 md:items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              {t("contactSection.eyebrow", "Support")}
            </p>

            <h2 className="mt-3 break-words font-serif text-3xl font-medium text-foreground md:text-4xl">
              {t("contactSection.title", "Get in touch")}
            </h2>

            <p className="mt-4 break-words leading-relaxed text-muted-foreground">
              {t("contactSection.desc", "Our advisors answer within one business hour.")}
            </p>
          </div>

          <div className="min-w-0 rounded-3xl border border-border bg-background p-5 shadow-card sm:p-8">
            <ul className="space-y-3 text-sm">
              <li className="flex min-w-0 items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <a
                  href="mailto:support@moonyp.com"
                  className="min-w-0 break-all hover:text-accent"
                >
                  support@moonyp.com
                </a>
              </li>

              <li className="flex min-w-0 items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <a
                  href="tel:+393500366867"
                  className="min-w-0 break-all hover:text-accent"
                >
                  +39 350 036 6867
                </a>
              </li>

              <li className="flex min-w-0 items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0 break-words leading-relaxed">
                  1 Centenary Square, Birmingham, B1 2DR, United Kingdom
                </span>
              </li>
            </ul>

            <Button asChild className="mt-6 w-full rounded-full">
              <Link to="/$lang/contact" params={{ lang }}>
                {t("contactSection.cta", "Open contact form")}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

