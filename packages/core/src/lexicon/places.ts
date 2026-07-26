/** US state and territory postal abbreviations, used to recognise `City, ST` locations. */
export const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
]);

/** Canadian province and territory abbreviations. */
export const CA_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/**
 * Country names mapped to ISO 3166-1 alpha-2, limited to the spellings that
 * actually appear on resumes (including common informal forms like "UK" and
 * "USA"). Keys are lower-cased.
 */
export const COUNTRIES: Record<string, string> = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  us: 'US',
  america: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  'u.k.': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'great britain': 'GB',
  canada: 'CA',
  australia: 'AU',
  'new zealand': 'NZ',
  ireland: 'IE',
  germany: 'DE',
  deutschland: 'DE',
  france: 'FR',
  spain: 'ES',
  italy: 'IT',
  portugal: 'PT',
  netherlands: 'NL',
  holland: 'NL',
  belgium: 'BE',
  switzerland: 'CH',
  austria: 'AT',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  iceland: 'IS',
  poland: 'PL',
  czechia: 'CZ',
  'czech republic': 'CZ',
  slovakia: 'SK',
  hungary: 'HU',
  romania: 'RO',
  bulgaria: 'BG',
  greece: 'GR',
  turkey: 'TR',
  ukraine: 'UA',
  russia: 'RU',
  india: 'IN',
  china: 'CN',
  japan: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  singapore: 'SG',
  malaysia: 'MY',
  indonesia: 'ID',
  thailand: 'TH',
  vietnam: 'VN',
  philippines: 'PH',
  'hong kong': 'HK',
  taiwan: 'TW',
  pakistan: 'PK',
  bangladesh: 'BD',
  'sri lanka': 'LK',
  israel: 'IL',
  'united arab emirates': 'AE',
  uae: 'AE',
  'saudi arabia': 'SA',
  qatar: 'QA',
  egypt: 'EG',
  nigeria: 'NG',
  kenya: 'KE',
  ghana: 'GH',
  'south africa': 'ZA',
  morocco: 'MA',
  brazil: 'BR',
  brasil: 'BR',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  peru: 'PE',
  mexico: 'MX',
  uruguay: 'UY',
};

/**
 * Words that mark a location line as a remote/distributed arrangement rather
 * than a city. Kept separate so callers can preserve the nuance.
 */
export const REMOTE_MARKERS = new Set(['remote', 'distributed', 'anywhere', 'work from home', 'wfh', 'hybrid']);

export function lookupCountry(name: string): string | undefined {
  return COUNTRIES[name.trim().toLowerCase().replace(/\.$/, '')];
}

export function isRegionCode(token: string): boolean {
  const upper = token.trim().toUpperCase();
  return US_STATES.has(upper) || CA_PROVINCES.has(upper);
}
