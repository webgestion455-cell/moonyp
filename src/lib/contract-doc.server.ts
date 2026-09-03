/**
 * Génération du contrat PDF d'un dossier de financement.
 *
 * Le document est produit côté serveur à partir des données faisant foi
 * (dossier + offre acceptée), versionné, empreinté (SHA-256) puis déposé dans
 * le bucket privé `contracts`. Aucune donnée n'est reprise du navigateur.
 */
import { createHash } from "crypto";
import { Buffer } from "node:buffer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tServer } from "@/lib/workflow.server";

/** Les polices standard PDF sont latines : on translittère le reste. */
const TRANSLIT: Record<string, string> = {
  ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i", ș: "s", Ș: "S", ț: "t", Ț: "T",
  ő: "o", Ő: "O", ű: "u", Ű: "U", œ: "oe", Œ: "OE", æ: "ae", Æ: "AE",
};

function latin(value: string): string {
  return value
    .replace(/[łŁđĐıșȘțȚőŐűŰœŒæÆ]/g, (c) => TRANSLIT[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, (m) => (/[\u0300-\u0303\u0308\u030a\u0327]/.test(m) ? m : ""))
    .normalize("NFC")
    .replace(/[^\u0000-\u00ff]/g, "?");
}

/** Les alphabets non latins ne sont pas rendus par les polices standard. */
const LATIN_LOCALES = new Set(["fr", "en", "de", "es", "it", "nl", "pl", "ro", "sk", "sl", "hr", "hu", "fi"]);
export function pdfLocale(language: string | null | undefined): string {
  const lang = (language ?? "en").slice(0, 2).toLowerCase();
  return LATIN_LOCALES.has(lang) ? lang : "en";
}

export interface ContractInput {
  reference: string;
  language: string;
  version: number;
  borrower: string;
  address: string;
  email: string;
  amount: number;
  months: number;
  rate: number;
  monthly: number;
  totalCost: number;
  insuranceMonthly: number;
  fees: number;
  currency: string;
  purpose: string | null;
  signature?: {
    name: string;
    signedAt: string;
    reference: string;
    provider: string;
    qualified: boolean;
    documentHash: string;
  } | null;
}

function money(value: number, currency: string, locale: string): string {
  return latin(
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value),
  );
}

/** Construit le PDF et renvoie ses octets + son empreinte SHA-256. */
export async function buildContractPdf(input: ContractInput): Promise<{ bytes: Uint8Array; hash: string }> {
  const locale = pdfLocale(input.language);
  const t = (key: string, vars: Record<string, string> = {}) => latin(tServer(locale, `contractDoc.${key}`, vars));

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.09, 0.12);
  const muted = rgb(0.42, 0.45, 0.5);
  const brand = rgb(0.05, 0.35, 0.55);

  let y = 800;
  const left = 56;
  const write = (text: string, size = 10, useBold = false, color = ink, x = left) => {
    page.drawText(text, { x, y, size, font: useBold ? bold : font, color });
    y -= size + 6;
  };
  const gap = (n = 10) => {
    y -= n;
  };
  const line = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 10, font, color: muted });
    page.drawText(value, { x: 300, y, size: 10, font: bold, color: ink });
    y -= 18;
  };

  page.drawRectangle({ x: 0, y: 792, width: 595.28, height: 50, color: brand });
  page.drawText("MOONYP", { x: left, y: 810, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(t("subtitle"), { x: left + 100, y: 814, size: 9, font, color: rgb(0.9, 0.94, 1) });

  y = 750;
  write(t("title"), 17, true);
  write(`${t("reference")} ${latin(input.reference)}  ·  ${t("version")} ${input.version}`, 9, false, muted);
  write(`${t("issuedOn")} ${latin(new Date().toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" }))}`, 9, false, muted);
  gap();

  write(t("partiesTitle"), 12, true);
  line(t("lender"), "MOONYP SAS");
  line(t("borrower"), latin(input.borrower));
  line(t("address"), latin(input.address));
  line(t("email"), latin(input.email));
  gap();

  write(t("termsTitle"), 12, true);
  line(t("amount"), money(input.amount, input.currency, locale));
  line(t("duration"), `${input.months} ${t("months")}`);
  line(t("rate"), `${input.rate.toFixed(2)} %`);
  line(t("monthly"), money(input.monthly, input.currency, locale));
  if (input.insuranceMonthly > 0) line(t("insurance"), money(input.insuranceMonthly, input.currency, locale));
  line(t("fees"), money(input.fees, input.currency, locale));
  line(t("totalCost"), money(input.totalCost, input.currency, locale));
  line(t("purpose"), latin(input.purpose ?? t("notSpecified")));
  gap();

  write(t("commitmentsTitle"), 12, true);
  for (const clause of ["clause1", "clause2", "clause3"]) {
    const text = t(clause);
    for (const chunk of wrap(text, 96)) write(chunk, 9.5, false, muted);
    gap(2);
  }

  gap(6);
  write(t("signatureTitle"), 12, true);
  if (input.signature) {
    line(t("signedBy"), latin(input.signature.name));
    line(t("signedOn"), latin(new Date(input.signature.signedAt).toLocaleString(locale)));
    line(t("provider"), latin(input.signature.provider));
    line(t("signatureRef"), latin(input.signature.reference));
    line(t("documentHash"), input.signature.documentHash.slice(0, 40));
    for (const chunk of wrap(t(input.signature.qualified ? "qualifiedNotice" : "advancedNotice"), 96)) {
      write(chunk, 8.5, false, muted);
    }
  } else {
    for (const chunk of wrap(t("pendingSignature"), 96)) write(chunk, 9.5, false, muted);
  }

  page.drawText(latin(tServer(locale, "contractDoc.footer")), {
    x: left,
    y: 42,
    size: 8,
    font,
    color: muted,
  });

  const bytes = await pdf.save();
  const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  return { bytes, hash };
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > max) {
      lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/** Dépose le PDF dans le bucket privé et renvoie son chemin. */
export async function storeContractPdf(
  applicationId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = `${applicationId}/${fileName}`;
  const { error } = await supabaseAdmin.storage
    .from("contracts")
    .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}
