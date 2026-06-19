// ══════════════════════════════════════════════════════════════
// Section Type Detection & Dimension Normalization
// Maps Thiết kế profile codes (PL/C/H/L/CHS/RB/SHS/RHS)
// to inventory naming (Thép tấm/U/H/ống/tròn/hộp)
// ══════════════════════════════════════════════════════════════

export type SectionType = 'PLATE' | 'CHANNEL' | 'HBEAM' | 'ANGLE' | 'PIPE' | 'ROUND' | 'BOX'

// Priority-ordered detection rules.
// Vietnamese phrases and specific abbreviations first → single-letter+digit → single keywords.
// NOTE: \b is unreliable with Vietnamese diacritics (ố, ộ, ấ are \W in JS), so Vietnamese
// single-word patterns use (?:^|\s)…(?:\s|$) instead.
const SECTION_RULES: [RegExp, SectionType][] = [
  // ── Vietnamese multi-word (most specific) ──
  [/thép\s*(?:hình\s*)?hộp/i, 'BOX'],
  [/thép\s*(?:hình\s*)?ống/i, 'PIPE'],
  [/thép\s*(?:hình\s*)?tròn/i, 'ROUND'],
  [/thép\s*(?:cây|câ)(?=[\s\d]|$)/i, 'ROUND'],
  [/tôn\s*tấm/i, 'PLATE'],
  [/thép\s*tấm/i, 'PLATE'],
  [/thép\s*(?:hình\s*)?góc/i, 'ANGLE'],
  // Vietnamese + section letter (followed by whitespace/digit/end to avoid partial match on ộ/ắ etc.)
  [/thép\s*(?:hình\s*)?h(?=[\s\d]|$)/i, 'HBEAM'],
  [/thép\s*(?:hình\s*)?i(?=[\s\d]|$)/i, 'HBEAM'],
  [/thép\s*(?:hình\s*)?u(?=[\s\d]|$)/i, 'CHANNEL'],
  [/thép\s*(?:hình\s*)?c(?=[\s\d]|$)/i, 'CHANNEL'],
  [/thép\s*(?:hình\s*)?l(?=[\s\d]|$)/i, 'ANGLE'],
  [/thép\s*(?:hình\s*)?v(?=[\s\d]|$)/i, 'ANGLE'],

  // ── Multi-letter abbreviations (no trailing \b — often glued to digits like SHS100) ──
  [/\bSHS(?=[\d\s]|$)/i, 'BOX'],
  [/\bRHS(?=[\d\s]|$)/i, 'BOX'],
  [/\bCHS(?=[\d\s]|$)/i, 'PIPE'],
  [/\bPIPE(?=[\d\s]|$)/i, 'PIPE'],
  [/\bHE[ABM](?=[\d\s]|$)/i, 'HBEAM'],
  [/\bIPE(?=[\d\s]|$)/i, 'HBEAM'],
  [/\bUP[NE](?=[\d\s]|$)/i, 'CHANNEL'],
  [/\bUNC(?=[\d\s]|$)/i, 'CHANNEL'],
  [/\bCHANNEL(?=[\d\s]|$)/i, 'CHANNEL'],
  [/\bEA(?=[\d\s]|$)/i, 'ANGLE'],
  [/\bUA(?=[\d\s]|$)/i, 'ANGLE'],
  [/\bPLATE(?=[\d\s]|$)/i, 'PLATE'],
  [/\bRB(?=[\d\s]|$)/i, 'ROUND'],

  // ── Single/double letter + digit (profile codes: PL10, H300, C100, …) ──
  [/\bPL\d/i, 'PLATE'],
  [/\bH\d/i, 'HBEAM'],
  [/\bI\d/i, 'HBEAM'],
  [/\bU\d/i, 'CHANNEL'],
  [/\bC\d/i, 'CHANNEL'],
  [/\bL\d/i, 'ANGLE'],
  [/\bV\d/i, 'ANGLE'],
  [/\bD\d/i, 'ROUND'],

  // ── Ø symbol ──
  [/Ø/, 'PIPE'],

  // ── Vietnamese single keywords (use (?:^|\s) instead of \b to avoid matching inside
  //    compound Vietnamese words like "chống" containing "ống") ──
  [/(?:^|\s)tôn(?:\s|$)/i, 'PLATE'],
  [/(?:^|\s)tấm(?:\s|$)/i, 'PLATE'],
  [/(?:^|\s)ống(?:\s|$)/i, 'PIPE'],
  [/(?:^|\s)hộp(?:\s|$)/i, 'BOX'],
  [/(?:^|\s)tròn(?:\s|$)/i, 'ROUND'],
]

export function detectSectionType(text: string): SectionType | null {
  if (!text) return null
  for (const [re, type] of SECTION_RULES) {
    if (re.test(text)) return type
  }
  return null
}

// ── Dimension normalization ──────────────────────────────────

export function normalizeDims(text: string): string {
  if (!text) return ''
  let s = text.trim()

  // Strip Vietnamese descriptive prefix (with optional "hình" and section word)
  s = s.replace(
    /^(thép\s*(?:hình\s*)?(?:tấm|ống|tròn|hộp|góc|câ?y|xẹp|u|c|h|i|l|v)?\s*|tôn\s*(?:tấm)?\s*|tấm\s*)/i,
    '',
  )

  // Strip multi-letter section abbreviation prefix
  s = s.replace(/^(CHS|SHS|RHS|PIPE|PLATE|CHANNEL|HE[ABM]|IPE|UP[NE]|UNC|EA|UA|RB|PL)\s*/i, '')
  // Strip single-letter section prefix when followed by digit
  s = s.replace(/^[CHUILV](?=\d)/i, '')
  s = s.replace(/^D(?=\d)/i, '')

  // Remove Ø symbol
  s = s.replace(/Ø\s*/g, '')

  // Strip hyphen-separated length suffix (e.g. -12000L, -6000, -6m)
  s = s.replace(/-\d+(?:\.\d+)?[mMlL]?\s*$/, '')

  // Normalize separators: × * X → x
  s = s.replace(/[×*]/g, 'x')
  s = s.replace(/\s*[xX]\s*/g, 'x')

  // Remove 'mm' unit label
  s = s.replace(/\s*mm\b/gi, '')

  // Convert trailing Nm → N*1000 (e.g. 6m → 6000, only at end of string)
  s = s.replace(/(\d+(?:\.\d+)?)m$/i, (_, num) => String(Math.round(parseFloat(num) * 1000)))

  // Remove remaining non-numeric/non-separator characters
  s = s.replace(/[^0-9x.]/g, '')

  // Clean up: collapse multiple x, trim leading/trailing x
  s = s.replace(/x{2,}/g, 'x').replace(/^x+|x+$/g, '')

  return s
}

// ── Dimension comparison ─────────────────────────────────────

export function dimsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const pa = a.split('x')
  const pb = b.split('x')
  const shorter = pa.length <= pb.length ? pa : pb
  const longer = pa.length <= pb.length ? pb : pa
  if (shorter.length === 0) return false
  for (let i = 0; i < shorter.length; i++) {
    const na = parseFloat(shorter[i])
    const nb = parseFloat(longer[i])
    if (isNaN(na) || isNaN(nb)) return false
    if (Math.abs(na - nb) > 0.001) return false
  }
  return true
}
