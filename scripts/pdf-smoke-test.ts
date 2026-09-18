import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildContractPdf } from "../src/lib/contract-doc.server";
import { buildGuaranteePdf } from "../src/lib/guarantee-doc.server";
import { buildInsurancePdf } from "../src/lib/insurance-doc.server";

type PdfArtifact = {
  bytes: Uint8Array;
  hash: string;
  pages: number;
};

type PdfBuilderResult = string | PdfArtifact;

function assertPdfArtifact(
  artifact: PdfBuilderResult,
  filename: string,
): asserts artifact is PdfArtifact {
  if (typeof artifact === "string") {
    throw new Error(
      `${filename}: le générateur PDF a retourné une chaîne au lieu d'un artefact PDF.`,
    );
  }

  if (!(artifact.bytes instanceof Uint8Array)) {
    throw new Error(`${filename}: bytes PDF invalide.`);
  }

  if (!artifact.hash) {
    throw new Error(`${filename}: hash SHA-256 manquant.`);
  }

  if (!Number.isInteger(artifact.pages) || artifact.pages < 1) {
    throw new Error(`${filename}: nombre de pages invalide.`);
  }
}

const output = process.argv[2] ?? "/tmp/moonyp-pdf-smoke";

mkdirSync(output, { recursive: true });

const artifacts: Array<[string, PdfBuilderResult]> = [
  [
    "contract-audit.pdf",
    await buildContractPdf({
      reference: "AUDIT-UTF8",
      language: "el",
      version: 1,
      borrower: "Δοκιμή Κυριλλικό Тест",
      address: "Οδός Ευρώ 5, Αθήνα",
      email: "audit@example.invalid",
      amount: 5000,
      months: 36,
      rate: 4.2,
      apr: 4.35,
      monthly: 175.19,
      totalCost: 1306.84,
      insuranceMonthly: 12.5,
      fees: 0,
      currency: "EUR",
      purpose: null,
      issuedAt: "2025-01-15T10:30:00Z",
    }),
  ],
  [
    "guarantee-audit.pdf",
    await buildGuaranteePdf({
      reference: "AUDIT-UTF8",
      language: "bg",
      version: 1,
      issuedAt: "2025-01-15T10:30:00Z",
      borrower: "Кредитополучател Тест",
      borrowerAddress: "Улица Евро 5, София",
      borrowerEmail: "audit@example.invalid",
      kind: "Лична гаранция",
      guarantorName: "Гарант Тест",
      amount: 5000,
      feeAmount: 0,
      currency: "EUR",
      status: "active",
      loanAmount: 5000,
    }),
  ],
  [
    "insurance-audit.pdf",
    await buildInsurancePdf({
      reference: "AUDIT-UTF8",
      language: "el",
      version: 1,
      issuedAt: "2025-01-15T10:30:00Z",
      borrower: "Δοκιμή Κυριλλικό Тест",
      borrowerAddress: "Οδός Ευρώ 5, Αθήνα",
      borrowerEmail: "audit@example.invalid",
      provider: "Ασφαλιστής",
      coverage: "Κάλυψη δανείου",
      monthlyPremium: 12.5,
      feeAmount: 0,
      currency: "EUR",
      required: true,
      status: "active",
      months: 36,
    }),
  ],
  [
    // Contrôle des libellés d'énumération : aucune valeur technique de la base
    // (credit_risk_cover, awaiting_payment, pay_now) ne doit s'imprimer.
    "guarantee-enums-fr.pdf",
    await buildGuaranteePdf({
      reference: "AUDIT-ENUMS",
      language: "fr",
      version: 2,
      issuedAt: "2025-01-15T10:30:00Z",
      borrower: "Camille Durand",
      borrowerAddress: "12 rue de la Paix, 75002 Paris",
      borrowerEmail: "camille.durand@example.invalid",
      borrowerPhone: "+33 6 12 34 56 78",
      borrowerCountry: "France",
      kind: "credit_risk_cover",
      guarantorName: "Jean Durand",
      amount: 1250,
      feeAmount: 1250,
      currency: "EUR",
      status: "sent",
      paymentStatus: "awaiting_payment",
      clientChoice: "pay_now",
      scheduledPaymentDate: "2025-02-01",
      loanAmount: 25000,
      signature: {
        name: "Camille Durand",
        signedAt: "2025-01-20T09:12:00Z",
        reference: "SIG-2025-000123",
        provider: "internal_aes",
        qualified: false,
        documentHash: "a1b2c3d4e5f6",
      },
    }),
  ],
  [
    // Numéro de police absent : la notice doit afficher « En cours
    // d'attribution » et jamais « Non précisé ».
    "insurance-enums-de.pdf",
    await buildInsurancePdf({
      reference: "AUDIT-ENUMS",
      language: "de",
      version: 2,
      issuedAt: "2025-01-15T10:30:00Z",
      borrower: "Anna Schmidt",
      borrowerAddress: "Hauptstraße 8, 10115 Berlin",
      borrowerEmail: "anna.schmidt@example.invalid",
      borrowerPhone: "+49 30 123456",
      borrowerBirthDate: "1985-04-17",
      borrowerCountry: "Deutschland",
      provider: "Allianz",
      policyNumber: null,
      coverage: "death_disability_job_loss",
      monthlyPremium: 42.9,
      feeAmount: 180,
      currency: "EUR",
      required: true,
      startsOn: "2025-02-01",
      dueDate: "2025-01-31",
      status: "pending",
      paymentStatus: "awaiting_payment",
      clientChoice: "pay_later",
      scheduledPaymentDate: "2025-02-10",
      months: 60,
    }),
  ],
];

for (const [filename, artifact] of artifacts) {
  assertPdfArtifact(artifact, filename);

  const path = `${output}/${filename}`;

  writeFileSync(path, artifact.bytes);

  const pdf = await PDFDocument.load(artifact.bytes);

  if (pdf.getPageCount() < 2) {
    throw new Error(`${filename} n'est pas multipage`);
  }

  console.log(
    `${path}: ${pdf.getPageCount()} pages, ${artifact.bytes.length} octets, SHA-256 ${artifact.hash}`,
  );
}
