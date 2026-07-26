/**
 * Signals for telling an employer apart from a job title when a resume packs
 * both onto one line.
 *
 * The company vocabulary is split by strength deliberately. Industry nouns like
 * "Software" or "Systems" appear in company names *and* in job titles
 * ("Software Engineer", "Systems Analyst"), so treating them as strong company
 * evidence cancels out the role signal and leaves the line unclassified. Only
 * legal-entity suffixes and institution nouns — which essentially never appear
 * in a job title — get full weight.
 */

/** Nouns and modifiers that mark a fragment as a job title. */
const ROLE_WORDS = [
  'engineer', 'engineering', 'developer', 'programmer', 'architect', 'scientist',
  'analyst', 'designer', 'researcher', 'administrator', 'technician', 'consultant',
  'specialist', 'manager', 'director', 'supervisor', 'coordinator', 'lead',
  'head', 'chief', 'officer', 'president', 'vice president', 'vp', 'partner',
  'associate', 'assistant', 'intern', 'trainee', 'apprentice', 'fellow',
  'principal', 'staff', 'senior', 'junior', 'founder', 'cofounder', 'owner',
  'strategist', 'planner', 'producer', 'editor', 'writer', 'author', 'copywriter',
  'marketer', 'recruiter', 'accountant', 'auditor', 'controller', 'treasurer',
  'attorney', 'lawyer', 'counsel', 'paralegal', 'nurse', 'physician', 'doctor',
  'therapist', 'pharmacist', 'teacher', 'instructor', 'professor', 'lecturer',
  'tutor', 'trainer', 'coach', 'advisor', 'adviser', 'representative', 'agent',
  'clerk', 'cashier', 'chef', 'cook', 'driver', 'operator', 'mechanic',
  'electrician', 'plumber', 'carpenter', 'welder', 'machinist', 'foreman',
  'salesperson', 'buyer', 'merchandiser', 'actuary',
  'statistician', 'economist', 'psychologist', 'sociologist', 'librarian',
  'curator', 'archivist', 'translator', 'interpreter', 'photographer',
  'videographer', 'animator', 'illustrator', 'artist', 'musician',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'ciso', 'cio', 'cpo', 'evp', 'svp',
  'scrum master', 'product owner', 'sre', 'devops',
];

/**
 * Legal-entity suffixes and institution nouns. A fragment containing one of
 * these is an organisation, not a job title.
 */
const STRONG_COMPANY_WORDS = [
  'inc', 'inc.', 'llc', 'l.l.c.', 'ltd', 'ltd.', 'limited', 'corp', 'corp.',
  'corporation', 'plc', 'gmbh', 'ag', 'nv', 'n.v.', 'bv', 'b.v.', 'oy', 'aps',
  'pty', 'pte', 'srl', 's.r.l.', 'spa', 'llp', 'holdings', 'ventures',
  'university', 'college', 'institute', 'academy', 'hospital', 'clinic',
  'foundation', 'bank', 'ministry', 'bureau', 'authority', 'commission',
  'incorporated', 'company', 'co.',
];

/**
 * Industry nouns that lean towards a company name but also turn up inside job
 * titles. Weighted lightly so they break ties without overriding a role match.
 */
const WEAK_COMPANY_WORDS = [
  'group', 'partners', 'associates', 'consulting', 'consultancy', 'solutions',
  'technologies', 'labs', 'laboratories', 'studio', 'studios', 'agency',
  'industries', 'enterprises', 'capital', 'society', 'association', 'council',
];

const ROLE_PATTERN = buildPattern(ROLE_WORDS);
const STRONG_COMPANY_PATTERN = buildPattern(STRONG_COMPANY_WORDS);
const WEAK_COMPANY_PATTERN = buildPattern(WEAK_COMPANY_WORDS);

function buildPattern(words: string[]): RegExp {
  // Words ending in punctuation ("inc.") cannot rely on a trailing \b, so the
  // boundary is expressed as "start, whitespace or comma" on each side.
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[\\s,(])(?:${escaped.join('|')})(?:[\\s,).]|$)`, 'i');
}

/** True when the fragment reads like a job title. */
export function looksLikeRole(fragment: string): boolean {
  return ROLE_PATTERN.test(fragment);
}

/** True when the fragment reads like an employer name. */
export function looksLikeCompany(fragment: string): boolean {
  return STRONG_COMPANY_PATTERN.test(fragment) || WEAK_COMPANY_PATTERN.test(fragment);
}

/**
 * Score a fragment on the role-versus-company axis.
 * Positive means "more likely a role", negative means "more likely a company",
 * zero means "no evidence either way".
 */
export function roleAffinity(fragment: string): number {
  let score = 0;
  if (ROLE_PATTERN.test(fragment)) score += 3;
  if (STRONG_COMPANY_PATTERN.test(fragment)) score -= 4;
  else if (WEAK_COMPANY_PATTERN.test(fragment)) score -= 1;
  // Resume styling tends to set company names in full caps.
  const letters = fragment.replace(/[^A-Za-z]/g, '');
  if (letters.length > 2 && fragment === fragment.toUpperCase()) score -= 1;
  return score;
}
