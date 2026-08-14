import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
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

export const Route = createFileRoute("/")({
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
  "Société Générale", "Crédit Agricole", "ING", "Revolut", "N26",
  "Boursorama", "LCL", "Caisse d'Épargne", "Crédit Mutuel", "Deutsche Bank", "Santander",
];

function Landing() {
  const { t } = useTranslation();

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
    { Icon: Zap, title: t("landing.values.response.title"), desc: t("landing.values.response.desc") },
    { Icon: ShieldCheck, title: t("landing.values.secure.title"), desc: t("landing.values.secure.desc") },
    { Icon: CheckCircle2, title: t("landing.values.nofees.title"), desc: t("landing.values.nofees.desc") },
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
    <div className="flex flex-col overflow-x-hidden">
      {/* Hero with carousel */}
      <section className="relative overflow-hidden bg-hero">
        <div className="container relative z-10 mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
          <div className="flex flex-col justify-center">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {t("landing.badge")}
            </div>
            <h1 className="mt-6 max-w-2xl font-serif text-3xl font-medium leading-[1.1] tracking-tight text-foreground sm:text-4xl md:text-5xl xl:text-6xl">
              {t("landing.heroTitleA")}<br />
              <span className="text-gradient">{t("landing.heroTitleB")}</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              {t("landing.heroDesc")}
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button asChild size="lg" className="h-12 w-full rounded-full px-6 text-sm shadow-glow sm:h-14 sm:w-auto sm:px-8 sm:text-base">
                <Link to="/apply" search={{ product: undefined, amount: undefined, months: undefined }}>
                  {t("landing.ctaPrimary")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 w-full rounded-full bg-card px-6 text-sm sm:h-14 sm:w-auto sm:px-8 sm:text-base">
                <Link to="/simulation" search={{ product: undefined }}>{t("landing.ctaSecondary")}</Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-accent" /> {t("landing.trust1")}</div>
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> {t("landing.trust2")}</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> {t("landing.trust3")}</div>
            </div>
          </div>

          {/* Carousel */}
          <div className="relative">
            <div className="relative aspect-[4/3] min-h-[240px] overflow-hidden rounded-2xl border border-border bg-card shadow-card sm:min-h-[320px] lg:min-h-[500px] lg:rounded-3xl">
              {slides.map((s, i) => (
                <div
                  key={i}
                  className={`absolute inset-0 transition-opacity duration-1000 ${i === current ? "opacity-100" : "opacity-0"}`}
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
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 text-white">
                    <h3 className="font-serif text-xl font-medium md:text-2xl">{s.title}</h3>
                    <p className="mt-1 text-sm text-white/80">{s.desc}</p>
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
                  className={`h-1.5 rounded-full transition-all ${i === current ? "w-8 bg-accent" : "w-2 bg-muted-foreground/30"}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="border-y border-border bg-card py-12">
        <div className="container mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 sm:gap-8 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.l} className="text-center">
              <div className="font-serif text-3xl font-medium text-primary md:text-4xl">{k.v}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Value Props */}
      <section className="bg-background py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-3">
            {values.map(({ Icon, title, desc }) => (
              <div key={title} className="space-y-4 text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Icon size={32} />
                </div>
                <h3 className="font-serif text-xl font-medium text-foreground">{title}</h3>
                <p className="leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security section */}
      <section className="bg-surface py-24">
        <div className="container mx-auto grid max-w-6xl gap-12 px-4 md:grid-cols-2 md:items-center">
          <div className="relative overflow-hidden rounded-3xl border border-border shadow-card">
            <img src={dashboardImg} alt={t("landing.security.title")} className="h-full w-full object-cover" loading="lazy" width={1536} height={896} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t("landing.security.eyebrow")}</p>
            <h2 className="mt-3 font-serif text-3xl font-medium text-foreground md:text-4xl">{t("landing.security.title")}</h2>
            <p className="mt-4 text-muted-foreground">{t("landing.security.desc")}</p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {securityFeatures.map(({ Icon, title, desc }) => (
                <div key={title} className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">{title}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-background py-24">
        <div className="container mx-auto max-w-4xl px-4">
          <h2 className="text-center font-serif text-4xl font-medium text-primary md:text-5xl">{t("landing.how.title")}</h2>
          <div className="relative mt-16 space-y-8 before:absolute before:inset-0 before:ml-5 before:h-full before:w-0.5 before:-translate-x-px before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent md:before:mx-auto md:before:translate-x-0">
            {steps.map((step, i) => (
              <div key={i} className="group relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse">
                <div className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-background bg-primary font-bold text-primary-foreground shadow-md md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                  {i + 1}
                </div>
                <div className="w-[calc(100%-3rem)] rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-accent/40 sm:p-6 md:w-[calc(50%-2.5rem)]">
                  <div className="mb-2 flex items-center gap-2">
                    <step.Icon className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold">{step.title}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-surface py-24">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("landing.testi.eyebrow")}</p>
            <h2 className="mt-4 font-serif text-3xl font-medium text-foreground md:text-4xl">{t("landing.testi.title")}</h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {testimonials.map((tm) => (
              <div key={tm.name} className="rounded-2xl border border-border bg-card p-8 shadow-card">
                <Quote className="h-6 w-6 text-accent" />
                <p className="mt-4 leading-relaxed text-foreground">"{tm.quote}"</p>
                <div className="mt-6 flex items-center gap-1 text-accent">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="font-semibold text-foreground">{tm.name}</div>
                  <div className="text-sm text-muted-foreground">{tm.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mobile app */}
      <section className="bg-background py-24">
        <div className="container mx-auto grid max-w-6xl gap-12 px-4 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t("landing.mobile.eyebrow")}</p>
            <h2 className="mt-3 font-serif text-3xl font-medium text-foreground md:text-4xl">{t("landing.mobile.title")}</h2>
            <p className="mt-4 text-muted-foreground">{t("landing.mobile.desc")}</p>
            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-3"><TrendingUp className="h-4 w-4 text-accent" /> {t("landing.mobile.b1")}</li>
              <li className="flex items-center gap-3"><Globe2 className="h-4 w-4 text-accent" /> {t("landing.mobile.b2")}</li>
              <li className="flex items-center gap-3"><ShieldCheck className="h-4 w-4 text-accent" /> {t("landing.mobile.b3")}</li>
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-border shadow-card">
            <img src={mobileImg} alt={t("landing.mobile.title")} className="h-full w-full object-cover" loading="lazy" width={1536} height={896} />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-surface py-24">
        <div className="container mx-auto max-w-3xl px-4">
          <h2 className="text-center font-serif text-3xl font-medium text-foreground md:text-4xl">{t("landing.faq.title")}</h2>
          <div className="mt-12 space-y-4">
            {faqs.map((f, i) => (
              <details key={i} className="group rounded-2xl border border-border bg-card p-6 shadow-card">
                <summary className="flex cursor-pointer items-center justify-between font-semibold text-foreground">
                  {f.q}
                  <span className="ml-4 text-accent transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Partner banks */}
      <section className="border-t border-border bg-background py-20">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("landing.partners.eyebrow")}</p>
            <h2 className="mt-4 font-serif text-3xl font-medium text-foreground md:text-4xl">{t("landing.partners.title")}</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground">{t("landing.partners.desc")}</p>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
            {PARTNER_BANKS.map((bank) => (
              <div key={bank} className="flex items-center justify-center bg-card px-4 py-8 text-center text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface hover:text-foreground">
                {bank}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-wallet py-20 text-center text-white">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-2xl font-medium leading-tight sm:text-3xl lg:text-5xl">{t("landing.finalCta.title")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">{t("landing.finalCta.desc")}</p>
          <Button asChild size="lg" variant="secondary" className="mt-8 h-14 rounded-full bg-white px-8 text-base font-semibold text-primary hover:bg-white/90">
            <Link to="/apply" search={{ product: undefined, amount: undefined, months: undefined }}>
              {t("landing.finalCta.button")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="border-t border-border bg-card py-16">
        <div className="container mx-auto grid max-w-6xl gap-12 px-4 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t("contactSection.eyebrow", "Support")}</p>
            <h2 className="mt-3 font-serif text-3xl font-medium text-foreground md:text-4xl">{t("contactSection.title", "Get in touch")}</h2>
            <p className="mt-4 text-muted-foreground">{t("contactSection.desc", "Our advisors answer within one business hour.")}</p>
          </div>
          <div className="rounded-3xl border border-border bg-background p-8 shadow-card">
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-3"><Mail className="h-4 w-4 text-accent" /><a href="mailto:support@moonyp.com" className="hover:text-accent">support@moonyp.com</a></li>
              <li className="flex items-center gap-3"><Phone className="h-4 w-4 text-accent" /><a href="tel:+393500366867" className="hover:text-accent">+39 350 036 6867</a></li>
              <li className="flex items-center gap-3"><MapPin className="h-4 w-4 text-accent" />16 Boulevard des Italiens, 75009 Paris, France</li>
            </ul>
            <Button asChild className="mt-6 w-full rounded-full">
              <Link to="/contact">{t("contactSection.cta", "Open contact form")}</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card py-10 text-xs text-muted-foreground sm:text-sm">
        <div className="container mx-auto px-4">
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <p className="font-serif text-base font-medium text-foreground">MOONYP</p>
              <p className="mt-2">{t("landing.footer.legal")}</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">{t("footer.legal", "Legal")}</p>
              <ul className="mt-3 space-y-2">
                <li><Link to="/legal/privacy" className="hover:text-accent">{t("footer.privacy", "Privacy")}</Link></li>
                <li><Link to="/legal/terms" className="hover:text-accent">{t("footer.terms", "Terms")}</Link></li>
                <li><Link to="/legal/cookies" className="hover:text-accent">{t("footer.cookies", "Cookies")}</Link></li>
                <li><Link to="/legal/mentions" className="hover:text-accent">{t("footer.mentions", "Legal notice")}</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">{t("footer.banking", "Banking")}</p>
              <ul className="mt-3 space-y-2">
                <li><Link to="/legal/loan-terms" className="hover:text-accent">{t("footer.loanTerms", "Loan terms")}</Link></li>
                <li><Link to="/legal/repayment" className="hover:text-accent">{t("footer.repayment", "Repayment & default")}</Link></li>
                <li><Link to="/legal/aml-kyc" className="hover:text-accent">{t("footer.aml", "AML / KYC")}</Link></li>
                <li><Link to="/legal/financial-privacy" className="hover:text-accent">{t("footer.finPriv", "Financial privacy")}</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">{t("footer.contact", "Contact")}</p>
              <ul className="mt-3 space-y-2">
                <li><a href="#contact" className="hover:text-accent">{t("contactSection.cta", "Contact us")}</a></li>
                <li><a href="mailto:support@moonyp.com" className="hover:text-accent">support@moonyp.com</a></li>
                <li><a href="tel:+393500366867" className="hover:text-accent">+39 350 036 6867</a></li>
              </ul>
            </div>
          </div>
          <p className="mt-8 text-center">© {new Date().getFullYear()} MOONYP. {t("landing.footer.rights")}</p>
        </div>
      </footer>
    </div>
  );
}
