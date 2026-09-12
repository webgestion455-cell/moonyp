/**
 * Acte de garantie MOONYP — document contractuel séparé, multipage.
 *
 * Produit par la même fabrique documentaire que le contrat de prêt
 * (`src/lib/pdf/doc-kit.server.ts`) : logo, page de couverture, en-tête et pied
 * de page paginés, articles numérotés, tableau des conditions, cartouche de
 * signature électronique et empreinte documentaire.
 *
 * Toutes les valeurs proviennent de `application_guarantees` et
 * `loan_applications` (Supabase). Aucune donnée fictive.
 */
import {
  BankDocument,
  LENDER,
  dateTime,
  documentReference,
  longDate,
  money,
  storeDocument,
} from "@/lib/pdf/doc-kit.server";
import { docLocale, docText } from "@/lib/pdf/doc-i18n.server";

export interface GuaranteeDocInput {
  /** Référence du dossier de crédit (loan_applications.reference). */
  reference: string;
  language: string;
  version: number;
  issuedAt?: string | null;
  /** Emprunteur */
  borrower: string;
  borrowerAddress: string;
  borrowerEmail: string;
  borrowerPhone?: string | null;
  borrowerCountry?: string | null;
  /** Garantie (application_guarantees) */
  kind: string;
  guarantorName?: string | null;
  amount: number;
  feeAmount: number;
  feeDescription?: string | null;
  currency: string;
  status: string;
  paymentStatus?: string | null;
  clientChoice?: string | null;
  scheduledPaymentDate?: string | null;
  paymentValidatedAt?: string | null;
  paymentInstructions?: string | null;
  /** Crédit garanti */
  loanAmount?: number | null;
  signature?: {
    name: string;
    signedAt: string;
    reference: string;
    provider: string;
    qualified: boolean;
    documentHash?: string | null;
  } | null;
}

export async function buildGuaranteePdf(
  input: GuaranteeDocInput,
): Promise<{ bytes: Uint8Array; hash: string; pages: number }> {
  const lang = docLocale(input.language);
  const t = (key: string) => docText(lang, `guarantee.${key}`);
  const c = (key: string) => docText(lang, `contract.${key}`);
  const p = (key: string) => docText(lang, `parties.${key}`);
  const label = (key: string) => docText(lang, `labels.${key}`);
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const cur = (input.currency || "EUR").toUpperCase();
  const amount = (value: number) => money(value, cur, lang);
  const orDash = (value: string | null | undefined) => (value && String(value).trim() ? String(value).trim() : t("notSpecified"));
  const docRef = documentReference("GAR", input.reference, input.version);

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

  doc.cover({
    subtitle: t("subtitle"),
    partiesTitle: t("partiesTitle"),
    notice: t("coverNotice"),
    highlight: { label: t("amountLabel"), value: amount(input.amount), note: t("amountNote") },
    blocks: [
      {
        label: p("lender"),
        lines: [LENDER.name, LENDER.legalForm, LENDER.address, LENDER.registry, `${p("email")} : ${LENDER.email}`],
      },
      {
        label: p("borrower"),
        lines: [
          orDash(input.borrower),
          orDash(input.borrowerAddress),
          `${p("email")} : ${orDash(input.borrowerEmail)}`,
          `${p("phone")} : ${orDash(input.borrowerPhone)}`,
        ],
      },
      {
        label: p("guarantor"),
        lines: [orDash(input.guarantorName)],
      },
    ],
  });

  doc.pageBreak();
  doc.sectionTitle(t("s1"));
  doc.article("Article 1", t("a1t"));
  doc.paragraph(t("a1b"));
  doc.keyValue(`${p("lender")} — ${p("legalIdentity")}`, `${LENDER.name} · ${LENDER.registry}`);
  doc.keyValue(`${p("lender")} — ${p("address")}`, LENDER.address);
  doc.keyValue(`${p("borrower")} — ${p("name")}`, orDash(input.borrower));
  doc.keyValue(`${p("borrower")} — ${p("address")}`, orDash(input.borrowerAddress));
  doc.keyValue(`${p("borrower")} — ${p("country")}`, orDash(input.borrowerCountry));
  doc.keyValue(p("guarantor"), orDash(input.guarantorName));
  doc.space(6);
  doc.article("Article 2", t("a2t"));
  doc.paragraph(t("a2b"));
  doc.article("Article 3", t("a3t"));
  doc.paragraph(t("a3b"));

  doc.sectionTitle(t("s2"));
  const rows: string[][] = [
    [t("rowKind"), orDash(input.kind)],
    [t("rowGuarantor"), orDash(input.guarantorName)],
    [t("rowAmount"), amount(input.amount)],
    [t("rowFee"), amount(input.feeAmount)],
    [t("rowCurrency"), cur],
  ];
  if (input.feeDescription) rows.push([t("rowDescription"), input.feeDescription]);
  rows.push([t("rowStatus"), orDash(input.status)]);
  rows.push([t("rowPaymentStatus"), orDash(input.paymentStatus)]);
  if (input.clientChoice) rows.push([t("rowClientChoice"), input.clientChoice]);
  if (input.scheduledPaymentDate) rows.push([t("rowScheduled"), longDate(input.scheduledPaymentDate, lang)]);
  if (input.paymentValidatedAt) rows.push([t("rowValidatedAt"), dateTime(input.paymentValidatedAt, lang)]);
  if (typeof input.loanAmount === "number" && input.loanAmount > 0) {
    rows.push([t("rowLoanAmount"), amount(input.loanAmount)]);
  }
  doc.table(
    [
      { header: t("colItem"), width: 62 },
      { header: t("colValue"), width: 38, align: "right" },
    ],
    rows,
    { highlightLast: true },
  );
  doc.article("Article 4", t("a4t"));
  doc.paragraph(t("a4b"));
  if (input.paymentInstructions) {
    doc.keyValue(t("rowInstructions"), input.paymentInstructions);
  }
  doc.callout(t("calloutTitle"), t("calloutBody"));

  doc.sectionTitle(t("s3"));
  doc.article("Article 5", t("a5t"));
  doc.paragraph(t("a5b"));
  doc.article("Article 6", t("a6t"));
  doc.paragraph(t("a6b"));
  doc.article("Article 7", t("a7t"));
  doc.paragraph(t("a7b"));

  doc.sectionTitle(t("s4"));
  doc.article("Article 8", t("a8t"));
  doc.paragraph(t("a8b"));
  doc.article("Article 9", t("a9t"));
  doc.paragraph(t("a9b"));

  doc.space(4);
  doc.paragraph(c("sigIntro"));
  doc.signatureBlocks({
    left: { title: c("sigLender"), name: LENDER.name, place: c("sigPlace"), mention: c("sigLenderMention") },
    right: {
      title: c("sigBorrower"),
      name: input.signature?.name || orDash(input.borrower),
      mention: input.signature ? c("sigBorrowerMention") : c("pendingMention"),
      signedLine: input.signature ? `${c("signedOn")} ${dateTime(input.signature.signedAt, lang)}` : undefined,
    },
  });
  if (input.signature) {
    doc.keyValue(c("signedBy"), input.signature.name);
    doc.keyValue(c("provider"), input.signature.provider);
    doc.keyValue(c("signatureRef"), input.signature.reference);
    doc.paragraph(input.signature.qualified ? c("qualifiedNotice") : c("advancedNotice"), {
      size: 8.2,
      italic: true,
      muted: true,
    });
  }

  const fpRows: Array<[string, string]> = [
    [c("fpVersion"), `${docRef} · ${label("version")} ${input.version}`],
    [c("fpGeneratedAt"), dateTime(issuedAt, lang)],
  ];
  if (input.signature?.documentHash) fpRows.push([c("fpDraftHash"), input.signature.documentHash]);
  doc.space(4);
  doc.fingerprint(c("fingerprintTitle"), fpRows, c("fpNote"));

  return doc.finish();
}

/** Dépose l'acte de garantie dans le bucket privé `contracts`. */
export async function storeGuaranteePdf(
  applicationId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  return storeDocument(applicationId, fileName, bytes);
}
