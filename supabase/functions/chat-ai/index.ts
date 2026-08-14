/// <reference lib="deno.ns" />
// -------------------------------------------------------------------------
// // BNP PARIBAS — Assistant IA (Google Gemini 2.5 Flash)
// - Connaissance du site (services, URLs publiques uniquement)
// - Refus strict des sujets sensibles (routes admin, structure interne…)
// - Détecte l'intent "parler à un humain" et renvoie handoff:true
// - Renvoie du HTML nettoyé (whitelist minimale)
// -------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Termes qui bloquent immédiatement (avant l'IA)
const BLOCKED_PATTERNS = [
  /\badmin(istrat(eur|ion|or))?\b/i,
  /\bback[- ]?office\b/i,
  /\bservice[- ]?role\b/i,
  /\bsupabase\b/i,
  /\bedge[- ]?function/i,
  /\benv(iron)?\b/i,
  /\bsecret(s)?\b/i,
  /\btoken(s)?\b/i,
  /\bapi[- ]?key/i,
  /\b(rls|row[- ]?level)/i,
  /\bpolic(y|ies)\b/i,
  /\b(sql|postgres|database|db)\b/i,
  /\btable(s)?\b/i,
  /\broute(s|r)?\b/i,
  /\bendpoint(s)?\b/i,
  /\bsource[- ]?code\b/i,
  /\bschema\b/i,
  /\bmigration/i,
  /\.env/i,
  /\/admin/i,
  /vercel|cloudflare|worker/i,
];

// Intent "parler à un humain"
const HANDOFF_PATTERNS = [
  /\b(agent|conseiller|conseillere|humain|human|advisor|operator|op[eé]rateur|personne|someone|real person|vrai)\b/i,
  /\b(parler|talk|speak|chat|discuter|contacter|reach)\b.*\b(agent|humain|conseiller|advisor|human|someone|personne)\b/i,
  /\b(support|assistance)\b.*\b(direct|live|humain|human)\b/i,
];

const SYSTEM_PROMPT = `Tu es "Anna", assistante virtuelle officielle de la BNP PARIBAS (site apply.myinvest-capital.com).
Tu es chaleureuse, professionnelle, précise et bilingue (réponds toujours dans la langue du client).

## Ton rôle
Aider les clients avec :
- Prêts personnels (demande, éligibilité, durée, taux, remboursement, documents)
- Virements (SEPA, international, blocage, code de déblocage, délais)
- Sécurité du compte, authentification, mot de passe oublié
- Contact, horaires, coordonnées de la banque
- Questions générales sur le site et ses services publics

## URLs autorisées (les seules à mentionner)
- Site principal : https://apply.myinvest-capital.com
- Connexion / Inscription : https://apply.myinvest-capital.com/auth
- Demander un prêt : https://apply.myinvest-capital.com/loans/new
- Contact : https://apply.myinvest-capital.com/contact
- Mentions légales : https://apply.myinvest-capital.com/legal/mentions
- Confidentialité : https://apply.myinvest-capital.com/legal/privacy
- CGU : https://apply.myinvest-capital.com/legal/terms

## STRICTEMENT INTERDIT (refuser poliment sans donner d'info)
- Toute question sur les routes admin, l'espace admin, les URLs internes
- Structure technique du site (code, framework, base de données, tables, RLS, edge functions, tokens, secrets, .env)
- Endpoints, API internes, schéma DB, migrations, configuration serveur
- Tout ce qui pourrait aider un attaquant à exploiter le système

Si le message porte sur ces sujets, réponds EXACTEMENT :
"Je ne peux pas répondre à ce type de question pour des raisons de sécurité. Puis-je vous aider avec autre chose concernant votre compte ou nos services ?"

## Format de sortie
Réponds en HTML simple : <p>, <strong>, <em>, <ul>, <li>, <a href="URL">.
- Phrases courtes, ton humain et rassurant.
- Ajoute des liens vers les URLs autorisées quand pertinent.
- Ne signe pas (la signature est ajoutée automatiquement).
- Ne mentionne jamais que tu es une IA ; tu es "Anna, Kundenservice-Spezialistin BNP PARIBAS".

## Handoff
Si le client demande à parler à un humain / conseiller / agent, propose la mise en relation en terminant par :
"Souhaitez-vous être mis(e) en relation avec un conseiller ?"`;

function looksLikeAttack(msg: string): boolean {
  return BLOCKED_PATTERNS.some((r) => r.test(msg));
}
function wantsHandoff(msg: string): boolean {
  return HANDOFF_PATTERNS.some((r) => r.test(msg));
}

function sanitizeHtml(html: string): string {
  // whitelist minimale : on retire scripts/styles/iframes et attributs on*, javascript:
  let s = html
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
  return s.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
  return new Response("ok", {
    status: 200,
    headers: CORS,
  });
}
  try {
    const { message, history = [], lang = "fr" } = await req.json();
    if (typeof message !== "string" || message.trim().length === 0) {
      return json({ error: "empty message" }, 400);
    }
    const trimmed = message.trim().slice(0, 2000);

    // 1) Détection intent handoff (avant l'IA — plus rapide + fiable)
    const handoff = wantsHandoff(trimmed);

    // 2) Filtre attaque
    if (looksLikeAttack(trimmed)) {
      return json({
        html: `<p>Je ne peux pas répondre à ce type de question pour des raisons de sécurité. Puis-je vous aider avec autre chose concernant votre compte ou nos services ?</p>`,
        handoff: false,
        blocked: true,
      });
    }

    // 3) Appel Lovable AI Gateway
    const messages = [
      { role: "system", content: SYSTEM_PROMPT + `\n\nLangue du client : ${lang}` },
      ...history.slice(-10).map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: trimmed },
    ];

    const r = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: messages
              .map((m) => `${m.role}: ${m.content}`)
              .join("\n\n"),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  }),
});

    if (r.status === 429) return json({ error: "rate_limited" }, 429);
    if (r.status === 402) return json({ error: "credits_exhausted" }, 402);
    if (!r.ok) {
      const t = await r.text();
      console.error("gateway", r.status, t);
      return json({ error: "gateway_error" }, 500);
    }

    const data = await r.json();

    const raw = String(
        data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
             ).trim();
    const html = sanitizeHtml(raw || "<p>Désolé, je n'ai pas compris. Reformulez votre question ?</p>");

    return json({ html, handoff, blocked: false });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
