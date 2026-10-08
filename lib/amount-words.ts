/**
 * Amount in words for vouchers, e.g. 1845075 centavos →
 * "Eighteen thousand four hundred fifty pesos and 75/100 only".
 */
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion"];

function belowThousand(n: number) {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

export function wholeNumberInWords(n: number) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zero";
  const groups: string[] = [];
  for (let i = 0; n > 0 && i < SCALES.length; i++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${belowThousand(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
  }
  return groups.join(" ");
}

export function pesosInWords(centavos: number) {
  const value = Math.round(Math.abs(centavos));
  const pesos = Math.floor(value / 100), cents = value % 100;
  const words = `${wholeNumberInWords(pesos)} ${pesos === 1 ? "peso" : "pesos"}${cents ? ` and ${String(cents).padStart(2, "0")}/100` : ""} only`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
