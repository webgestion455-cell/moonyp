/**
 * Rendu des emails transactionnels Moonyp.
 *
 * Objectif : un rendu de niveau bancaire (PayPal / Revolut), 100 % HTML
 * "email-safe" (tables, styles inline), responsive sur mobile et compatible
 * thème clair ET sombre (`prefers-color-scheme` + `color-scheme`).
 *
 * Aucune dépendance externe : les clients mail n'exécutent ni JS ni CSS
 * moderne. Tout est donc inline, avec un bloc <style> pour le responsive et
 * le mode sombre sur les clients qui le supportent (Apple Mail, iOS, etc.).
 */

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailTemplateInput {
  /** Titre principal affiché en haut du contenu. */
  title: string;
  /** Paragraphe principal (texte brut, déjà traduit). */
  intro: string;
  /** Paragraphes additionnels facultatifs. */
  paragraphs?: string[];
  /** Tableau récapitulatif du dossier. */
  detailsTitle?: string;
  details?: EmailDetail[];
  /** Bouton d'action principal (espace sécurisé). */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Encart d'information (instructions, code, motif...). */
  noticeTitle?: string;
  noticeBody?: string;
  /** Code à usage unique mis en avant (signature électronique). */
  code?: string;
  /** Textes de pied de page traduits. */
  securityNotice: string;
  helpText: string;
  legalText: string;
  autoText: string;
  tagline: string;
  /** Aperçu affiché dans la boîte de réception. */
  preheader?: string;
}

const BRAND = "#0F5132";
const BRAND_SOFT = "#127a4b";

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Version texte brut (fallback obligatoire pour les clients sans HTML). */
export function renderEmailText(input: EmailTemplateInput): string {
  const lines = [input.title, "", input.intro];
  for (const p of input.paragraphs ?? []) lines.push("", p);
  if (input.code) lines.push("", `${input.noticeTitle ?? ""} ${input.code}`.trim());
  if (input.details?.length) {
    lines.push("", input.detailsTitle ?? "");
    for (const d of input.details) lines.push(`- ${d.label} : ${d.value}`);
  }
  if (input.noticeBody) lines.push("", input.noticeBody);
  if (input.ctaUrl) lines.push("", `${input.ctaLabel ?? ""} : ${input.ctaUrl}`.trim());
  lines.push("", input.securityNotice, input.helpText, "", input.legalText, input.autoText);
  return lines.join("\n");
}

/** Rendu HTML complet : en-tête de marque, contenu, CTA, pied de page. */
export function renderEmailHtml(input: EmailTemplateInput): string {
  const details = (input.details ?? []).filter((d) => d.value && d.value !== "—");

  const detailRows = details
    .map(
      (d, i) => `
              <tr>
                <td class="dl" style="padding:10px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#5b6b63;${
                  i === 0 ? "" : "border-top:1px solid #e7ece9;"
                }">${esc(d.label)}</td>
                <td class="dv" align="right" style="padding:10px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#10231a;${
                  i === 0 ? "" : "border-top:1px solid #e7ece9;"
                }">${esc(d.value)}</td>
              </tr>`,
    )
    .join("");

  const detailsBlock = details.length
    ? `
          <tr><td style="padding:0 32px 8px 32px">
            <p class="h3" style="margin:18px 0 10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b8a83">${esc(
              input.detailsTitle ?? "",
            )}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="panel" style="background:#f6f9f7;border:1px solid #e7ece9;border-radius:12px">
              ${detailRows}
            </table>
          </td></tr>`
    : "";

  const codeBlock = input.code
    ? `
          <tr><td style="padding:8px 32px 0 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="panel" style="background:#f6f9f7;border:1px solid #e7ece9;border-radius:12px">
              <tr><td align="center" style="padding:18px">
                <div class="dl" style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#5b6b63">${esc(
                  input.noticeTitle ?? "",
                )}</div>
                <div class="code" style="margin-top:8px;font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:${BRAND}">${esc(
                  input.code,
                )}</div>
              </td></tr>
            </table>
          </td></tr>`
    : "";

  const noticeBlock =
    input.noticeBody && !input.code
      ? `
          <tr><td style="padding:8px 32px 0 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="notice" style="background:#fff8ec;border:1px solid #f2e0bd;border-radius:12px">
              <tr><td style="padding:14px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b4f18">
                ${input.noticeTitle ? `<strong>${esc(input.noticeTitle)}</strong><br/>` : ""}${esc(input.noticeBody)}
              </td></tr>
            </table>
          </td></tr>`
      : "";

  const ctaBlock =
    input.ctaUrl && input.ctaLabel
      ? `
          <tr><td align="center" style="padding:24px 32px 4px 32px">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px">
                <a href="${esc(input.ctaUrl)}" target="_blank" rel="noopener"
                   style="display:inline-block;padding:14px 30px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">
                  ${esc(input.ctaLabel)}
                </a>
              </td></tr>
            </table>
            <p class="muted" style="margin:12px 0 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8a9891;word-break:break-all">${esc(
              input.ctaUrl,
            )}</p>
          </td></tr>`
      : "";

  const paragraphs = (input.paragraphs ?? [])
    .filter(Boolean)
    .map(
      (p) =>
        `<p class="body" style="margin:0 0 12px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#3d4b44">${esc(
          p,
        )}</p>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${esc(input.title)}</title>
<style>
  body{margin:0;padding:0;width:100%!important;background:#eef2f0}
  img{border:0;outline:none;text-decoration:none}
  table{border-collapse:collapse}
  a{color:${BRAND_SOFT}}
  @media only screen and (max-width:600px){
    .wrap{width:100%!important}
    .px{padding-left:20px!important;padding-right:20px!important}
    .h1{font-size:20px!important}
    .code{font-size:26px!important;letter-spacing:6px!important}
  }
  @media (prefers-color-scheme: dark){
    body,.bg{background:#0d1210!important}
    .card{background:#141b18!important;border-color:#243029!important}
    .h1,.dv{color:#f2f6f4!important}
    .body,.dl{color:#c2cec8!important}
    .panel{background:#111a16!important;border-color:#243029!important}
    .notice{background:#1d1a10!important;border-color:#3b3320!important}
    .notice td{color:#e9d8ad!important}
    .muted,.foot{color:#8fa199!important}
    .divider{border-color:#243029!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(input.preheader ?? input.intro.slice(0, 120))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#eef2f0">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="600" class="wrap" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px">

      <tr><td style="padding:0 0 16px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-.02em;color:${BRAND}">MOONYP</td>
            <td align="right" class="muted" style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#7b8a83">${esc(
              input.tagline,
            )}</td>
          </tr>
        </table>
      </td></tr>

      <tr><td class="card" style="background:#ffffff;border:1px solid #e2e9e5;border-radius:16px;overflow:hidden">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

          <tr><td style="height:4px;background:linear-gradient(90deg,${BRAND},${BRAND_SOFT});font-size:0;line-height:0">&nbsp;</td></tr>

          <tr><td class="px" style="padding:28px 32px 0 32px">
            <h1 class="h1" style="margin:0 0 14px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:23px;line-height:1.3;font-weight:700;color:#10231a">${esc(
              input.title,
            )}</h1>
            <p class="body" style="margin:0 0 12px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#3d4b44">${esc(
              input.intro,
            )}</p>
            ${paragraphs}
          </td></tr>

          ${codeBlock}
          ${detailsBlock}
          ${noticeBlock}
          ${ctaBlock}

          <tr><td class="px" style="padding:22px 32px 26px 32px">
            <hr class="divider" style="border:none;border-top:1px solid #e7ece9;margin:0 0 14px"/>
            <p class="muted" style="margin:0 0 6px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7b8a83">${esc(
              input.securityNotice,
            )}</p>
            <p class="muted" style="margin:0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7b8a83">${esc(
              input.helpText,
            )}</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td class="foot" style="padding:16px 8px 0 8px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#8a9891;text-align:center">
        ${esc(input.legalText)}<br/>${esc(input.autoText)}
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
