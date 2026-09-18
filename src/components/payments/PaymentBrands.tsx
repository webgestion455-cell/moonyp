/**
 * Marques de paiement — SVG vectoriels intégrés (aucune requête externe,
 * compatibles CSP stricte et thème sombre).
 */
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { title?: string };

const base = "h-6 w-auto shrink-0 rounded-[3px]";

export function VisaMark({ title = "Visa", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#1A1F71" />
      <path
        d="M19.6 21.4h-2.8l1.8-10.8h2.8l-1.8 10.8Zm10.2-10.5c-.6-.2-1.5-.5-2.6-.5-2.9 0-4.9 1.5-4.9 3.6 0 1.6 1.5 2.4 2.6 3 1.1.5 1.5.9 1.5 1.4 0 .8-1 1.1-1.9 1.1-1.2 0-1.9-.2-3-.6l-.4-.2-.4 2.5c.7.3 2 .6 3.4.6 3.1 0 5.1-1.5 5.1-3.7 0-1.2-.8-2.2-2.5-3-1-.5-1.7-.8-1.7-1.4 0-.5.6-1 1.8-1 1 0 1.7.2 2.3.4l.3.1.4-2.3Zm7.1-.3h-2.2c-.7 0-1.2.2-1.5.9l-4.2 9.9h3l.6-1.6h3.6l.3 1.6h2.6l-2.2-10.8Zm-3.5 7 1.1-3 .6 3h-1.7Zm-19.9-7-2.8 7.4-.3-1.5c-.5-1.8-2.2-3.7-4.1-4.7l2.6 9.6h3l4.5-10.8h-2.9Z"
        fill="#fff"
      />
      <path d="M8.9 10.6H4.3l-.1.3c3.6.9 6 3.1 7 5.7l-1-5c-.2-.7-.7-.9-1.3-1Z" fill="#F7B600" />
    </svg>
  );
}

export function MastercardMark({ title = "Mastercard", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#16202B" />
      <circle cx="19" cy="16" r="8.5" fill="#EB001B" />
      <circle cx="29" cy="16" r="8.5" fill="#F79E1B" />
      <path d="M24 9.6a8.5 8.5 0 0 0 0 12.8 8.5 8.5 0 0 0 0-12.8Z" fill="#FF5F00" />
    </svg>
  );
}

export function AmexMark({ title = "American Express", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#006FCF" />
      <path
        d="M7 13h4.6l.7 1.7.7-1.7H24v.8l.6-.8h4.3l.6.9.6-.9H41v6H30.6l-.8-1-.8 1H7l-.8-2H4.9L4 19H7l.6-1.5h2.2L10.4 19h4.7v-4.3L17 19h2l1.8-4.3V19h3v-6H7Zm2.1 2.9.7-1.7.7 1.7H9.1Zm16.6-1.9v4.1h1.9l1-1.2 1 1.2h2.2l-2.1-2 2.1-2.1h-2.1l-1 1.2-1-1.2h-2Zm7.5 0v4.1H38v-1h-2.9v-.6h2.8v-1h-2.8v-.6H38v-1h-4.8Z"
        fill="#fff"
      />
    </svg>
  );
}

export function CbMark({ title = "Carte Bancaire", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#0B4EA2" />
      <path
        d="M11 10h12.5c3.3 0 5.2 1.3 5.2 3.2 0 1.3-.9 2.3-2.4 2.6 1.8.3 2.9 1.4 2.9 2.9 0 2.1-2 3.3-5.5 3.3H11V10Zm3.4 2.4v2.3h8.4c1.3 0 2-.4 2-1.2s-.7-1.1-2-1.1h-8.4Zm0 4.6v2.6h9c1.4 0 2.2-.5 2.2-1.3 0-.9-.8-1.3-2.2-1.3h-9Z"
        fill="#fff"
      />
      <path d="M32 12.2h5.6v2.4H32v-2.4Zm0 5.2h5.6v2.4H32v-2.4Z" fill="#E4032E" />
    </svg>
  );
}

export function PaypalMark({ title = "PayPal", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#F3F6FB" />
      <path
        d="M15.6 8.5h7.1c3.6 0 5.7 1.9 5.2 5.2-.5 3.3-3 5.1-6.5 5.1h-2.3l-.7 4.7h-3.4l1.6-10.5h3.4c1.7 0 2.8-.6 3-1.9.2-1.2-.5-1.8-2.2-1.8h-4.4l.2-.8Z"
        fill="#003087"
      />
      <path
        d="M20.5 11.6h6.7c3.5 0 5.6 1.9 5.1 5.2-.5 3.3-3 5.2-6.5 5.2h-2.3l-.7 4.6h-3.4l1.1-15Z"
        fill="#009CDE"
        opacity=".85"
      />
      <path d="M34 11h1.9l-1.8 11.5h-1.9L34 11Z" fill="#003087" />
    </svg>
  );
}

export function SepaMark({ title = "SEPA", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#10298E" />
      <path d="M9 12.5h9.5v2.2H9v-2.2Zm0 4.4h9.5v2.2H9v-2.2Z" fill="#FFCC00" />
      <path
        d="M23.5 10.5c3.4 0 6.2 1.6 7.3 4.1h-3.1c-.8-1.1-2.3-1.8-4.2-1.8-2.9 0-5 1.6-5 3.7s2.1 3.7 5 3.7c1.9 0 3.4-.7 4.2-1.8h3.1c-1.1 2.5-3.9 4.1-7.3 4.1-4.6 0-8-2.7-8-6s3.4-6 8-6Z"
        fill="#fff"
      />
    </svg>
  );
}

export function CryptoMark({ title = "Crypto", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#111827" />
      <circle cx="24" cy="16" r="8" fill="#F7931A" />
      <path
        d="M27 14.6c.2-1.4-.9-2.1-2.3-2.6l.5-1.8-1.1-.3-.5 1.8-.9-.2.5-1.8-1.1-.3-.5 1.8-2.2-.6-.3 1.2s.8.2.8.2c.4.1.5.4.5.6l-1.3 5c-.1.2-.2.4-.6.3l-.8-.2-.6 1.3 2.1.5-.5 1.9 1.1.3.5-1.8.9.2-.5 1.8 1.1.3.5-1.9c1.9.4 3.3.2 3.9-1.5.5-1.4 0-2.2-1-2.7.8-.2 1.3-.7 1.4-1.8Zm-2.4 3.5c-.3 1.4-2.6.6-3.4.4l.6-2.4c.8.2 3.1.6 2.8 2Zm.3-3.6c-.3 1.3-2.2.6-2.9.4l.6-2.2c.7.2 2.6.5 2.3 1.8Z"
        fill="#fff"
      />
    </svg>
  );
}

export function BankMark({ title = "Virement", className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 48 32"
      role="img"
      aria-label={title}
      className={`${base} ${className ?? ""}`}
      {...rest}
    >
      <rect width="48" height="32" rx="4" fill="#0F3D2E" />
      <path d="M24 8 34 13v2H14v-2l10-5Z" fill="#fff" />
      <path
        d="M16 16h2.5v6H16v-6Zm6.8 0h2.5v6h-2.5v-6Zm6.7 0H32v6h-2.5v-6ZM13 23h22v2H13v-2Z"
        fill="#9FE8C8"
      />
    </svg>
  );
}

/** Bandeau de marques cohérent avec le type de moyen de paiement. */
export function MethodBrands({ kind, provider }: { kind: string; provider: string }) {
  if (provider === "paypal") return <PaypalMark />;
  if (kind === "card" || provider === "stripe") {
    return (
      <span className="flex items-center gap-1.5">
        <VisaMark />
        <MastercardMark />
        <AmexMark />
        <CbMark />
      </span>
    );
  }
  if (kind === "crypto") return <CryptoMark />;
  if (kind === "bank_transfer") {
    return (
      <span className="flex items-center gap-1.5">
        <BankMark />
        <SepaMark />
      </span>
    );
  }
  return <BankMark />;
}
