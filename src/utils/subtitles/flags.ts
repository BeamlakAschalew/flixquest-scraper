/**
 * Flag icon service used by the Wyzie API, reused here so entries from every
 * provider render identically in a client-side picker.
 */
const FLAG_BASE_URL = 'https://flagsapi.com'
const FLAG_STYLE = 'flat'
const FLAG_SIZE = 24

/**
 * Country whose flag stands in for a subtitle language.
 *
 * Keys are the language codes subtitle aggregators actually emit, which mix
 * ISO 639-1, ISO 639-2 and a few of their own conventions (`pb` for Brazilian
 * Portuguese, `ze` for bilingual Chinese/English).
 */
const LANGUAGE_FLAG_COUNTRY: Record<string, string> = {
  ar: 'SA',
  bg: 'BG',
  bn: 'BD',
  bs: 'BA',
  ca: 'ES',
  cs: 'CZ',
  cy: 'GB',
  da: 'DK',
  de: 'DE',
  el: 'GR',
  en: 'US',
  eo: 'EU',
  es: 'ES',
  et: 'EE',
  eu: 'ES',
  fa: 'IR',
  fi: 'FI',
  fr: 'FR',
  gl: 'ES',
  he: 'IL',
  hi: 'IN',
  hr: 'HR',
  hu: 'HU',
  hy: 'AM',
  id: 'ID',
  is: 'IS',
  it: 'IT',
  iw: 'IL',
  ja: 'JP',
  ka: 'GE',
  kk: 'KZ',
  km: 'KH',
  kn: 'IN',
  ko: 'KR',
  ku: 'IQ',
  ckb: 'IQ',
  lt: 'LT',
  lv: 'LV',
  mk: 'MK',
  ml: 'IN',
  mn: 'MN',
  mr: 'IN',
  ms: 'MY',
  my: 'MM',
  nb: 'NO',
  ne: 'NP',
  nl: 'NL',
  no: 'NO',
  pb: 'BR',
  pl: 'PL',
  pt: 'PT',
  'pt-br': 'BR',
  'pt-pt': 'PT',
  ro: 'RO',
  ru: 'RU',
  si: 'LK',
  sk: 'SK',
  sl: 'SI',
  sq: 'AL',
  sr: 'RS',
  sv: 'SE',
  sw: 'KE',
  ta: 'IN',
  te: 'IN',
  th: 'TH',
  tl: 'PH',
  tr: 'TR',
  uk: 'UA',
  ur: 'PK',
  vi: 'VN',
  zh: 'CN',
  'zh-cn': 'CN',
  'zh-tw': 'TW',
  ze: 'CN',
}

/**
 * Flag image URL for a subtitle language.
 *
 * @param language ISO 639 code as reported by the provider
 * @returns Flag URL, or an empty string for unmapped languages so clients can
 *          fall back to their own placeholder
 */
export function languageFlagUrl(language: string | undefined): string {
  const code = (language || '').trim().toLowerCase()
  if (!code) return ''

  const country =
    LANGUAGE_FLAG_COUNTRY[code] || LANGUAGE_FLAG_COUNTRY[code.split('-')[0]]

  return country
    ? `${FLAG_BASE_URL}/${country}/${FLAG_STYLE}/${FLAG_SIZE}.png`
    : ''
}
