/**
 * PaymentService — abstraction unique pour tous les encaissements Moonyp.
 *
 * Règles :
 *  - aucune fausse intégration : un provider dont les clés ne sont pas
 *    configurées est déclaré `configured: false` et refuse toute opération ;
 *  - les secrets ne sortent jamais du serveur (lecture dans le handler) ;
 *  - un paiement n'est JAMAIS considéré comme reçu sans confirmation
 *    (validation administrateur pour le virement, capture PSP sinon).
 */

export type PaymentProviderId = "bank_transfer" | "stripe" | "paypal";

export const PAYMENT_PROVIDERS: PaymentProviderId[] = ["bank_transfer", "stripe", "paypal"];

export const PAYMENT_PURPOSES = [
  "guarantee_fee",
  "insurance_fee",
  "application_fee",
  "installment",
  "other",
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "processing",
  "received",
  "failed",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface ProviderStatus {
  id: PaymentProviderId;
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  /** Le virement est disponible dès qu'un compte est configuré côté admin. */
  requiresMethod: boolean;
}

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  reference: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
}

export type CreatePaymentResult =
  | { mode: "instructions"; providerReference: null; status: PaymentStatus }
  | { mode: "redirect"; url: string; providerReference: string | null; status: PaymentStatus };

export interface PaymentProvider {
  id: PaymentProviderId;
  requiredEnv: string[];
  requiresMethod: boolean;
  status(): ProviderStatus;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function buildStatus(id: PaymentProviderId, requiredEnv: string[], requiresMethod: boolean): ProviderStatus {
  const missingEnv = requiredEnv.filter((key) => !env(key));
  return { id, requiredEnv, missingEnv, configured: missingEnv.length === 0, requiresMethod };
}

/** Virement : pas de PSP, l'argent arrive sur le compte configuré par l'admin. */
const bankTransfer: PaymentProvider = {
  id: "bank_transfer",
  requiredEnv: [],
  requiresMethod: true,
  status: () => buildStatus("bank_transfer", [], true),
  createPayment: async () => ({ mode: "instructions", providerReference: null, status: "pending" }),
};

const stripe: PaymentProvider = {
  id: "stripe",
  requiredEnv: ["STRIPE_SECRET_KEY"],
  requiresMethod: false,
  status: () => buildStatus("stripe", ["STRIPE_SECRET_KEY"], false),
  async createPayment(input) {
    const key = env("STRIPE_SECRET_KEY");
    if (!key) throw new Error("provider_not_configured");

    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", input.returnUrl);
    body.set("cancel_url", input.cancelUrl);
    body.set("client_reference_id", input.reference);
    if (input.customerEmail) body.set("customer_email", input.customerEmail);
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
    body.set("line_items[0][price_data][unit_amount]", String(Math.round(input.amount * 100)));
    body.set("line_items[0][price_data][product_data][name]", input.description.slice(0, 120));

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) throw new Error(json.error?.message ?? "stripe_error");
    return { mode: "redirect", url: json.url, providerReference: json.id ?? null, status: "processing" };
  },
};

const paypal: PaymentProvider = {
  id: "paypal",
  requiredEnv: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  requiresMethod: false,
  status: () => buildStatus("paypal", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], false),
  async createPayment(input) {
    const clientId = env("PAYPAL_CLIENT_ID");
    const secret = env("PAYPAL_CLIENT_SECRET");
    if (!clientId || !secret) throw new Error("provider_not_configured");
    const base =
      env("PAYPAL_ENVIRONMENT") === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenRes.ok || !tokenJson.access_token) throw new Error("paypal_auth_error");

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.reference,
            description: input.description.slice(0, 120),
            amount: { currency_code: input.currency.toUpperCase(), value: input.amount.toFixed(2) },
          },
        ],
        application_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl },
      }),
    });
    const orderJson = (await orderRes.json()) as {
      id?: string;
      links?: Array<{ rel: string; href: string }>;
    };
    const approve = orderJson.links?.find((l) => l.rel === "approve")?.href;
    if (!orderRes.ok || !approve) throw new Error("paypal_order_error");
    return { mode: "redirect", url: approve, providerReference: orderJson.id ?? null, status: "processing" };
  },
};

const REGISTRY: Record<PaymentProviderId, PaymentProvider> = {
  bank_transfer: bankTransfer,
  stripe,
  paypal,
};

export function getProvider(id: string): PaymentProvider {
  const provider = REGISTRY[id as PaymentProviderId];
  if (!provider) throw new Error("unknown_provider");
  return provider;
}

export function providerStatuses(): ProviderStatus[] {
  return PAYMENT_PROVIDERS.map((id) => REGISTRY[id].status());
}

/** Référence lisible et unique : MP-2026-AB12CD34. */
export function buildPaymentReference(prefix = "MP"): string {
  const year = new Date().getUTCFullYear();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${prefix}-${year}-${suffix}`;
}
