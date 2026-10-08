/**
 * Title Case for labels (owner, 8 Oct 2026 — replaces the sentence-case rule):
 * every main word capitalised; small words (a, an, and, as, at, but, by, for,
 * in, of, on, or, the, to, with, per, via, vs) stay lowercase unless first.
 * Acronyms, codes (2x2, BT-PSSR), emails and links are left as they are, and
 * sentences (a period, or more than 8 words) are not touched.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with", "per", "via", "vs"]);

export function titleCase(text: string): string {
  if (!/[a-z]/.test(text)) return text;
  const words = text.split(/(\s+)/);
  const real = words.filter((w) => w.trim());
  if (real.length > 8 || /[.!?]\s|[.!?]$/.test(text.replace(/…$/, "").replace(/e\.g\./g, ""))) return text;
  let first = true;
  return words.map((w) => {
    if (!w.trim()) return w;
    const out = w.split("-").map((part, i) => {
      const m = part.match(/^([^A-Za-z]*)([A-Za-z][\w'’]*)(.*)$/);
      if (!m) return part;
      const [, pre, word, post] = m;
      const lower = word.toLowerCase();
      const keepSmall = !first && i === 0 && SMALL.has(lower) && !pre;
      if (/[A-Z]/.test(word.slice(1)) || /\d/.test(word) || /[@/]|\.\w/.test(part)) return part;
      return pre + (keepSmall ? lower : word[0].toUpperCase() + word.slice(1)) + post;
    }).join("-");
    first = false;
    return out;
  }).join("");
}

/** Title Case for a label that may not be a string (numbers and elements pass through). */
export function tcl<T>(value: T): T {
  return (typeof value === "string" ? titleCase(value) : value) as T;
}
