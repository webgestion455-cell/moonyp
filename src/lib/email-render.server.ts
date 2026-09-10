/**
 * Rendu des emails transactionnels Moonyp.
 *
 * Direction artistique : codes des grandes banques et fintechs (HSBC, BNP
 * Paribas, Revolut, Trade Republic) — monochrome strict (noir / blanc / gris),
 * typographie sobre, bouton noir, tableau de données bancaire, en-tête et pied
 * de page porteurs de la marque et des mentions institutionnelles.
 *
 * Contraintes techniques email :
 *   - 100 % tables + styles inline (Outlook, Gmail, Yahoo, Apple Mail) ;
 *   - largeur fluide 100 % / max 600 px, cassure propre sous 600 px ;
 *   - aucune image indispensable à la compréhension (le logo a un repli texte) ;
 *   - `prefers-color-scheme` géré pour les clients qui le supportent ;
 *   - JAMAIS d'URL brute affichée : le bouton porte le lien, un repli texte
 *     discret est prévu uniquement dans la version texte de l'email.
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
  /** URL absolue du logo (repli : marque en texte). */
  logoUrl?: string;
}

/* --------------------------------------------------------------------------
 * Constantes de marque — identiques au pied de page du site.
 * ----------------------------------------------------------------------- */
const BRAND_NAME = "MOONYP";
const BRAND_ADDRESS = "16 Boulevard des Italiens, 75009 Paris, France";
const BRAND_EMAIL = "support@moonyp.com";
const BRAND_PHONE = "+39 350 036 6867";

/* Palette monochrome bancaire. */
const INK = "#0A0A0A";
const INK_SOFT = "#3F3F46";
const GREY = "#71717A";
const GREY_LIGHT = "#A1A1AA";
const LINE = "#E4E4E7";
const SURFACE = "#FAFAFA";
const CANVAS = "#F4F4F5";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Version texte brut (fallback obligatoire pour les clients sans HTML). */
export function renderEmailText(input: EmailTemplateInput): string {
  const lines = [BRAND_NAME.toUpperCase(), "", input.title, "", input.intro];
  for (const p of input.paragraphs ?? []) lines.push("", p);
  if (input.code) lines.push("", `${input.noticeTitle ?? ""} ${input.code}`.trim());
  if (input.details?.length) {
    lines.push("", (input.detailsTitle ?? "").toUpperCase());
    for (const d of input.details) lines.push(`- ${d.label} : ${d.value}`);
  }
  if (input.noticeBody) lines.push("", input.noticeBody);
  // La version texte est le SEUL endroit où l'URL apparaît en clair : les
  // clients sans HTML n'ont pas de bouton cliquable.
  if (input.ctaUrl) lines.push("", `${input.ctaLabel ?? ""} : ${input.ctaUrl}`.trim());
  lines.push(
    "",
    input.securityNotice,
    input.helpText,
    "",
    `${BRAND_NAME} — ${BRAND_ADDRESS}`,
    `${BRAND_EMAIL} · ${BRAND_PHONE}`,
    input.legalText,
    input.autoText,
  );
  return lines.join("\n");
}

/** Rendu HTML complet : en-tête de marque, contenu, CTA, pied de page. */
export function renderEmailHtml(input: EmailTemplateInput): string {
  const details = (input.details ?? []).filter((d) => d.value && d.value !== "—");

  /* ------------------------------- Tableau ------------------------------ */
  const detailRows = details
    .map(
      (d, i) => `
              <tr>
                <td class="dl" style="padding:12px 16px;font-family:${FONT};font-size:13px;line-height:1.45;color:${GREY};${
                  i === 0 ? "" : `border-top:1px solid ${LINE};`
                }">${esc(d.label)}</td>
                <td class="dv" align="right" style="padding:12px 16px;font-family:${FONT};font-size:13px;line-height:1.45;font-weight:600;color:${INK};white-space:nowrap;${
                  i === 0 ? "" : `border-top:1px solid ${LINE};`
                }">${esc(d.value)}</td>
              </tr>`,
    )
    .join("");

  const detailsBlock = details.length
    ? `
          <tr><td class="px" style="padding:8px 32px 0 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="width:100%;border:1px solid ${LINE};border-radius:6px;border-collapse:separate;overflow:hidden">
              <tr><td colspan="2" class="thead" style="padding:11px 16px;background:${INK};font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#FFFFFF">${esc(
                input.detailsTitle ?? "",
              )}</td></tr>
              ${detailRows}
            </table>
          </td></tr>`
    : "";

  /* ------------------------------- Code OTP ----------------------------- */
  const codeBlock = input.code
    ? `
          <tr><td class="px" style="padding:8px 32px 0 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="width:100%;background:${SURFACE};border:1px solid ${LINE};border-radius:6px">
              <tr><td align="center" style="padding:20px 16px">
                <div class="dl" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${GREY}">${esc(
                  input.noticeTitle ?? "",
                )}</div>
                <div class="code" style="margin-top:10px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:9px;color:${INK}">${esc(
                  input.code,
                )}</div>
              </td></tr>
            </table>
          </td></tr>`
    : "";

  /* ------------------------------- Encart ------------------------------- */
  const noticeBlock =
    input.noticeBody && !input.code
      ? `
          <tr><td class="px" style="padding:8px 32px 0 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="notice" style="width:100%;background:${SURFACE};border-left:3px solid ${INK};border-top:1px solid ${LINE};border-right:1px solid ${LINE};border-bottom:1px solid ${LINE};border-radius:0 6px 6px 0">
              <tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${INK_SOFT}">
                ${
                  input.noticeTitle
                    ? `<strong style="display:block;margin-bottom:4px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${GREY}">${esc(
                        input.noticeTitle,
                      )}</strong>`
                    : ""
                }${esc(input.noticeBody)}
              </td></tr>
            </table>
          </td></tr>`
      : "";

  /* -------------------------------- Bouton ------------------------------ */
  // Bouton noir « bulletproof » : rendu identique sur Outlook (VML) et ailleurs.
  // Aucune URL n'est affichée sous le bouton : le bouton EST le lien.
  const ctaBlock =
    input.ctaUrl && input.ctaLabel
      ? `
          <tr><td class="px" style="padding:26px 32px 4px 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btnwrap">
                <tr><td align="center" bgcolor="${INK}" style="border-radius:4px">
                  <a class="btn" href="${esc(input.ctaUrl)}" target="_blank" rel="noopener"
                     style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:.02em;color:#FFFFFF;text-decoration:none;border-radius:4px">${esc(
                       input.ctaLabel,
                     )}</a>
                </td></tr>
              </table>
            </td></tr></table>
          </td></tr>`
      : "";

  const paragraphs = (input.paragraphs ?? [])
    .filter(Boolean)
    .map(
      (p) =>
        `<p class="body" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK_SOFT}">${esc(
          p,
        )}</p>`,
    )
    .join("");

  const logo = input.logoUrl
    ? `<img src="${esc(
        input.logoUrl,
      )}" width="28" height="28" alt="${BRAND_NAME}" class="logo" style="display:block;border:0;width:28px;height:28px;outline:none;text-decoration:none"/>`
    : "";

  /* ------------------------------- Document ----------------------------- */
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="fr">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${esc(input.title)}</title>
<!--[if mso]><style type="text/css">body,table,td,a{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<style type="text/css">
  html,body{margin:0!important;padding:0!important;width:100%!important;background:${CANVAS}}
  *{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%}
  img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  table{border-collapse:collapse!important;mso-table-lspace:0;mso-table-rspace:0}
  a{color:${INK};text-decoration:underline}
  .btn:hover{opacity:.88}
  /* Petits écrans : 320 → 600 px */
  @media only screen and (max-width:620px){
    .wrap{width:100%!important;max-width:100%!important}
    .px{padding-left:20px!important;padding-right:20px!important}
    .h1{font-size:20px!important;line-height:1.3!important}
    .body{font-size:15px!important}
    .code{font-size:24px!important;letter-spacing:6px!important}
    .btnwrap,.btn{width:100%!important;display:block!important;text-align:center!important}
    .dl,.dv{font-size:12px!important;padding-left:12px!important;padding-right:12px!important}
    .stack{display:block!important;width:100%!important;text-align:left!important;padding-top:6px!important}
  }
  /* Très petits écrans */
  @media only screen and (max-width:380px){
    .h1{font-size:19px!important}
    .code{font-size:21px!important;letter-spacing:4px!important}
  }
  @media (prefers-color-scheme: dark){
    html,body,.bg{background:#0B0B0C!important}
    .card{background:#141416!important;border-color:#2A2A2E!important}
    .h1,.dv,.brand{color:#FAFAFA!important}
    .body,.notice td{color:#D4D4D8!important}
    .dl,.muted,.foot,.foot a{color:#A1A1AA!important}
    .panel,.notice{background:#18181B!important;border-color:#2A2A2E!important}
    .divider{border-color:#2A2A2E!important}
    .logo{filter:invert(1)}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${CANVAS}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(
    input.preheader ?? input.intro.slice(0, 140),
  )}</div>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">&#847;&zwnj;&nbsp;&#8203;&#847;&zwnj;&nbsp;&#8203;&#847;&zwnj;&nbsp;&#8203;&#847;&zwnj;&nbsp;&#8203;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="width:100%;background:${CANVAS}">
  <tr><td align="center" style="padding:24px 10px 32px 10px">
    <table role="presentation" width="600" class="wrap" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">

      <!-- En-tête de marque -->
      <tr><td style="padding:0 4px 14px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="left" style="font-size:0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                ${logo ? `<td valign="middle" style="padding-right:9px">${logo}</td>` : ""}
                <td valign="middle" class="brand" style="font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:.16em;color:${INK}">${BRAND_NAME}</td>
              </tr></table>
            </td>
            <td align="right" class="muted stack" style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${GREY_LIGHT}">${esc(
              input.tagline,
            )}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Carte principale -->
      <tr><td class="card" style="background:#FFFFFF;border:1px solid ${LINE};border-radius:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr><td style="height:3px;background:${INK};font-size:0;line-height:0;border-radius:8px 8px 0 0">&nbsp;</td></tr>

          <tr><td class="px" style="padding:30px 32px 0 32px">
            <h1 class="h1" style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:1.32;font-weight:700;letter-spacing:-.01em;color:${INK}">${esc(
              input.title,
            )}</h1>
            <p class="body" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK_SOFT}">${esc(
              input.intro,
            )}</p>
            ${paragraphs}
          </td></tr>

          ${codeBlock}
          ${detailsBlock}
          ${noticeBlock}
          ${ctaBlock}

          <tr><td class="px" style="padding:24px 32px 28px 32px">
            <hr class="divider" style="border:none;border-top:1px solid ${LINE};margin:0 0 14px"/>
            <p class="muted" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${GREY}">${esc(
              input.securityNotice,
            )}</p>
            <p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${GREY}">${esc(
              input.helpText,
            )}</p>
          </td></tr>
        </table>
      </td></tr>

      <!-- Pied de page institutionnel -->
      <tr><td class="foot px" style="padding:18px 12px 0 12px;font-family:${FONT};font-size:11px;line-height:1.7;color:${GREY};text-align:center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            ${
              input.logoUrl
                ? `<td valign="middle" style="padding-right:7px"><img src="${esc(
                    input.logoUrl,
                  )}" width="16" height="16" alt="" class="logo" style="display:block;border:0;width:16px;height:16px;opacity:.65"/></td>`
                : ""
            }
            <td valign="middle" style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.16em;color:${INK_SOFT}">${BRAND_NAME}</td>
          </tr></table>
        </td></tr></table>

        <p style="margin:8px 0 0;font-family:${FONT};font-size:11px;line-height:1.7;color:${GREY}">
          ${esc(BRAND_ADDRESS)}<br/>
          <a href="mailto:${BRAND_EMAIL}" style="color:${GREY};text-decoration:none">${BRAND_EMAIL}</a>
          &nbsp;·&nbsp;
          <a href="tel:${BRAND_PHONE.replace(/\s/g, "")}" style="color:${GREY};text-decoration:none">${esc(
            BRAND_PHONE,
          )}</a>
        </p>

        <p style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.7;color:${GREY_LIGHT}">${esc(
          input.legalText,
        )}</p>
        <p style="margin:6px 0 0;font-family:${FONT};font-size:11px;line-height:1.7;color:${GREY_LIGHT}">${esc(
          input.autoText,
        )}</p>
        <p style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.7;color:${GREY_LIGHT}">© ${new Date().getFullYear()} ${BRAND_NAME}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
