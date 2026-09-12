/**
 * Fabrique documentaire bancaire MOONYP (moteur unique).
 *
 * Toutes les pièces contractuelles du dossier (contrat de prêt, acte de
 * garantie, notice d'assurance) sont produites par ce moteur : même charte,
 * même page de couverture, mêmes en-têtes/pieds de page, même pagination
 * « Page X / Y », même bloc d'empreinte documentaire.
 *
 * Points d'attention :
 *  - Aucune donnée n'est inventée ici : le moteur ne met en page que les
 *    valeurs qui lui sont transmises par l'appelant (Supabase = source de
 *    vérité).
 *  - Encodage : les polices standard PDF utilisent WinAnsi, qui couvre le
 *    latin étendu ET le symbole €. `winAnsi()` normalise les espaces
 *    insécables/fines et translittère ce que WinAnsi ne peut pas encoder,
 *    de sorte que « 5 000,00 € » s'affiche toujours correctement.
 */
import { createHash } from "crypto";
import { Buffer } from "node:buffer";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { MOONYP_LOGO_PNG_BASE64 } from "@/lib/pdf/brand-logo.server";

/* ------------------------------------------------------------------------ *
 * Encodage texte (WinAnsi + €)
 * ------------------------------------------------------------------------ */

/** Lettres non couvertes par WinAnsi : translittération lisible. */
const TRANSLIT: Record<string, string> = {
  ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i", ș: "s", Ș: "S", ț: "t", Ț: "T",
  ő: "o", Ő: "O", ű: "u", Ű: "U", ć: "c", Ć: "C", č: "c", Č: "C", ě: "e", Ě: "E",
  ř: "r", Ř: "R", ů: "u", Ů: "U", ą: "a", Ą: "A", ę: "e", Ę: "E", ń: "n", Ń: "N",
  ś: "s", Ś: "S", ź: "z", Ź: "Z", ż: "z", Ż: "Z", ľ: "l", Ľ: "L", ĺ: "l", Ĺ: "L",
  ň: "n", Ň: "N", ť: "t", Ť: "T", ď: "d", Ď: "D", ā: "a", ē: "e", ī: "i", ū: "u",
};

/** Caractères typographiques ramenés à un équivalent WinAnsi sûr. */
const TYPO: Array<[RegExp, string]> = [
  [/[\u00A0\u202F\u2007\u2009\u200A\u2028\u2060]/g, " "], // espaces insécables / fines
  [/[\u2018\u2019\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/\u2026/g, "..."],
  [/[\u2212\u2012\u2015]/g, "-"],
  [/\u00AD/g, ""],
  [/\t/g, "    "],
];

/**
 * Rend une chaîne encodable par les polices standard PDF (WinAnsi).
 * Le symbole € (U+20AC) est explicitement préservé, ainsi que les accents
 * latins ; le reste est translittéré, puis remplacé en dernier recours.
 */
export function winAnsi(input: string): string {
  let value = String(input ?? "");
  for (const [re, to] of TYPO) value = value.replace(re, to);
  value = value.replace(/[^\x00-\x7F]/g, (c) => TRANSLIT[c] ?? c);
  // Décomposition : on conserve les diacritiques latins recomposables.
  value = value.normalize("NFC");
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF\u20AC\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u2022\u2013\u2014]/g, "?");
}

/* ------------------------------------------------------------------------ *
 * Formatage localisé (montants, dates, pourcentages)
 * ------------------------------------------------------------------------ */

const LOCALE_MAP: Record<string, string> = {
  fr: "fr-FR", en: "en-GB", de: "de-DE", es: "es-ES", it: "it-IT", nl: "nl-NL",
  pl: "pl-PL", ro: "ro-RO", sk: "sk-SK", sl: "sl-SI", hr: "hr-HR", hu: "hu-HU",
  fi: "fi-FI", bg: "bg-BG", el: "el-GR",
};

export function intlLocale(language: string | null | undefined): string {
  const lang = (language ?? "en").slice(0, 2).toLowerCase();
  return LOCALE_MAP[lang] ?? "en-GB";
}

/** « 5 000,00 € », « 175,19 € », « £1,250.00 » … toujours encodable. */
export function money(value: number, currency: string, language: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  try {
    return winAnsi(
      new Intl.NumberFormat(intlLocale(language), {
        style: "currency",
        currency: (currency || "EUR").toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount),
    );
  } catch {
    return winAnsi(`${amount.toFixed(2)} ${(currency || "EUR").toUpperCase()}`);
  }
}

export function percent(value: number, language: string): string {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return winAnsi(`${new Intl.NumberFormat(intlLocale(language), { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(n)} %`);
  } catch {
    return `${n.toFixed(2)} %`;
  }
}

export function longDate(value: Date | string | null | undefined, language: string): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return winAnsi(new Intl.DateTimeFormat(intlLocale(language), { day: "2-digit", month: "long", year: "numeric" }).format(d));
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function dateTime(value: Date | string | null | undefined, language: string): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return winAnsi(
      new Intl.DateTimeFormat(intlLocale(language), {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      }).format(d) + " UTC",
    );
  } catch {
    return d.toISOString();
  }
}

/* ------------------------------------------------------------------------ *
 * Charte graphique institutionnelle (sobre, bancaire)
 * ------------------------------------------------------------------------ */

export const INK = rgb(0.09, 0.11, 0.16);
export const MUTED = rgb(0.42, 0.45, 0.52);
export const NAVY = rgb(0.05, 0.14, 0.31);
export const NAVY_SOFT = rgb(0.93, 0.95, 0.98);
export const RULE = rgb(0.82, 0.84, 0.88);
export const RULE_SOFT = rgb(0.91, 0.92, 0.95);
export const WHITE = rgb(1, 1, 1);
export const SEAL = rgb(0.65, 0.11, 0.15);

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 62;
const FOOTER_Y = 46;
const BODY_TOP = PAGE_H - HEADER_H - 26;
const BODY_BOTTOM = FOOTER_Y + 30;

/** Identité complète du prêteur (mentions légales du site). */
export const LENDER = {
  name: "MOONYP SAS",
  legalForm: "Société par actions simplifiée au capital de 1 000 000 EUR",
  address: "1 Centenary Square, Birmingham, B1 1HQ, Royaume-Uni",
  registry: "RCS Birmingham 000 000 000",
  email: "support@moonyp.com",
  site: "moonyp.com",
  compliance: "Service Conformité MOONYP",
} as const;

export interface DocMeta {
  /** Intitulé du document (ex. « Contrat de prêt personnel »). */
  title: string;
  /** Sur-titre institutionnel (ex. « Contrat de crédit »). */
  kicker: string;
  /** Référence du dossier de crédit (Supabase). */
  fileReference: string;
  /** Référence propre du document (ex. CTR-XXXX-V2). */
  documentReference: string;
  version: number;
  language: string;
  issuedAt: Date;
  /** Ligne de pied de page (mentions). */
  footerNote: string;
  /** Libellés génériques réutilisés par le moteur. */
  labels: {
    page: string;
    of: string;
    fileRef: string;
    docRef: string;
    version: string;
    issuedOn: string;
    continued: string;
  };
}

export interface TableColumn {
  header: string;
  /** Largeur relative (somme libre, normalisée). */
  width: number;
  align?: "left" | "right";
}

/** Constructeur de document paginé. */
export class BankDocument {
  private constructor(
    private pdf: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private italic: PDFFont,
    private logo: PDFImage,
    private meta: DocMeta,
  ) {}

  private pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = BODY_TOP;
  private isCover = false;

  static async create(meta: DocMeta): Promise<BankDocument> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(winAnsi(`${meta.title} — ${meta.fileReference}`));
    pdf.setSubject(winAnsi(meta.kicker));
    pdf.setAuthor("MOONYP SAS");
    pdf.setCreator("MOONYP — Fabrique documentaire");
    pdf.setProducer("MOONYP Document Engine");
    pdf.setCreationDate(meta.issuedAt);
    pdf.setLanguage(meta.language.slice(0, 2).toLowerCase());

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
    const logo = await pdf.embedPng(Buffer.from(MOONYP_LOGO_PNG_BASE64, "base64"));

    return new BankDocument(pdf, font, bold, italic, logo, meta);
  }

  /* ------------------------------- pages ------------------------------- */

  private newPage(cover = false) {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.isCover = cover;
    if (cover) {
      this.y = PAGE_H - 96;
    } else {
      this.drawRunningHeader();
      this.y = BODY_TOP;
    }
  }

  private drawRunningHeader() {
    const logoW = 84;
    const logoH = (this.logo.height / this.logo.width) * logoW;
    this.page.drawImage(this.logo, { x: MARGIN, y: PAGE_H - 34 - logoH / 2, width: logoW, height: logoH });

    const right = PAGE_W - MARGIN;
    const l1 = winAnsi(`${this.meta.labels.docRef} ${this.meta.documentReference}`);
    const l2 = winAnsi(`${this.meta.labels.fileRef} ${this.meta.fileReference} · ${this.meta.labels.version} ${this.meta.version}`);
    this.page.drawText(l1, { x: right - this.bold.widthOfTextAtSize(l1, 8), y: PAGE_H - 32, size: 8, font: this.bold, color: NAVY });
    this.page.drawText(l2, { x: right - this.font.widthOfTextAtSize(l2, 7.5), y: PAGE_H - 43, size: 7.5, font: this.font, color: MUTED });

    this.page.drawLine({
      start: { x: MARGIN, y: PAGE_H - HEADER_H },
      end: { x: right, y: PAGE_H - HEADER_H },
      thickness: 0.8,
      color: NAVY,
    });
  }

  /** Réserve `height` points ; ouvre une page si nécessaire. */
  private ensure(height: number) {
    if (this.pages.length === 0) this.newPage();
    if (this.y - height < BODY_BOTTOM) this.newPage();
  }

  pageBreak() {
    this.newPage();
  }

  space(h = 10) {
    this.y -= h;
  }

  /* ------------------------------ couverture --------------------------- */

  cover(input: {
    subtitle: string;
    blocks: Array<{ label: string; lines: string[] }>;
    highlight?: { label: string; value: string; note?: string };
    notice?: string;
    partiesTitle?: string;
  }) {
    this.newPage(true);
    const logoW = 168;
    const logoH = (this.logo.height / this.logo.width) * logoW;
    this.page.drawImage(this.logo, { x: MARGIN, y: PAGE_H - 78 - logoH, width: logoW, height: logoH });

    this.page.drawLine({ start: { x: MARGIN, y: PAGE_H - 170 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 170 }, thickness: 1.4, color: NAVY });

    let y = PAGE_H - 208;
    this.page.drawText(winAnsi(this.meta.kicker.toUpperCase()), {
      x: MARGIN, y, size: 9, font: this.bold, color: MUTED,
    });
    y -= 34;
    for (const line of this.wrapLines(this.meta.title, this.bold, 26, CONTENT_W)) {
      this.page.drawText(line, { x: MARGIN, y, size: 26, font: this.bold, color: INK });
      y -= 32;
    }
    for (const line of this.wrapLines(input.subtitle, this.font, 11, CONTENT_W)) {
      this.page.drawText(line, { x: MARGIN, y, size: 11, font: this.font, color: MUTED });
      y -= 16;
    }

    // Bloc références du document / dossier
    y -= 18;
    const refH = 74;
    this.page.drawRectangle({ x: MARGIN, y: y - refH, width: CONTENT_W, height: refH, color: NAVY_SOFT, borderColor: RULE, borderWidth: 0.8 });
    const cellW = CONTENT_W / 3;
    const refs: Array<[string, string]> = [
      [this.meta.labels.fileRef, this.meta.fileReference],
      [this.meta.labels.docRef, `${this.meta.documentReference}`],
      [this.meta.labels.issuedOn, longDate(this.meta.issuedAt, this.meta.language)],
    ];
    refs.forEach(([label, value], i) => {
      const x = MARGIN + cellW * i + 14;
      this.page.drawText(winAnsi(label.toUpperCase()), { x, y: y - 26, size: 7.5, font: this.bold, color: MUTED });
      for (const [j, line] of this.wrapLines(value, this.bold, 11, cellW - 24).slice(0, 2).entries()) {
        this.page.drawText(line, { x, y: y - 44 - j * 13, size: 11, font: this.bold, color: NAVY });
      }
    });
    y -= refH + 26;

    if (input.partiesTitle) {
      this.page.drawText(winAnsi(input.partiesTitle.toUpperCase()), { x: MARGIN, y, size: 8.5, font: this.bold, color: MUTED });
      y -= 16;
    }

    // Parties (deux colonnes)
    const colW = (CONTENT_W - 18) / 2;
    let blockBottom = y;
    input.blocks.forEach((block, i) => {
      const x = MARGIN + (colW + 18) * (i % 2);
      let by = y - Math.floor(i / 2) * 132;
      this.page.drawText(winAnsi(block.label.toUpperCase()), { x, y: by, size: 7.5, font: this.bold, color: NAVY });
      by -= 15;
      for (const raw of block.lines) {
        for (const line of this.wrapLines(raw, this.font, 9.5, colW)) {
          this.page.drawText(line, { x, y: by, size: 9.5, font: this.font, color: INK });
          by -= 13;
        }
      }
      blockBottom = Math.min(blockBottom, by);
    });
    y = blockBottom - 22;

    if (input.highlight) {
      const boxH = 82;
      this.page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: WHITE, borderColor: NAVY, borderWidth: 1 });
      this.page.drawRectangle({ x: MARGIN, y: y - boxH, width: 4, height: boxH, color: NAVY });
      this.page.drawText(winAnsi(input.highlight.label.toUpperCase()), { x: MARGIN + 20, y: y - 26, size: 8, font: this.bold, color: MUTED });
      this.page.drawText(winAnsi(input.highlight.value), { x: MARGIN + 20, y: y - 56, size: 24, font: this.bold, color: NAVY });
      if (input.highlight.note) {
        this.page.drawText(winAnsi(input.highlight.note), { x: MARGIN + 20, y: y - 72, size: 8.5, font: this.font, color: MUTED });
      }
      y -= boxH + 22;
    }

    if (input.notice) {
      for (const line of this.wrapLines(input.notice, this.italic, 8.5, CONTENT_W)) {
        this.page.drawText(line, { x: MARGIN, y, size: 8.5, font: this.italic, color: MUTED });
        y -= 12;
      }
    }
  }

  /* -------------------------------- texte ------------------------------ */

  /** Titre de section (« Titre I — Parties »). */
  sectionTitle(text: string) {
    this.ensure(52);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: CONTENT_W, height: 22, color: NAVY });
    this.page.drawText(winAnsi(text.toUpperCase()), { x: MARGIN + 12, y: this.y + 2, size: 9.5, font: this.bold, color: WHITE });
    this.y -= 34;
  }

  /** Article numéroté : « Article 4 — Taux et TAEG ». */
  article(number: string, title: string) {
    this.ensure(46);
    const label = winAnsi(number);
    this.page.drawText(label, { x: MARGIN, y: this.y, size: 10, font: this.bold, color: NAVY });
    const offset = this.bold.widthOfTextAtSize(label, 10) + 8;
    for (const [i, line] of this.wrapLines(title, this.bold, 10, CONTENT_W - offset).entries()) {
      this.page.drawText(line, { x: MARGIN + offset, y: this.y - i * 13, size: 10, font: this.bold, color: INK });
    }
    this.y -= 18;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.5, color: RULE_SOFT });
    this.y -= 12;
  }

  paragraph(text: string, options: { size?: number; italic?: boolean; muted?: boolean; indent?: number } = {}) {
    const size = options.size ?? 9.5;
    const font = options.italic ? this.italic : this.font;
    const color = options.muted ? MUTED : INK;
    const indent = options.indent ?? 0;
    for (const line of this.wrapLines(text, font, size, CONTENT_W - indent)) {
      this.ensure(size + 5);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color });
      this.y -= size + 4.2;
    }
    this.y -= 4;
  }

  bullets(items: string[]) {
    for (const item of items) {
      const lines = this.wrapLines(item, this.font, 9.5, CONTENT_W - 16);
      this.ensure(lines.length * 14);
      this.page.drawText("\u2022", { x: MARGIN + 3, y: this.y, size: 9.5, font: this.bold, color: NAVY });
      for (const line of lines) {
        this.page.drawText(line, { x: MARGIN + 16, y: this.y, size: 9.5, font: this.font, color: INK });
        this.y -= 13.6;
      }
      this.y -= 2;
    }
    this.y -= 4;
  }

  /** Ligne clé/valeur alignée (fiche d'identité, parties, signature). */
  keyValue(label: string, value: string) {
    const lines = this.wrapLines(value, this.bold, 9.5, CONTENT_W - 210);
    this.ensure(Math.max(18, lines.length * 14));
    this.page.drawText(winAnsi(label), { x: MARGIN, y: this.y, size: 9, font: this.font, color: MUTED });
    lines.forEach((line, i) => {
      this.page.drawText(line, { x: MARGIN + 200, y: this.y - i * 13, size: 9.5, font: this.bold, color: INK });
    });
    this.y -= Math.max(17, lines.length * 13 + 4);
  }

  /* -------------------------------- tableau ---------------------------- */

  table(columns: TableColumn[], rows: string[][], options: { highlightLast?: boolean } = {}) {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    const xs: number[] = [];
    let acc = MARGIN;
    for (const w of widths) {
      xs.push(acc);
      acc += w;
    }

    const drawHead = () => {
      this.ensure(30);
      this.page.drawRectangle({ x: MARGIN, y: this.y - 6, width: CONTENT_W, height: 22, color: NAVY_SOFT, borderColor: RULE, borderWidth: 0.6 });
      columns.forEach((col, i) => {
        const text = winAnsi(col.header);
        const x = col.align === "right" ? xs[i]! + widths[i]! - 10 - this.bold.widthOfTextAtSize(text, 8) : xs[i]! + 10;
        this.page.drawText(text, { x, y: this.y, size: 8, font: this.bold, color: NAVY });
      });
      this.y -= 26;
    };

    drawHead();

    rows.forEach((row, rIndex) => {
      const cellLines = row.map((cell, i) => this.wrapLines(cell, this.font, 9, widths[i]! - 20));
      const height = Math.max(...cellLines.map((l) => l.length)) * 12 + 10;
      if (this.y - height < BODY_BOTTOM) {
        this.newPage();
        drawHead();
      }
      const emphasise = options.highlightLast && rIndex === rows.length - 1;
      if (emphasise) {
        this.page.drawRectangle({ x: MARGIN, y: this.y - height + 12, width: CONTENT_W, height, color: NAVY_SOFT });
      }
      cellLines.forEach((lines, i) => {
        const font = emphasise ? this.bold : i === 0 ? this.font : this.bold;
        lines.forEach((line, j) => {
          const x =
            columns[i]!.align === "right"
              ? xs[i]! + widths[i]! - 10 - font.widthOfTextAtSize(line, 9)
              : xs[i]! + 10;
          this.page.drawText(line, { x, y: this.y - j * 12, size: 9, font, color: emphasise ? NAVY : INK });
        });
      });
      this.y -= height;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 8 },
        end: { x: PAGE_W - MARGIN, y: this.y + 8 },
        thickness: 0.5,
        color: RULE_SOFT,
      });
    });
    this.y -= 12;
  }

  /** Encadré d'information (avertissement légal, rappel réglementaire). */
  callout(title: string, body: string) {
    const lines = this.wrapLines(body, this.font, 8.8, CONTENT_W - 28);
    const height = lines.length * 12 + 34;
    this.ensure(height + 8);
    this.page.drawRectangle({ x: MARGIN, y: this.y - height + 14, width: CONTENT_W, height, color: NAVY_SOFT, borderColor: RULE, borderWidth: 0.6 });
    this.page.drawText(winAnsi(title.toUpperCase()), { x: MARGIN + 14, y: this.y, size: 8, font: this.bold, color: NAVY });
    let y = this.y - 15;
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN + 14, y, size: 8.8, font: this.font, color: INK });
      y -= 12;
    }
    this.y -= height + 6;
  }

  /* ------------------------------ signatures --------------------------- */

  /**
   * Cartouche de signature à deux colonnes. Le prêteur porte le cachet
   * institutionnel ; l'emprunteur reçoit la mention de signature électronique
   * réellement enregistrée (ou l'espace de signature si le document est encore
   * en attente).
   */
  signatureBlocks(input: {
    left: { title: string; name: string; place: string; mention: string };
    right: { title: string; name: string; mention: string; signedLine?: string };
  }) {
    const boxH = 132;
    this.ensure(boxH + 12);
    const colW = (CONTENT_W - 18) / 2;
    const top = this.y;

    // Prêteur
    this.page.drawRectangle({ x: MARGIN, y: top - boxH, width: colW, height: boxH, borderColor: RULE, borderWidth: 0.8, color: WHITE });
    this.page.drawText(winAnsi(input.left.title.toUpperCase()), { x: MARGIN + 12, y: top - 18, size: 7.5, font: this.bold, color: MUTED });
    this.page.drawText(winAnsi(input.left.name), { x: MARGIN + 12, y: top - 36, size: 11, font: this.bold, color: NAVY });
    this.page.drawText(winAnsi(input.left.place), { x: MARGIN + 12, y: top - 50, size: 8, font: this.font, color: MUTED });

    const cx = MARGIN + colW - 52;
    const cy = top - boxH / 2 - 8;
    this.page.drawCircle({ x: cx, y: cy, size: 30, borderColor: SEAL, borderWidth: 1.6, color: WHITE });
    this.page.drawCircle({ x: cx, y: cy, size: 25.5, borderColor: SEAL, borderWidth: 0.5, color: WHITE });
    this.page.drawText("MOONYP", { x: cx - this.bold.widthOfTextAtSize("MOONYP", 7.5) / 2, y: cy + 6, size: 7.5, font: this.bold, color: SEAL });
    this.page.drawText("CREDIT", { x: cx - this.bold.widthOfTextAtSize("CREDIT", 6.5) / 2, y: cy - 3, size: 6.5, font: this.bold, color: SEAL });
    this.page.drawText("BIRMINGHAM", { x: cx - this.font.widthOfTextAtSize("BIRMINGHAM", 5.5) / 2, y: cy - 13, size: 5.5, font: this.font, color: SEAL });

    for (const [i, line] of this.wrapLines(input.left.mention, this.font, 7, colW - 24).slice(0, 3).entries()) {
      this.page.drawText(line, { x: MARGIN + 12, y: top - boxH + 26 - i * 9, size: 7, font: this.font, color: MUTED });
    }

    // Emprunteur
    const rx = MARGIN + colW + 18;
    this.page.drawRectangle({ x: rx, y: top - boxH, width: colW, height: boxH, borderColor: RULE, borderWidth: 0.8, color: WHITE });
    this.page.drawText(winAnsi(input.right.title.toUpperCase()), { x: rx + 12, y: top - 18, size: 7.5, font: this.bold, color: MUTED });
    this.page.drawText(winAnsi(input.right.name), { x: rx + 12, y: top - 36, size: 11, font: this.bold, color: INK });
    if (input.right.signedLine) {
      this.page.drawText(winAnsi(input.right.signedLine), { x: rx + 12, y: top - 52, size: 8, font: this.italic, color: NAVY });
    }
    this.page.drawLine({ start: { x: rx + 12, y: top - boxH + 40 }, end: { x: rx + colW - 12, y: top - boxH + 40 }, thickness: 0.6, color: RULE });
    for (const [i, line] of this.wrapLines(input.right.mention, this.font, 7, colW - 24).slice(0, 3).entries()) {
      this.page.drawText(line, { x: rx + 12, y: top - boxH + 26 - i * 9, size: 7, font: this.font, color: MUTED });
    }

    this.y = top - boxH - 16;
  }

  /** Bloc d'empreinte documentaire (chaîne de preuve). */
  fingerprint(title: string, rows: Array<[string, string]>, note?: string) {
    this.ensure(60 + rows.length * 14);
    this.page.drawText(winAnsi(title.toUpperCase()), { x: MARGIN, y: this.y, size: 8, font: this.bold, color: MUTED });
    this.y -= 16;
    for (const [label, value] of rows) {
      this.ensure(16);
      this.page.drawText(winAnsi(label), { x: MARGIN, y: this.y, size: 8, font: this.font, color: MUTED });
      const chunks = this.wrapLines(value, this.font, 8, CONTENT_W - 190);
      chunks.forEach((line, i) => {
        this.page.drawText(line, { x: MARGIN + 180, y: this.y - i * 10, size: 8, font: this.bold, color: INK });
      });
      this.y -= Math.max(13, chunks.length * 10 + 3);
    }
    if (note) this.paragraph(note, { size: 7.8, muted: true, italic: true });
  }

  /* -------------------------------- sortie ----------------------------- */

  /** Trace les pieds de page paginés puis renvoie octets + empreinte SHA-256. */
  async finish(): Promise<{ bytes: Uint8Array; hash: string; pages: number }> {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: FOOTER_Y + 16 },
        end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 16 },
        thickness: 0.5,
        color: RULE,
      });
      const left = winAnsi(this.meta.footerNote);
      page.drawText(left, { x: MARGIN, y: FOOTER_Y, size: 7, font: this.font, color: MUTED });
      const legal = winAnsi(`${LENDER.name} · ${LENDER.address} · ${LENDER.registry}`);
      page.drawText(legal, { x: MARGIN, y: FOOTER_Y - 9, size: 6.5, font: this.font, color: MUTED });

      const pageLabel = winAnsi(`${this.meta.labels.page} ${index + 1} / ${total}`);
      page.drawText(pageLabel, {
        x: PAGE_W - MARGIN - this.bold.widthOfTextAtSize(pageLabel, 7.5),
        y: FOOTER_Y,
        size: 7.5,
        font: this.bold,
        color: NAVY,
      });
      const ref = winAnsi(`${this.meta.documentReference}`);
      page.drawText(ref, {
        x: PAGE_W - MARGIN - this.font.widthOfTextAtSize(ref, 6.5),
        y: FOOTER_Y - 9,
        size: 6.5,
        font: this.font,
        color: MUTED,
      });
    });

    const bytes = await this.pdf.save();
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    return { bytes, hash, pages: total };
  }

  /* ------------------------------- interne ----------------------------- */

  private wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const safe = winAnsi(text ?? "");
    const out: string[] = [];
    for (const paragraph of safe.split("\n")) {
      if (!paragraph.trim()) {
        out.push("");
        continue;
      }
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
          current = candidate;
        } else {
          out.push(current);
          current = word;
        }
      }
      if (current) out.push(current);
    }
    return out;
  }
}

/** Dépose un document dans le bucket privé `contracts`. */
export async function storeDocument(
  applicationId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `${applicationId}/${fileName}`;
  const { error } = await supabaseAdmin.storage
    .from("contracts")
    .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

/** Référence documentaire lisible : CTR-REF-V2, GAR-REF-V1, ASS-REF-V1. */
export function documentReference(prefix: string, fileReference: string, version: number): string {
  const base = (fileReference || "DOSSIER").replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
  return `${prefix}-${base}-V${version}`;
}
