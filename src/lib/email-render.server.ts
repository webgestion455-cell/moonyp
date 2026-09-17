/**
 * Rendu des emails transactionnels Moonyp.
 *
 * Direction artistique : codes des grandes banques et fintechs (HSBC, BNP
 * Paribas, Revolut, Trade Republic) — monochrome strict (noir / blanc / gris),
 * typographie sobre, bouton noir, tableau de données bancaire.
 *
 * Contraintes techniques email :
 *   - tableaux pour la structure afin d'assurer la compatibilité Outlook,
 *     Gmail, Yahoo et Apple Mail ;
 *   - largeur fluide 100 % / maximum 600 px ;
 *   - logo responsive sans déformation ;
 *   - header : logo uniquement, centré ;
 *   - footer : logo uniquement pour la partie marque ;
 *   - CTA responsive avec fallback VML pour Outlook ;
 *   - aucune URL brute affichée dans la version HTML ;
 *   - l'URL reste disponible dans la version texte pour les clients
 *     qui ne prennent pas en charge les boutons HTML.
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

  /** Bouton d'action principal. */
  ctaLabel?: string;
  ctaUrl?: string;

  /** Encart d'information. */
  noticeTitle?: string;
  noticeBody?: string;

  /** Code à usage unique mis en avant. */
  code?: string;

  /** Textes de pied de page traduits. */
  securityNotice: string;
  helpText: string;
  legalText: string;
  autoText: string;

  /**
   * Conservé dans l'interface pour compatibilité avec les appels existants.
   * Le tagline n'est volontairement plus affiché dans le header.
   */
  tagline: string;

  /** Aperçu affiché dans la boîte de réception. */
  preheader?: string;

  /** URL absolue du logo. */
  logoUrl?: string;
}

/* --------------------------------------------------------------------------
 * Constantes de marque.
 * ----------------------------------------------------------------------- */

const BRAND_NAME = "MOONYP";
const BRAND_ADDRESS = "1 Centenary Square, Birmingham, B1 2DR, United Kingdom";
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

/* --------------------------------------------------------------------------
 * Sécurité HTML
 * ----------------------------------------------------------------------- */

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* --------------------------------------------------------------------------
 * Version texte brut
 * ----------------------------------------------------------------------- */

/**
 * Version texte brut.
 *
 * L'URL du CTA est volontairement conservée ici :
 * les clients qui ne supportent pas correctement le HTML doivent
 * toujours disposer d'un lien utilisable.
 */
export function renderEmailText(input: EmailTemplateInput): string {
  const lines = [
    BRAND_NAME.toUpperCase(),
    "",
    input.title,
    "",
    input.intro,
  ];

  for (const p of input.paragraphs ?? []) {
    if (p) lines.push("", p);
  }

  if (input.code) {
    lines.push(
      "",
      `${input.noticeTitle ?? ""} ${input.code}`.trim(),
    );
  }

  if (input.details?.length) {
    lines.push(
      "",
      (input.detailsTitle ?? "").toUpperCase(),
    );

    for (const d of input.details) {
      lines.push(`- ${d.label} : ${d.value}`);
    }
  }

  if (input.noticeBody) {
    lines.push("", input.noticeBody);
  }

  /*
   * La version texte est le seul endroit où l'URL est affichée
   * explicitement.
   */
  if (input.ctaUrl) {
    lines.push(
      "",
      `${input.ctaLabel ?? ""} : ${input.ctaUrl}`.trim(),
    );
  }

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

/* --------------------------------------------------------------------------
 * Version HTML
 * ----------------------------------------------------------------------- */

export function renderEmailHtml(
  input: EmailTemplateInput,
): string {
  /* ------------------------------- Tableau ------------------------------ */

  const details = (input.details ?? []).filter(
    (d) => d.value && d.value !== "—",
  );

  const detailRows = details
    .map(
      (d, i) => `
              <tr>
                <td
                  class="dl"
                  style="
                    padding:12px 16px;
                    font-family:${FONT};
                    font-size:13px;
                    line-height:1.45;
                    color:${GREY};
                    ${
                      i === 0
                        ? ""
                        : `border-top:1px solid ${LINE};`
                    }
                  "
                >${esc(d.label)}</td>

                <td
                  class="dv"
                  align="right"
                  style="
                    padding:12px 16px;
                    font-family:${FONT};
                    font-size:13px;
                    line-height:1.45;
                    font-weight:600;
                    color:${INK};
                    white-space:nowrap;
                    ${
                      i === 0
                        ? ""
                        : `border-top:1px solid ${LINE};`
                    }
                  "
                >${esc(d.value)}</td>
              </tr>`,
    )
    .join("");

  const detailsBlock = details.length
    ? `
          <tr>
            <td
              class="px"
              style="padding:8px 32px 0 32px"
            >
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                class="panel"
                style="
                  width:100%;
                  border:1px solid ${LINE};
                  border-radius:6px;
                  border-collapse:separate;
                  overflow:hidden;
                "
              >
                <tr>
                  <td
                    colspan="2"
                    class="thead"
                    style="
                      padding:11px 16px;
                      background:${INK};
                      font-family:${FONT};
                      font-size:10px;
                      font-weight:700;
                      letter-spacing:.14em;
                      text-transform:uppercase;
                      color:#FFFFFF;
                      text-align:center;
                    "
                  >${esc(input.detailsTitle ?? "")}</td>
                </tr>

                ${detailRows}
              </table>
            </td>
          </tr>`
    : "";

  /* ------------------------------- Code OTP ----------------------------- */

  const codeBlock = input.code
    ? `
          <tr>
            <td
              class="px"
              style="padding:8px 32px 0 32px"
            >
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                class="panel"
                style="
                  width:100%;
                  background:${SURFACE};
                  border:1px solid ${LINE};
                  border-radius:6px;
                "
              >
                <tr>
                  <td
                    align="center"
                    style="padding:20px 16px"
                  >
                    <div
                      class="dl"
                      style="
                        font-family:${FONT};
                        font-size:11px;
                        font-weight:600;
                        letter-spacing:.1em;
                        text-transform:uppercase;
                        color:${GREY};
                      "
                    >${esc(input.noticeTitle ?? "")}</div>

                    <div
                      class="code"
                      style="
                        margin-top:10px;
                        font-family:'SFMono-Regular',Consolas,'Courier New',monospace;
                        font-size:30px;
                        line-height:1.2;
                        font-weight:700;
                        letter-spacing:9px;
                        color:${INK};
                      "
                    >${esc(input.code)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : "";

  /* ------------------------------- Encart ------------------------------- */

  const noticeBlock =
    input.noticeBody && !input.code
      ? `
          <tr>
            <td
              class="px"
              style="padding:8px 32px 0 32px"
            >
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                class="notice"
                style="
                  width:100%;
                  background:${SURFACE};
                  border-left:3px solid ${INK};
                  border-top:1px solid ${LINE};
                  border-right:1px solid ${LINE};
                  border-bottom:1px solid ${LINE};
                  border-radius:0 6px 6px 0;
                "
              >
                <tr>
                  <td
                    style="
                      padding:14px 16px;
                      font-family:${FONT};
                      font-size:13px;
                      line-height:1.6;
                      color:${INK_SOFT};
                    "
                  >
                    ${
                      input.noticeTitle
                        ? `
                          <strong
                            style="
                              display:block;
                              margin-bottom:4px;
                              font-size:11px;
                              line-height:1.4;
                              letter-spacing:.1em;
                              text-transform:uppercase;
                              color:${GREY};
                            "
                          >${esc(input.noticeTitle)}</strong>
                        `
                        : ""
                    }

                    ${esc(input.noticeBody)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : "";

  /* -------------------------------- CTA -------------------------------- */

  /*
   * CTA "bulletproof".
   *
   * Outlook desktop utilise VML.
   * Gmail / Apple Mail / Yahoo / autres utilisent la table HTML.
   *
   * Desktop :
   *   largeur maximale = 300 px
   *
   * Mobile :
   *   largeur = 100 % de l'espace disponible.
   */
  
const ctaBlock =
  input.ctaUrl && input.ctaLabel
    ? `
          <tr>
            <td
              class="px"
              align="center"
              style="
                padding:26px 32px 4px 32px;
                text-align:center;
              "
            >

              <!--[if mso]>
              <v:roundrect
                xmlns:v="urn:schemas-microsoft-com:vml"
                xmlns:w="urn:schemas-microsoft-com:office:word"
                href="${esc(input.ctaUrl)}"
                style="
                  height:48px;
                  v-text-anchor:middle;
                  width:220px;
                "
                arcsize="50%"
                strokecolor="${INK}"
                fillcolor="${INK}"
              >
                <w:anchorlock/>
                <center
                  style="
                    color:#FFFFFF;
                    font-family:Arial,Helvetica,sans-serif;
                    font-size:14px;
                    font-weight:bold;
                  "
                >
                  ${esc(input.ctaLabel)}
                </center>
              </v:roundrect>
              <![endif]-->

              <!--[if !mso]><!-->

              <table
                role="presentation"
                cellpadding="0"
                cellspacing="0"
                border="0"
                width="220"
                class="btnwrap"
                style="
                  width:220px;
                  max-width:100%;
                  margin:0 auto;
                  border-collapse:separate;
                "
              >
                <tr>
                  <td
                    align="center"
                    bgcolor="${INK}"
                    style="
                      background:${INK};
                      border-radius:999px;
                      text-align:center;
                    "
                  >
                    <a
                      class="btn"
                      href="${esc(input.ctaUrl)}"
                      target="_blank"
                      rel="noopener"
                      style="
                        display:block;
                        width:100%;
                        box-sizing:border-box;
                        padding:14px 28px;
                        font-family:${FONT};
                        font-size:14px;
                        line-height:20px;
                        font-weight:600;
                        letter-spacing:.02em;
                        color:#FFFFFF;
                        text-decoration:none;
                        border-radius:999px;
                        text-align:center;
                        white-space:nowrap;
                      "
                    >${esc(input.ctaLabel)}</a>
                  </td>
                </tr>
              </table>

              <!--<![endif]-->

            </td>
          </tr>`
    : "";

  /* ----------------------------- Paragraphes ---------------------------- */

  const paragraphs = (input.paragraphs ?? [])
    .filter(Boolean)
    .map(
      (p) =>
        `
        <p
          class="body"
          style="
            margin:0 0 14px;
            font-family:${FONT};
            font-size:15px;
            line-height:1.65;
            color:${INK_SOFT};
          "
        >${esc(p)}</p>
        `,
    )
    .join("");

  /* -------------------------------- Logo -------------------------------- */

  /*
   * IMPORTANT :
   *
   * Pas de height forcé.
   * Le navigateur / client mail conserve automatiquement
   * les proportions originales de l'image.
   *
   * Le width HTML de 120 px donne également un comportement
   * raisonnable dans les clients qui ignorent une partie du CSS.
   */
  const logo = input.logoUrl
    ? `
      <img
        src="${esc(input.logoUrl)}"
        width="120"
        alt="${BRAND_NAME}"
        class="logo"
        style="
          display:block;
          width:120px;
          max-width:60vw;
          height:auto;
          margin:0 auto;
          border:0;
          outline:none;
          text-decoration:none;
          -ms-interpolation-mode:bicubic;
        "
      />
    `
    : "";

  /* ---------------------------- Footer logo ----------------------------- */

  const footerLogo = input.logoUrl
    ? `
      <img
        src="${esc(input.logoUrl)}"
        width="100"
        alt="${BRAND_NAME}"
        class="footer-logo"
        style="
          display:block;
          width:100px;
          max-width:50vw;
          height:auto;
          margin:0 auto;
          border:0;
          outline:none;
          text-decoration:none;
          opacity:.75;
          -ms-interpolation-mode:bicubic;
        "
      />
    `
    : "";

  /* ------------------------------- Document ----------------------------- */

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html
  xmlns="http://www.w3.org/1999/xhtml"
  lang="fr"
>
<head>

<meta
  http-equiv="Content-Type"
  content="text/html; charset=UTF-8"
/>

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<meta
  name="x-apple-disable-message-reformatting"
/>

<meta
  name="format-detection"
  content="telephone=no,address=no,email=no,date=no"
/>

<meta
  name="color-scheme"
  content="light dark"
/>

<meta
  name="supported-color-schemes"
  content="light dark"
/>

<title>${esc(input.title)}</title>

<!--[if mso]>
<style type="text/css">
  body,
  table,
  td,
  a {
    font-family:Arial,Helvetica,sans-serif !important;
  }
</style>
<![endif]-->

<style type="text/css">

  html,
  body {
    margin:0 !important;
    padding:0 !important;
    width:100% !important;
    background:${CANVAS};
  }

  body {
    min-width:100%;
  }

  * {
    -ms-text-size-adjust:100%;
    -webkit-text-size-adjust:100%;
  }

  img {
    border:0;
    line-height:100%;
    outline:none;
    text-decoration:none;
    -ms-interpolation-mode:bicubic;
  }

  table {
    border-collapse:collapse;
    mso-table-lspace:0;
    mso-table-rspace:0;
  }

  td {
    mso-table-lspace:0;
    mso-table-rspace:0;
  }

  a {
    color:${INK};
    text-decoration:underline;
  }

  .logo {
    display:block !important;
    width:120px !important;
    max-width:60vw !important;
    height:auto !important;
    margin:0 auto !important;
  }

  .footer-logo {
    display:block !important;
    width:100px !important;
    max-width:50vw !important;
    height:auto !important;
    margin:0 auto !important;
  }

  .btn:hover {
    opacity:.88;
  }

  /*
   * Petits écrans.
   *
   * Le bouton devient pleine largeur.
   * Le logo réduit légèrement sa largeur.
   */
  @media only screen and (max-width:620px) {

    .wrap {
      width:100% !important;
      max-width:100% !important;
    }

    .px {
      padding-left:20px !important;
      padding-right:20px !important;
    }

    .h1 {
      font-size:20px !important;
      line-height:1.3 !important;
    }

    .body {
      font-size:15px !important;
    }

    .code {
      font-size:24px !important;
      letter-spacing:6px !important;
    }

    .logo {
      width:100px !important;
      max-width:55vw !important;
    }

    .footer-logo {
      width:90px !important;
      max-width:45vw !important;
    }

  
.btnwrap {
  width:220px !important;
  max-width:100% !important;
  margin:0 auto !important;
}

.btn {
  display:block !important;
  width:100% !important;
  box-sizing:border-box !important;
  border-radius:999px !important;
  text-align:center !important;
}

@media only screen and (max-width:620px) {

  .btnwrap {
    width:auto !important;
    max-width:calc(100% - 20px) !important;
  }

  .btn {
    width:auto !important;
    display:inline-block !important;
    padding:13px 24px !important;
    border-radius:999px !important;
    white-space:normal !important;
  }
}

    .dl,
    .dv {
      font-size:12px !important;
      padding-left:12px !important;
      padding-right:12px !important;
    }
  }

  /*
   * Très petits écrans.
   */
  @media only screen and (max-width:380px) {

    .h1 {
      font-size:19px !important;
    }

    .code {
      font-size:21px !important;
      letter-spacing:4px !important;
    }

    .px {
      padding-left:16px !important;
      padding-right:16px !important;
    }

    .logo {
      width:90px !important;
      max-width:50vw !important;
    }

    .footer-logo {
      width:80px !important;
      max-width:42vw !important;
    }
  }

  /*
   * Mode sombre pour les clients qui le supportent.
   *
   * IMPORTANT :
   * On ne force PAS de filtre sur le logo.
   * Le logo conserve donc son apparence originale.
   */
  @media (prefers-color-scheme: dark) {

    html,
    body,
    .bg {
      background:#0B0B0C !important;
    }

    .card {
      background:#141416 !important;
      border-color:#2A2A2E !important;
    }

    .h1,
    .dv {
      color:#FAFAFA !important;
    }

    .body,
    .notice td {
      color:#D4D4D8 !important;
    }

    .dl,
    .muted,
    .foot,
    .foot a {
      color:#A1A1AA !important;
    }

    .panel,
    .notice {
      background:#18181B !important;
      border-color:#2A2A2E !important;
    }

    .divider {
      border-color:#2A2A2E !important;
    }
  }

</style>

</head>

<body
  style="
    margin:0;
    padding:0;
    background:${CANVAS};
  "
>

<!-- Preheader invisible -->
<div
  style="
    display:none;
    max-height:0;
    overflow:hidden;
    opacity:0;
    mso-hide:all;
  "
>
  ${esc(input.preheader ?? input.intro.slice(0, 140))}
</div>

<!-- Espacement anti-preview -->
<div
  style="
    display:none;
    max-height:0;
    overflow:hidden;
    opacity:0;
    mso-hide:all;
  "
>
  &#847;&zwnj;&nbsp;&#8203;&#847;&zwnj;&nbsp;&#8203;&#847;&zwnj;&nbsp;&#8203;&#847;&zwnj;&nbsp;&#8203;
</div>

<!-- Canvas principal -->
<table
  role="presentation"
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
  class="bg"
  style="
    width:100%;
    background:${CANVAS};
  "
>

  <tr>

    <td
      align="center"
      style="
        padding:24px 10px 32px 10px;
      "
    >

      <!-- Conteneur 600px -->
      <table
        role="presentation"
        width="600"
        class="wrap"
        cellpadding="0"
        cellspacing="0"
        border="0"
        style="
          width:600px;
          max-width:600px;
        "
      >

        <!-- ================================================================
             HEADER
             LOGO UNIQUEMENT
             ================================================================ -->

        <tr>

          <td
            align="center"
            style="
              padding:0 20px 22px 20px;
              text-align:center;
            "
          >

            ${logo}

          </td>

        </tr>

        <!-- ================================================================
             CARTE PRINCIPALE
             ================================================================ -->

        <tr>

          <td
            class="card"
            style="
              background:#FFFFFF;
              border:1px solid ${LINE};
              border-radius:8px;
            "
          >

            <table
              role="presentation"
              width="100%"
              cellpadding="0"
              cellspacing="0"
              border="0"
            >

              <!-- Barre supérieure -->
              <tr>

                <td
                  style="
                    height:3px;
                    background:${INK};
                    font-size:0;
                    line-height:0;
                    border-radius:8px 8px 0 0;
                  "
                >&nbsp;</td>

              </tr>

              <!-- Contenu principal -->
              <tr>

                <td
                  class="px"
                  style="
                    padding:30px 32px 0 32px;
                  "
                >

                  <h1
                    class="h1"
                    style="
                      margin:0 0 14px;
                      font-family:${FONT};
                      font-size:22px;
                      line-height:1.32;
                      font-weight:700;
                      letter-spacing:-.01em;
                      color:${INK};
                      text-align:center;
                    "
                  >${esc(input.title)}</h1>

                  <p
                    class="body"
                    style="
                      margin:0 0 14px;
                      font-family:${FONT};
                      font-size:15px;
                      line-height:1.65;
                      color:${INK_SOFT};
                    "
                  >${esc(input.intro)}</p>

                  ${paragraphs}

                </td>

              </tr>

              <!-- Code -->
              ${codeBlock}

              <!-- Tableau -->
              ${detailsBlock}

              <!-- Encart -->
              ${noticeBlock}

              <!-- CTA -->
              ${ctaBlock}

              <!-- Sécurité / aide -->
              <tr>

                <td
                  class="px"
                  style="
                    padding:24px 32px 28px 32px;
                  "
                >

                  <hr
                    class="divider"
                    style="
                      border:none;
                      border-top:1px solid ${LINE};
                      margin:0 0 14px;
                    "
                  />

                  <p
                    class="muted"
                    style="
                      margin:0 0 6px;
                      font-family:${FONT};
                      font-size:12px;
                      line-height:1.6;
                      color:${GREY};
                    "
                  >${esc(input.securityNotice)}</p>

                  <p
                    class="muted"
                    style="
                      margin:0;
                      font-family:${FONT};
                      font-size:12px;
                      line-height:1.6;
                      color:${GREY};
                    "
                  >${esc(input.helpText)}</p>

                </td>

              </tr>

            </table>

          </td>

        </tr>

        <!-- ================================================================
             FOOTER
             LOGO UNIQUEMENT POUR LA MARQUE
             ================================================================ -->

        <tr>

          <td
            class="foot px"
            style="
              padding:18px 12px 0 12px;
              font-family:${FONT};
              font-size:11px;
              line-height:1.7;
              color:${GREY};
              text-align:center;
            "
          >

            <!-- Logo centré -->
            <table
              role="presentation"
              width="100%"
              cellpadding="0"
              cellspacing="0"
              border="0"
              style="width:100%;"
            >

              <tr>

                <td
                  align="center"
                  style="text-align:center;"
                >

                  ${footerLogo}

                </td>

              </tr>

            </table>

            <!-- Coordonnées -->
            <p
              style="
                margin:12px 0 0;
                font-family:${FONT};
                font-size:11px;
                line-height:1.7;
                color:${GREY};
              "
            >

              ${esc(BRAND_ADDRESS)}
              <br/>

              <a
                href="mailto:${BRAND_EMAIL}"
                style="
                  color:${GREY};
                  text-decoration:none;
                "
              >${BRAND_EMAIL}</a>

              &nbsp;·&nbsp;

              <a
                href="tel:${BRAND_PHONE.replace(/\s/g, "")}"
                style="
                  color:${GREY};
                  text-decoration:none;
                "
              >${esc(BRAND_PHONE)}</a>

            </p>

            <!-- Mentions légales -->
            <p
              style="
                margin:10px 0 0;
                font-family:${FONT};
                font-size:11px;
                line-height:1.7;
                color:${GREY_LIGHT};
              "
            >${esc(input.legalText)}</p>

            <!-- Message automatique -->
            <p
              style="
                margin:6px 0 0;
                font-family:${FONT};
                font-size:11px;
                line-height:1.7;
                color:${GREY_LIGHT};
              "
            >${esc(input.autoText)}</p>

            <!-- Copyright -->
            <p
              style="
                margin:10px 0 0;
                font-family:${FONT};
                font-size:11px;
                line-height:1.7;
                color:${GREY_LIGHT};
              "
            >© ${new Date().getFullYear()} ${BRAND_NAME}</p>

          </td>

        </tr>

      </table>

    </td>

  </tr>

</table>

</body>
</html>`;
}

