// Password helpers — shared rules across signup, password change, password reset.
export const PASSWORD_RULES = {
  minLength: 10,
  upper: /[A-Z]/,
  lower: /[a-z]/,
  digit: /[0-9]/,
  special: /[^A-Za-z0-9]/,
} as const;

export type PasswordCheck = {
  length: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
};

export function checkPassword(pw: string): PasswordCheck {
  return {
    length: pw.length >= PASSWORD_RULES.minLength,
    upper: PASSWORD_RULES.upper.test(pw),
    lower: PASSWORD_RULES.lower.test(pw),
    digit: PASSWORD_RULES.digit.test(pw),
    special: PASSWORD_RULES.special.test(pw),
  };
}

export function passwordScore(pw: string): number {
  const c = checkPassword(pw);
  let s = 0;
  if (c.length) s++;
  if (c.upper) s++;
  if (c.lower) s++;
  if (c.digit) s++;
  if (c.special) s++;
  if (pw.length >= 14) s++;
  return Math.min(s, 5);
}

export function isPasswordStrong(pw: string): boolean {
  const c = checkPassword(pw);
  return c.length && c.upper && c.lower && c.digit && c.special;
}
