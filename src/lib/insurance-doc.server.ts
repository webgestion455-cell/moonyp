/**
 * Notice d'assurance emprunteur MOONYP — document contractuel séparé, multipage.
 *
 * Même fabrique documentaire que le contrat de prêt et l'acte de garantie.
 * Toutes les valeurs proviennent de `application_insurances` et
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
import { docEnum } from "@/lib/pdf/doc-enums.server";

export interface InsuranceDocInput {
  reference: string;
  language: string;
  version: number;
  issuedAt?: string | null;
  /** Assuré = emprunteur */
  borrower: string;
  borrowerAddress: string;
  borrowerEmail: string;
  borrowerPhone?: string | null;
  borrowerBirthDate?: string | null;
  borrowerCountry?: string | null;
  /** Assurance (application_insurances) */
  provider?: string | null;
  policyNumber?: string | null;
  coverage?: string | null;
  monthlyPremium: number;
  feeAmount?: number | null;
  currency: string;
  required: boolean;
  startsOn?: string | null;
  dueDate?: string | null;
  status: string;
  paymentStatus?: string | null;
  clientChoice?: string | null;
  scheduledPaymentDate?: string | null;
  /** Crédit couvert */
  months?: number | null;
  signature?: {
    name: string;
    signedAt: string;
    reference: string;
    provider: string;
    qualified: boolean;
    documentHash?: string | null;
  } | null;
}

export async function buildInsurancePdf(
  input: InsuranceDocInput,
): Promise<{ bytes: Uint8Array; hash: string; pages: number }> {
  const lang = docLocale(input.language);
  const t = (key: string) => docText(lang, `insurance.${key}`);
  const c = (key: string) => docText(lang, `contract.${key}`);
  const p = (key: string) => docText(lang, `parties.${key}`);
  const label = (key: string) => docText(lang, `labels.${key}`);
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const cur = (input.currency || "EUR").toUpperCase();
  const amount = (value: number) => money(value, cur, lang);
  const orDash = (value: string | null | undefined) =>
    value && String(value).trim() ? String(value).trim() : t("notSpecified");
  /** Valeur technique de la base traduite en libellé contractuel. */
  const enumOrDash = (group: Parameters<typeof docEnum>[1], value: string | null | undefined) =>
    docEnum(lang, group, value) ?? t("notSpecified");
  /**
   * Numéro de police : tant que l'assureur ne l'a pas attribué, la notice
   * imprime « En cours d'attribution » et jamais « Non précisé ».
   */
  const policyNumber =
    input.policyNumber && String(input.policyNumber).trim()
      ? String(input.policyNumber).trim()
      : docText(lang, "enums.common.pending_assignment");
  const docRef = documentReference("ASS", input.reference, input.version);

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
    highlight: {
      label: t("amountLabel"),
      value: amount(input.monthlyPremium),
      note: t("amountNote"),
    },
    blocks: [
      {
        label: p("insured"),
        lines: [
          orDash(input.borrower),
          input.borrowerBirthDate
            ? `${p("birthDate")} : ${longDate(input.borrowerBirthDate, lang)}`
            : `${p("birthDate")} : ${t("notSpecified")}`,
          orDash(input.borrowerAddress),
          `${p("email")} : ${orDash(input.borrowerEmail)}`,
          `${p("phone")} : ${orDash(input.borrowerPhone)}`,
        ],
      },
      {
        label: p("insurer"),
        lines: [orDash(input.provider), `${t("rowPolicy")} : ${policyNumber}`],
      },
      {
        label: p("beneficiary"),
        lines: [LENDER.name, LENDER.address, LENDER.registry],
      },
    ],
  });

  doc.pageBreak();
  const article = (number: number, title: string) =>
    doc.article(`${label("article")} ${number}`, title);
  doc.sectionTitle(t("s1"));
  article(1, t("a1t"));
  doc.paragraph(t("a1b"));
  doc.keyValue(`${p("insured")} — ${p("name")}`, orDash(input.borrower));
  doc.keyValue(`${p("insured")} — ${p("address")}`, orDash(input.borrowerAddress));
  doc.keyValue(`${p("insured")} — ${p("country")}`, orDash(input.borrowerCountry));
  doc.keyValue(`${p("insured")} — ${p("email")}`, orDash(input.borrowerEmail));
  doc.keyValue(p("insurer"), orDash(input.provider));
  doc.keyValue(p("beneficiary"), `${LENDER.name} · ${LENDER.registry}`);
  doc.space(6);
  article(2, t("a2t"));
  doc.paragraph(t("a2b"));

  doc.sectionTitle(t("s2"));
  article(3, t("a3t"));
  doc.paragraph(t("a3b"));
  article(4, t("a4t"));
  doc.paragraph(t("a4b"));

  const rows: string[][] = [
    [t("rowInsurer"), orDash(input.provider)],
    [t("rowPolicy"), policyNumber],
    [t("rowCoverage"), enumOrDash("insuranceCoverage", input.coverage)],
    [t("rowPremium"), amount(input.monthlyPremium)],
  ];
  if (typeof input.feeAmount === "number" && input.feeAmount > 0)
    rows.push([t("rowFee"), amount(input.feeAmount)]);
  rows.push([t("rowCurrency"), cur]);
  rows.push([t("rowRequired"), input.required ? t("yes") : t("no")]);
  if (input.startsOn) rows.push([t("rowStartsOn"), longDate(input.startsOn, lang)]);
  if (input.dueDate) rows.push([t("rowDueDate"), longDate(input.dueDate, lang)]);
  if (typeof input.months === "number" && input.months > 0) {
    rows.push([t("rowDuration"), `${input.months} ${t("rowMonths")}`]);
  }
  rows.push([t("rowStatus"), enumOrDash("status", input.status)]);
  if (input.paymentStatus)
    rows.push([t("rowPaymentStatus"), enumOrDash("paymentStatus", input.paymentStatus)]);
  if (input.clientChoice)
    rows.push([t("rowClientChoice"), enumOrDash("clientChoice", input.clientChoice)]);
  if (input.scheduledPaymentDate)
    rows.push([t("rowScheduled"), longDate(input.scheduledPaymentDate, lang)]);
  rows.push([t("rowBeneficiary"), LENDER.name]);

  doc.table(
    [
      { header: t("colItem"), width: 62 },
      { header: t("colValue"), width: 38, align: "right" },
    ],
    rows,
    { highlightLast: true },
  );
  doc.callout(t("calloutTitle"), t("calloutBody"));

  doc.sectionTitle(t("s3"));
  article(5, t("a5t"));
  doc.paragraph(t("a5b"));
  article(6, t("a6t"));
  doc.paragraph(t("a6b"));
  article(7, t("a7t"));
  doc.paragraph(t("a7b"));
  article(8, t("a8t"));
  doc.paragraph(t("a8b"));

  doc.sectionTitle(t("s4"));
  article(9, t("a9t"));
  doc.paragraph(t("a9b"));
  article(10, t("a10t"));
  doc.paragraph(t("a10b"));

  doc.space(4);
  doc.paragraph(c("sigIntro"));
  doc.signatureBlocks({
    left: {
      title: c("sigLender"),
      name: LENDER.name,
      place: c("sigPlace"),
      mention: c("sigLenderMention"),
    },
    right: {
      title: c("sigBorrower"),
      name: input.signature?.name || orDash(input.borrower),
      mention: input.signature ? c("sigBorrowerMention") : c("pendingMention"),
      signedLine: input.signature
        ? `${c("signedOn")} ${dateTime(input.signature.signedAt, lang)}`
        : undefined,
    },
  });
  if (input.signature) {
    doc.keyValue(c("signedBy"), input.signature.name);
    doc.keyValue(
      c("provider"),
      docEnum(lang, "signatureProvider", input.signature.provider) ?? input.signature.provider,
    );
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

/** Dépose la notice d'assurance dans le bucket privé `contracts`. */
export async function storeInsurancePdf(
  applicationId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  return storeDocument(applicationId, fileName, bytes);
}
