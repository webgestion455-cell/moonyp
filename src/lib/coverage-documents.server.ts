/**
 * Génération et archivage des actes de garantie et notices d'assurance.
 * Ce module réutilise le moteur PDF, le bucket privé et la preuve de signature
 * du contrat du même dossier. Il n'introduit aucun circuit documentaire séparé.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildGuaranteePdf, storeGuaranteePdf } from "@/lib/guarantee-doc.server";
import { buildInsurancePdf, storeInsurancePdf } from "@/lib/insurance-doc.server";

type DocumentKind = "guarantee" | "insurance";
type ArtifactFields = {
  document_version?: number | null;
  document_hash?: string | null;
};

function fullName(row: Record<string, unknown>): string {
  return [row.first_name, row.last_name].filter(Boolean).join(" ");
}

function address(row: Record<string, unknown>): string {
  return [row.address, row.postal_code, row.city, row.country].filter(Boolean).join(", ");
}

async function signatureForApplication(applicationId: string) {
  const { data } = await supabaseAdmin
    .from("contract_signature_requests")
    .select("provider_reference, provider, qualified, signer_name, completed_at")
    .eq("application_id", applicationId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.completed_at || !data.signer_name) return null;
  return {
    name: data.signer_name,
    signedAt: data.completed_at,
    reference: data.provider_reference ?? "",
    provider: data.provider,
    qualified: Boolean(data.qualified),
  };
}

export async function generateGuaranteeDocument(guaranteeId: string, final = false) {
  const { data: guarantee } = await supabaseAdmin.from("application_guarantees").select("*").eq("id", guaranteeId).maybeSingle();
  if (!guarantee) throw new Error("guarantee_not_found");
  const { data: app } = await supabaseAdmin.from("loan_applications").select("*").eq("id", guarantee.application_id).maybeSingle();
  if (!app) throw new Error("application_not_found");

  const signature = final ? await signatureForApplication(guarantee.application_id) : null;
  const artifact = guarantee as typeof guarantee & ArtifactFields;
  const version = Number(artifact.document_version ?? 1);
  const issuedAt = new Date().toISOString();
  const { bytes, hash, pages } = await buildGuaranteePdf({
    reference: app.reference, language: app.language ?? "en", version, issuedAt,
    borrower: fullName(app), borrowerAddress: address(app), borrowerEmail: app.email ?? "",
    borrowerPhone: app.phone, borrowerCountry: app.country, kind: guarantee.kind,
    guarantorName: guarantee.guarantor_name, amount: Number(guarantee.amount ?? guarantee.fee_amount ?? 0),
    feeAmount: Number(guarantee.fee_amount ?? 0), feeDescription: guarantee.fee_description,
    currency: guarantee.currency ?? "EUR", status: guarantee.status, paymentStatus: guarantee.payment_status,
    clientChoice: guarantee.client_choice, scheduledPaymentDate: guarantee.scheduled_payment_date,
    paymentValidatedAt: guarantee.payment_validated_at, paymentInstructions: guarantee.payment_instructions,
    loanAmount: Number(app.amount ?? 0),
    signature: signature ? { ...signature, documentHash: artifact.document_hash ?? null } : null,
  });
  const path = await storeGuaranteePdf(guarantee.application_id, `guarantee-v${version}${final ? "-signed" : ""}.pdf`, bytes);
  const patch = final
    ? { signed_storage_path: path, signed_document_hash: hash, signed_at: signature?.signedAt ?? guarantee.payment_validated_at ?? issuedAt, signature_name: signature?.name ?? null, signature_method: signature?.provider ?? "administrative_validation", signature_reference: signature?.reference ?? null }
    : { storage_path: path, document_hash: hash, document_issued_at: issuedAt };
  const { error } = await supabaseAdmin.from("application_guarantees").update(patch as never).eq("id", guaranteeId);
  if (error) throw new Error(error.message);
  return { path, hash, pages, version };
}

export async function generateInsuranceDocument(insuranceId: string, final = false) {
  const { data: insurance } = await supabaseAdmin.from("application_insurances").select("*").eq("id", insuranceId).maybeSingle();
  if (!insurance) throw new Error("insurance_not_found");
  const { data: app } = await supabaseAdmin.from("loan_applications").select("*").eq("id", insurance.application_id).maybeSingle();
  if (!app) throw new Error("application_not_found");

  const signature = final ? await signatureForApplication(insurance.application_id) : null;
  const artifact = insurance as typeof insurance & ArtifactFields;
  const version = Number(artifact.document_version ?? 1);
  const issuedAt = new Date().toISOString();
  const { bytes, hash, pages } = await buildInsurancePdf({
    reference: app.reference, language: app.language ?? "en", version, issuedAt,
    borrower: fullName(app), borrowerAddress: address(app), borrowerEmail: app.email ?? "",
    borrowerPhone: app.phone, borrowerBirthDate: app.birth_date, borrowerCountry: app.country,
    provider: insurance.provider, policyNumber: insurance.policy_number, coverage: insurance.coverage,
    monthlyPremium: Number(insurance.monthly_premium ?? 0), feeAmount: Number(insurance.fee_amount ?? 0),
    currency: insurance.currency ?? "EUR", required: Boolean(insurance.required), startsOn: insurance.starts_on,
    dueDate: insurance.due_date, status: insurance.status, paymentStatus: insurance.payment_status,
    clientChoice: insurance.client_choice, scheduledPaymentDate: insurance.scheduled_payment_date,
    months: Number(app.duration_months ?? 0),
    signature: signature ? { ...signature, documentHash: artifact.document_hash ?? null } : null,
  });
  const path = await storeInsurancePdf(insurance.application_id, `insurance-v${version}${final ? "-signed" : ""}.pdf`, bytes);
  const patch = final
    ? { signed_storage_path: path, signed_document_hash: hash, signed_at: signature?.signedAt ?? insurance.validated_at ?? issuedAt, signature_name: signature?.name ?? null, signature_method: signature?.provider ?? "administrative_validation", signature_reference: signature?.reference ?? null }
    : { storage_path: path, document_hash: hash, document_issued_at: issuedAt };
  const { error } = await supabaseAdmin.from("application_insurances").update(patch as never).eq("id", insuranceId);
  if (error) throw new Error(error.message);
  return { path, hash, pages, version };
}

export async function signedCoverageUrl(_kind: DocumentKind, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from("contracts").createSignedUrl(path, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}