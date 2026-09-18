/**
 * Contrat de prêt personnel MOONYP — document contractuel multipage.
 *
 * Le document est produit côté serveur par la fabrique documentaire commune
 * (`src/lib/pdf/doc-kit.server.ts`) à partir des seules données faisant foi
 * (dossier Supabase + offre acceptée). Aucune valeur n'est inventée ici :
 * chaque champ absent est rendu « non précisé ».
 *
 * Structure : page de couverture (référence dossier, référence document, date,
 * parties, montant), puis 7 titres et 18 articles numérotés, un tableau des
 * conditions financières, les encadrés réglementaires, le cartouche de
 * signatures électroniques et l'empreinte documentaire. En-tête, pied de page
 * et pagination « Page X / Y » sur toutes les pages.
 */
import { Buffer } from "node:buffer";
import {
  BankDocument,
  LENDER,
  dateTime,
  documentReference,
  longDate,
  money,
  percent,
  storeDocument,
} from "@/lib/pdf/doc-kit.server";
import { docLocale, docText } from "@/lib/pdf/doc-i18n.server";
import { docEnum } from "@/lib/pdf/doc-enums.server";

/** Langue de mise en page du document (repli anglais). */
export function pdfLocale(language: string | null | undefined): string {
  return docLocale(language);
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
  /** Champs enrichis (facultatifs : rendus « non précisé » s'ils manquent). */
  apr?: number | null;
  phone?: string | null;
  birthDate?: string | null;
  country?: string | null;
  iban?: string | null;
  offerValidUntil?: string | null;
  issuedAt?: string | null;
  signature?: {
    name: string;
    signedAt: string;
    reference: string;
    provider: string;
    qualified: boolean;
    documentHash: string;
    ip?: string | null;
    seal?: string | null;
  } | null;
}

const DASH = "—";

/** Construit le PDF et renvoie ses octets, son empreinte SHA-256 et le nombre de pages. */
export async function buildContractPdf(
  input: ContractInput,
): Promise<{ bytes: Uint8Array; hash: string; pages: number }> {
  const lang = docLocale(input.language);
  const t = (key: string) => docText(lang, `contract.${key}`);
  const p = (key: string) => docText(lang, `parties.${key}`);
  const label = (key: string) => docText(lang, `labels.${key}`);
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const cur = (input.currency || "EUR").toUpperCase();
  const amount = (value: number) => money(value, cur, lang);
  const orDash = (value: string | null | undefined) =>
    value && value.trim() ? value.trim() : t("notSpecified");
  const docRef = documentReference("CTR", input.reference, input.version);

  const doc = await BankDocument.create({
    title: t("title"),
    kicker: t("kicker"),
    fileReference: input.reference,
    documentReference: docRef,
    version: input.version,
    language: lang,
    issuedAt,
    footerNote: t("footer"),
    labels: {
      page: label("page"),
      of: "/",
      fileRef: label("fileRef"),
      docRef: label("docRef"),
      version: label("version"),
      issuedOn: label("issuedOn"),
      continued: label("continued"),
    },
  });

  /* --------------------------- page de couverture -------------------------- */

  doc.cover({
    subtitle: t("subtitle"),
    partiesTitle: t("partiesTitle"),
    notice: t("coverNotice"),
    highlight: { label: t("amountLabel"), value: amount(input.amount), note: t("amountNote") },
    blocks: [
      {
        label: p("lender"),
        lines: [
          LENDER.name,
          LENDER.legalForm,
          LENDER.address,
          LENDER.registry,
          `${p("email")} : ${LENDER.email}`,
        ],
      },
      {
        label: p("borrower"),
        lines: [
          orDash(input.borrower),
          input.birthDate
            ? `${p("birthDate")} : ${longDate(input.birthDate, lang)}`
            : `${p("birthDate")} : ${t("notSpecified")}`,
          orDash(input.address),
          `${p("email")} : ${orDash(input.email)}`,
          `${p("phone")} : ${orDash(input.phone)}`,
        ],
      },
    ],
  });

  /* -------------------------- Titre I — Parties --------------------------- */

  doc.pageBreak();
  const article = (number: number, title: string) =>
    doc.article(`${label("article")} ${number}`, title);
  doc.sectionTitle(t("s1"));
  article(1, t("a1t"));
  doc.paragraph(t("a1b"));
  doc.keyValue(`${p("lender")} — ${p("legalIdentity")}`, `${LENDER.name} · ${LENDER.registry}`);
  doc.keyValue(`${p("lender")} — ${p("address")}`, LENDER.address);
  doc.keyValue(`${p("lender")} — ${p("compliance")}`, `${LENDER.compliance} · ${LENDER.email}`);
  doc.keyValue(`${p("borrower")} — ${p("name")}`, orDash(input.borrower));
  doc.keyValue(`${p("borrower")} — ${p("address")}`, orDash(input.address));
  doc.keyValue(`${p("borrower")} — ${p("country")}`, orDash(input.country));
  doc.keyValue(`${p("borrower")} — ${p("email")}`, orDash(input.email));
  doc.space(6);
  article(2, t("a2t"));
  doc.paragraph(t("a2b"));
  doc.keyValue(t("rowPurpose"), orDash(input.purpose));

  /* ---------------- Titre II — Conditions financières --------------------- */

  doc.sectionTitle(t("s2"));
  article(3, t("a3t"));
  doc.paragraph(t("a3b"));
  article(4, t("a4t"));
  doc.paragraph(t("a4b"));
  article(5, t("a5t"));
  doc.paragraph(t("a5b"));
  article(6, t("a6t"));
  doc.paragraph(t("a6b"));
  article(7, t("a7t"));
  doc.paragraph(t("a7b"));

  const totalMonthly = Number(input.monthly ?? 0) + Number(input.insuranceMonthly ?? 0);
  const totalRepaid = Number(input.amount ?? 0) + Number(input.totalCost ?? 0);
  const rows: string[][] = [
    [t("rowAmount"), amount(input.amount)],
    [t("rowDuration"), input.months > 0 ? `${input.months} ${t("rowMonths")}` : t("notSpecified")],
    [t("rowRate"), input.rate > 0 ? percent(input.rate, lang) : t("notSpecified")],
    [
      t("rowApr"),
      input.apr && input.apr > 0
        ? percent(input.apr, lang)
        : input.rate > 0
          ? percent(input.rate, lang)
          : t("notSpecified"),
    ],
    [t("rowMonthly"), amount(input.monthly)],
  ];
  if (Number(input.insuranceMonthly ?? 0) > 0) {
    rows.push([t("rowInsurance"), amount(input.insuranceMonthly)]);
    rows.push([t("rowTotalMonthly"), amount(totalMonthly)]);
  }
  rows.push([t("rowFees"), amount(input.fees)]);
  rows.push([t("rowCurrency"), cur]);
  if (input.offerValidUntil) rows.push([t("rowOfferValid"), longDate(input.offerValidUntil, lang)]);
  if (input.iban) rows.push([t("rowIban"), input.iban]);
  rows.push([t("rowTotalCost"), amount(input.totalCost)]);
  rows.push([t("rowTotalRepaid"), amount(totalRepaid)]);

  doc.space(4);
  doc.sectionTitle(t("tableTitle"));
  doc.table(
    [
      { header: t("colItem"), width: 62 },
      { header: t("colValue"), width: 38, align: "right" },
    ],
    rows,
    { highlightLast: true },
  );
  doc.callout(t("calloutAprTitle"), t("calloutAprBody"));

  /* --------------- Titre III — Décaissement & remboursement --------------- */

  doc.sectionTitle(t("s3"));
  article(8, t("a8t"));
  doc.paragraph(t("a8b"));
  article(9, t("a9t"));
  doc.paragraph(t("a9b"));
  article(10, t("a10t"));
  doc.paragraph(t("a10b"));

  /* -------------------- Titre IV — Obligations des parties ---------------- */

  doc.sectionTitle(t("s4"));
  article(11, t("a11t"));
  doc.paragraph(t("a11b"));
  article(12, t("a12t"));
  doc.paragraph(t("a12b"));

  /* --------------- Titre V — Assurance, garantie, incidents --------------- */

  doc.sectionTitle(t("s5"));
  article(13, t("a13t"));
  doc.paragraph(t("a13b"));
  article(14, t("a14t"));
  doc.paragraph(t("a14b"));

  /* ------------------ Titre VI — Dispositions juridiques ------------------ */

  doc.sectionTitle(t("s6"));
  article(15, t("a15t"));
  doc.paragraph(t("a15b"));
  doc.callout(t("calloutWithdrawalTitle"), t("calloutWithdrawalBody"));
  article(16, t("a16t"));
  doc.paragraph(t("a16b"));
  article(17, t("a17t"));
  doc.paragraph(t("a17b"));
  article(18, t("a18t"));
  doc.paragraph(t("a18b"));

  /* ------------------- Titre VII — Signatures électroniques --------------- */

  doc.sectionTitle(t("s7"));
  doc.paragraph(t("sigIntro"));
  doc.signatureBlocks({
    left: {
      title: t("sigLender"),
      name: LENDER.name,
      place: t("sigPlace"),
      mention: t("sigLenderMention"),
    },
    right: {
      title: t("sigBorrower"),
      name: input.signature?.name || orDash(input.borrower),
      mention: input.signature ? t("sigBorrowerMention") : t("pendingMention"),
      signedLine: input.signature
        ? `${t("signedOn")} ${dateTime(input.signature.signedAt, lang)}`
        : undefined,
    },
  });

  if (input.signature) {
    doc.keyValue(t("signedBy"), input.signature.name);
    doc.keyValue(
      t("provider"),
      docEnum(lang, "signatureProvider", input.signature.provider) ?? input.signature.provider,
    );
    doc.keyValue(t("signatureRef"), input.signature.reference);
    if (input.signature.ip) doc.keyValue(t("signerIp"), input.signature.ip);
    doc.paragraph(input.signature.qualified ? t("qualifiedNotice") : t("advancedNotice"), {
      size: 8.2,
      italic: true,
      muted: true,
    });
  }

  const fpRows: Array<[string, string]> = [
    [t("fpVersion"), `${docRef} · ${label("version")} ${input.version}`],
    [t("fpGeneratedAt"), dateTime(issuedAt, lang)],
  ];
  if (input.signature?.documentHash) fpRows.push([t("fpDraftHash"), input.signature.documentHash]);
  if (input.signature?.seal) fpRows.push([t("fpSeal"), input.signature.seal]);
  doc.space(4);
  doc.fingerprint(t("fingerprintTitle"), fpRows, t("fpNote"));

  return doc.finish();
}

/** Dépose le PDF dans le bucket privé et renvoie son chemin. */
export async function storeContractPdf(
  applicationId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  return storeDocument(applicationId, fileName, bytes);
}

export type ContractBuildResult = Awaited<ReturnType<typeof buildContractPdf>>;
