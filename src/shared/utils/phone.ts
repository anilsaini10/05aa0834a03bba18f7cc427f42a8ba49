// ── Phone number normalization ────────────────────────────────
// Users are stored with the national number only (e.g. "9876543210"),
// so every format a user may type — "+91 98765 43210", "919876543210",
// "09876543210", "98765-43210" — is reduced to that before lookup.
//
// Only India is supported today. To support another country, add its
// entry to COUNTRIES and pass its code (e.g. from the request or the
// school's country) instead of relying on DEFAULT_COUNTRY.

interface CountryPhoneRule {
  dialCode:       string;   // without "+"
  trunkPrefix:    string;   // leading digit dialled domestically, e.g. "0"
  nationalNumber: RegExp;   // valid national (subscriber) number
}

export const COUNTRIES = {
  IN: { dialCode: '91', trunkPrefix: '0', nationalNumber: /^[6-9]\d{9}$/ },
} satisfies Record<string, CountryPhoneRule>;

export type CountryCode = keyof typeof COUNTRIES;

export const DEFAULT_COUNTRY: CountryCode = 'IN';

// Returns the national number, or null if `raw` isn't a valid mobile
// number for `country`.
export const normalizePhone = (
  raw: string,
  country: CountryCode = DEFAULT_COUNTRY,
): string | null => {
  const rule: CountryPhoneRule = COUNTRIES[country];

  const hasPlus = raw.trim().startsWith('+');
  let digits    = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;

  if (hasPlus) {
    // International format must carry this country's dial code.
    if (!digits.startsWith(rule.dialCode)) return null;
    digits = digits.slice(rule.dialCode.length);
  } else if (!rule.nationalNumber.test(digits)) {
    // No "+": accept "<dialCode><number>" or "<trunkPrefix><number>".
    if (digits.startsWith(rule.dialCode) && rule.nationalNumber.test(digits.slice(rule.dialCode.length))) {
      digits = digits.slice(rule.dialCode.length);
    } else if (digits.startsWith(rule.trunkPrefix)) {
      digits = digits.slice(rule.trunkPrefix.length);
    }
  }

  return rule.nationalNumber.test(digits) ? digits : null;
};

// National number → E.164 ("+919876543210"), the format SMS gateways expect.
export const toE164 = (
  nationalNumber: string,
  country: CountryCode = DEFAULT_COUNTRY,
): string => `+${COUNTRIES[country].dialCode}${nationalNumber}`;
