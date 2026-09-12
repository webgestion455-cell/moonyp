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