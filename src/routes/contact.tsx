import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Honeypot } from "@/components/Honeypot";
import { submitContactMessage } from "@/lib/contact.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Mail, Phone, MapPin, Send, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import moonypLogo from "@/assets/moonyp-logo.png";
import i18n from "@/i18n";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: i18n.t("contact.metaTitle") },
      { name: "description", content: i18n.t("contact.metaDesc") },
    ],
  }),
});

const SUBJECT_KEYS = ["account", "loan", "transfer", "complaint", "appointment", "other"] as const;

function ContactPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [subjectKey, setSubjectKey] = useState<(typeof SUBJECT_KEYS)[number]>("account");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const startTsRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.full_name) setFullName(data.full_name);
    })();
  }, [user]);

  async function submit() {
    // Anti-bot: honeypot + min interaction time
    if (honeypotRef.current?.value) return;
    if (Date.now() - startTsRef.current < 1200) return;

    const schema = z.object({
      full_name: z.string().trim().min(2, t("contact.nameRequired")).max(120),
      email: z.string().trim().email(t("contact.emailInvalid")).max(180),
      subject: z.string().trim().min(2).max(180),
      message: z.string().trim().min(10, t("contact.messageTooShort")).max(4000),
    });
    const subject = t(`contact.subjects.${subjectKey}`);
    const parsed = schema.safeParse({ full_name: fullName, email, subject, message });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const res = await submitContactMessage({
        data: {
          full_name: parsed.data.full_name,
          email: parsed.data.email,
          subject: parsed.data.subject,
          message: parsed.data.message,
          user_id: user?.id ?? null,
          website: "",
        },
      });
      toast.success(res?.emailSent ? t("contact.success") : t("contact.successQueued"));
      setMessage("");
    } catch (err) {
      toast.error((err as Error).message || t("contact.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:py-10 max-w-5xl pb-28 lg:pb-10">
      <div className="mb-4 hidden sm:block">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-1" /> {t("contact.back")}
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-4 mb-8">
        <img src={moonypLogo} alt="MOONYP" width={56} height={56} className="h-11 w-11 sm:h-14 sm:w-14 rounded-md bg-white p-1 shadow-sm" />
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif text-primary">{t("contact.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("contact.subtitle")}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("contact.infoTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Phone className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <div>
                <p className="font-medium">{t("contact.phoneTitle")}</p>
                <a
                  href="https://wa.me/393500366867"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary hover:underline transition cursor-pointer">+39 350 036 6867</a>
                <p className="text-xs text-muted-foreground">{t("contact.phoneHours")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <div>
                <p className="font-medium">{t("contact.emailLabel")}</p>
                <a
                 href="mailto:support_bnpparibas@nowelio.com"
                 className="text-muted-foreground hover:text-primary hover:underline transition break-all cursor-pointer">support@moonyp.com</a>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <div>
                <p className="font-medium">{t("contact.addressLabel")}</p>
                <a
                  href="https://www.google.com/maps/search/?api=1&query=103+avenue+des+Champs-Élysées+75008+Paris"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary hover:underline transition cursor-pointer">{t("contact.address")}<br />{t("contact.addressCity")}</a>
              </div>
            </div>
            <div className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
              <p>{t("contact.secureNote")}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("contact.formTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Honeypot ref={honeypotRef} />
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>{t("contact.fullName")} *</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1.5"
                  placeholder={t("contact.defaultNamePlaceholder")}
                />
              </div>
              <div>
                <Label>{t("contact.email")} *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5"
                  placeholder={t("contact.defaultEmailPlaceholder")}
                />
              </div>
            </div>
            <div>
              <Label>{t("contact.subject")} *</Label>
              <Select value={subjectKey} onValueChange={(v) => setSubjectKey(v as typeof subjectKey)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`contact.subjects.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("contact.message")} *</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                maxLength={4000}
                className="mt-1.5"
                placeholder={t("contact.messagePlaceholder")}
              />
              <p className="mt-1 text-xs text-muted-foreground text-right">
                {message.length} / 4000
              </p>
            </div>
            <div className="pt-2 flex justify-stretch sm:justify-end">
              <Button onClick={submit} disabled={busy} className="w-full sm:w-auto shadow-glow">
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                {busy ? t("contact.sending") : t("contact.send")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
