/**
 * Deterministic guardrail layers L1, L2 and L5 plus the injection heuristics of L3
 * (specs/002 security.md). Pure functions — fully unit-tested, no AI calls.
 */
import { randomBytes } from 'node:crypto';

// ------------------------------------------------------------------ L1 input hygiene

// Control, soft-hyphen, zero-width, bidi-override and BOM characters (built from escapes).
const INVISIBLE = new RegExp(
  '[' +
    ['\\u0000-\\u0008', '\\u000B', '\\u000C', '\\u000E-\\u001F', '\\u007F', '\\u00AD'].join('') +
    ['\\u200B-\\u200F', '\\u202A-\\u202E', '\\u2060-\\u2064', '\\u2066-\\u2069', '\\uFEFF'].join(
      '',
    ) +
    ']',
  'g',
);

/** NFKC-normalises, strips control / zero-width / bidi characters, collapses long runs. */
export function sanitizeInput(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/(.)\1{19,}/gsu, (_m, c: string) => c.repeat(20))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------ L2 PII masking

type PiiKind = 'EMAIL' | 'CARD' | 'IBAN' | 'VIN' | 'PHONE' | 'PLATE';

function luhnValid(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

interface Detector {
  kind: PiiKind;
  pattern: RegExp;
  accept?: (match: string) => boolean;
}

/** Order matters: more specific detectors run first. */
const DETECTORS: Detector[] = [
  { kind: 'EMAIL', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  {
    kind: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g,
  },
  {
    kind: 'CARD',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (m) => luhnValid(m.replace(/\D/g, '')),
  },
  {
    // 17 chars, no I/O/Q, must mix letters and digits.
    kind: 'VIN',
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g,
    accept: (m) => /\d/.test(m) && /[A-Z]/.test(m),
  },
  {
    kind: 'PHONE',
    pattern: /(?<![\w])\+?\d[\d ().-]{6,18}\d(?![\w])/g,
    accept: (m) => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= 7 && digits <= 15;
    },
  },
  {
    // Registration plates such as "AB-123-CD", "AB 1234 CD", "B-XY 123": letters and digits
    // separated by a dash or space.
    kind: 'PLATE',
    pattern: /\b[A-Z]{1,3}[- ][A-Z]{0,2}\s?\d{2,4}(?:[- ][A-Z]{1,3})?\b/g,
    accept: (m) => /[- ]/.test(m) && /\d/.test(m) && m.replace(/[^A-Z0-9]/g, '').length >= 4,
  },
];

export interface MaskResult {
  masked: string;
  /** placeholder → original value (kept in memory for this run only). */
  values: Map<string, string>;
}

/**
 * Replaces personal data with placeholders like `[EMAIL_1]`. Passing an existing
 * `values` map keeps numbering consistent across several texts of one run.
 */
export function maskPii(text: string, values: Map<string, string> = new Map()): MaskResult {
  const reverse = new Map([...values].map(([k, v]) => [v, k]));
  const counters = new Map<PiiKind, number>();
  for (const key of values.keys()) {
    const kind = key.slice(1, key.lastIndexOf('_')) as PiiKind;
    counters.set(
      kind,
      Math.max(counters.get(kind) ?? 0, Number(key.slice(key.lastIndexOf('_') + 1, -1))),
    );
  }
  let masked = text;
  for (const { kind, pattern, accept } of DETECTORS) {
    masked = masked.replace(pattern, (match) => {
      if (match.startsWith('[') || (accept && !accept(match))) return match;
      const existing = reverse.get(match);
      if (existing) return existing;
      const n = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, n);
      const placeholder = `[${kind}_${n}]`;
      values.set(placeholder, match);
      reverse.set(match, placeholder);
      return placeholder;
    });
  }
  return { masked, values };
}

/** True when the text contains personal data that is not a placeholder. */
export function containsPii(text: string): boolean {
  return maskPii(text).values.size > 0;
}

/**
 * Restores placeholders in the model's answer — only values that came from the
 * requester's own input are known, so nothing else can ever be revealed.
 */
export function unmaskPii(text: string, values: Map<string, string>): string {
  return text.replace(/\[(EMAIL|CARD|IBAN|VIN|PHONE|PLATE)_\d+\]/g, (p) => values.get(p) ?? p);
}

// ------------------------------------------------------------------ L3 heuristics

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|system)\b.{0,40}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(reveal|show|print|repeat|output|display|tell me)\b.{0,40}\b(system prompt|hidden prompt|instructions|your prompt|initial prompt|configuration)\b/i,
  /\byou are now\b|\bact as (an? )?(admin|administrator|developer|system|root)\b|\bdeveloper mode\b|\bjailbreak\b|\bDAN\b/i,
  /\b(other|all|every)\s+(customers?|users?|clients?)('s)?\b.{0,40}\b(data|emails?|phones?|requests?|tickets?|details|information|addresses)\b/i,
  /<\/?\s*(system|request|sources|history|thread|assistant)\b[^>]*>/i,
  /\b(base64|rot13|hex)\b.{0,30}\b(decode|encoded|instruction)/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

// ------------------------------------------------------------------ L4 helpers

export const newNonce = () => randomBytes(6).toString('hex');
export const newCanary = () => `CANARY-${randomBytes(8).toString('hex')}`;

// ------------------------------------------------------------------ L5 output validation

export interface OutputCheckInput {
  answer: string;
  citations: string[];
  confidence: number;
  allowedAliases: ReadonlySet<string>;
  canary: string;
  minConfidence?: number;
  maxLength?: number;
}

export type OutputCheck = { ok: true } | { ok: false; rule: string };

export function checkAnswer(input: OutputCheckInput): OutputCheck {
  const { answer, citations, confidence, allowedAliases, canary } = input;
  if (!answer.trim()) return { ok: false, rule: 'empty_answer' };
  if (answer.length > (input.maxLength ?? 1200)) return { ok: false, rule: 'too_long' };
  if (confidence < (input.minConfidence ?? 0.6)) return { ok: false, rule: 'low_confidence' };
  if (citations.length === 0) return { ok: false, rule: 'no_citations' };
  if (citations.some((c) => !allowedAliases.has(c))) return { ok: false, rule: 'unknown_citation' };
  if (answer.includes(canary) || /CANARY-[0-9a-f]{8,}/i.test(answer))
    return { ok: false, rule: 'canary_leak' };
  if (/https?:\/\/|www\.[a-z0-9-]+\.[a-z]/i.test(answer)) return { ok: false, rule: 'url' };
  if (containsPii(answer)) return { ok: false, rule: 'pii' };
  if (/<\/?\s*(system|request|sources|history|thread)\b/i.test(answer))
    return { ok: false, rule: 'prompt_leak' };
  return { ok: true };
}
