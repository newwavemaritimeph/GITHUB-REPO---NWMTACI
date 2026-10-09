import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";

/**
 * Finds the 2x2 photo box on a certificate template PDF (owner, 9 Oct 2026),
 * so the trainee's photo prints inside it with no manual setup.
 *
 * It reads the first page's drawing — including nested drawings (form
 * XObjects) and their transforms — and collects every rectangle-like shape:
 * `re` rectangles, closed four-corner paths, boxes made of four separate border
 * lines (how Word draws text-box and table borders) and placeholder pictures.
 * The best candidate is the square-ish box closest to 2 × 2 in (144 pt).
 * Coordinates are page points from the bottom-left corner.
 */
export type PhotoBox = { x: number; y: number; w: number; h: number; source: "box" | "lines" | "picture"; pageW: number; pageH: number };

type M = [number, number, number, number, number, number];
type Pt = [number, number];
type Rect = { x: number; y: number; w: number; h: number; source: PhotoBox["source"] };
type Seg = { x1: number; y1: number; x2: number; y2: number };

const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m: M, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const boundsOf = (pts: Pt[]) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
const TOL = 1.5;

/** Tokenises a content stream into numbers, names and operators (strings, arrays, dicts and inline images skipped). */
function* tokens(src: string): Generator<{ t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string }> {
  let i = 0;
  const n = src.length;
  const ws = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  const delim = (c: string) => "()<>[]{}/%".includes(c);
  while (i < n) {
    const c = src[i];
    if (ws(c)) { i++; continue; }
    if (c === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
    if (c === "(") { let depth = 1; i++; while (i < n && depth) { if (src[i] === "\\") i += 2; else { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; } } continue; }
    if (c === "<" && src[i + 1] === "<") { let depth = 1; i += 2; while (i < n && depth) { if (src[i] === "<" && src[i + 1] === "<") { depth++; i += 2; } else if (src[i] === ">" && src[i + 1] === ">") { depth--; i += 2; } else i++; } continue; }
    if (c === "<") { while (i < n && src[i] !== ">") i++; i++; continue; }
    if (c === "[" || c === "]" || c === "{" || c === "}" || c === ">") { i++; continue; }
    if (c === "/") { let j = i + 1; while (j < n && !ws(src[j]) && !delim(src[j])) j++; yield { t: "name", v: src.slice(i + 1, j) }; i = j; continue; }
    let j = i;
    while (j < n && !ws(src[j]) && !delim(src[j])) j++;
    const word = src.slice(i, j) || src[i];
    i = j > i ? j : i + 1;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { yield { t: "num", v: Number(word) }; continue; }
    if (word === "BI") { const end = src.indexOf("EI", i); i = end < 0 ? n : end + 2; continue; }
    yield { t: "op", v: word };
  }
}

function streamText(stream: unknown) {
  if (stream instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  const contents = (stream as { getContents?: () => Uint8Array })?.getContents?.call(stream);
  return contents ? Buffer.from(contents).toString("latin1") : "";
}

/** Walks one content stream, adding rectangles and straight segments in page space. */
function walk(doc: PDFDocument, text: string, resources: PDFDict | undefined, start: M, rects: Rect[], segs: Seg[], depth: number) {
  let ctm = start;
  const stack: M[] = [];
  let nums: number[] = [];
  let lastName = "";
  let path: Pt[][] = [], current: Pt[] = [], curved = false;
  const flushPath = (painted: boolean) => {
    if (current.length) path.push(current);
    if (painted && !curved) {
      for (const sub of path) {
        const closed = sub.length >= 4 && Math.abs(sub[0][0] - sub[sub.length - 1][0]) < TOL && Math.abs(sub[0][1] - sub[sub.length - 1][1]) < TOL;
        const pts = closed ? sub.slice(0, -1) : sub;
        const axis = pts.every((p, k) => { const q = pts[(k + 1) % pts.length]; return Math.abs(p[0] - q[0]) < TOL || Math.abs(p[1] - q[1]) < TOL; });
        if ((closed || pts.length === 4) && pts.length === 4 && axis) { const b = boundsOf(pts); rects.push({ ...b, source: "box" }); }
        for (let k = 0; k + 1 < sub.length; k++) segs.push({ x1: sub[k][0], y1: sub[k][1], x2: sub[k + 1][0], y2: sub[k + 1][1] });
      }
    }
    path = []; current = []; curved = false;
  };
  for (const tok of tokens(text)) {
    if (tok.t === "num") { nums.push(tok.v); continue; }
    if (tok.t === "name") { lastName = tok.v; continue; }
    const op = tok.v, a = nums;
    nums = [];
    switch (op) {
      case "q": stack.push(ctm); break;
      case "Q": ctm = stack.pop() ?? start; break;
      case "cm": if (a.length >= 6) ctm = mul(a.slice(-6) as M, ctm); break;
      case "re": if (a.length >= 4) { const [x, y, w, h] = a.slice(-4); const pts: Pt[] = [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)]; if (current.length) path.push(current); path.push([...pts, pts[0]]); current = []; } break;
      case "m": if (a.length >= 2) { if (current.length) path.push(current); current = [apply(ctm, a[a.length - 2], a[a.length - 1])]; } break;
      case "l": if (a.length >= 2 && current.length) current.push(apply(ctm, a[a.length - 2], a[a.length - 1])); break;
      case "c": case "v": case "y": curved = true; if (a.length >= 2 && current.length) current.push(apply(ctm, a[a.length - 2], a[a.length - 1])); break;
      case "h": if (current.length) current.push(current[0]); break;
      case "S": case "s": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*": flushPath(true); break;
      case "n": flushPath(false); break;
      case "Do": {
        if (depth > 4 || !resources) break;
        const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
        const ref = xobjects?.get(PDFName.of(lastName));
        const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        if (!(obj instanceof PDFRawStream)) break;
        const subtype = obj.dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();
        if (subtype === "/Image") { const b = boundsOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)]); rects.push({ ...b, source: "picture" }); }
        if (subtype === "/Form") {
          const matrix = obj.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
          const fm = matrix ? (matrix.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as M) : IDENTITY;
          walk(doc, streamText(obj), obj.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ?? resources, mul(fm, ctm), rects, segs, depth + 1);
        }
        break;
      }
    }
  }
}

/** Boxes made of separate border lines: two horizontals and two verticals meeting at the corners. */
function boxesFromLines(segs: Seg[]): Rect[] {
  const horiz = segs.filter((s) => Math.abs(s.y1 - s.y2) < TOL && Math.abs(s.x1 - s.x2) >= 40).map((s) => ({ y: (s.y1 + s.y2) / 2, x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2) }));
  const vert = segs.filter((s) => Math.abs(s.x1 - s.x2) < TOL && Math.abs(s.y1 - s.y2) >= 40).map((s) => ({ x: (s.x1 + s.x2) / 2, y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) }));
  const out: Rect[] = [];
  if (horiz.length > 400 || vert.length > 400) return out;
  const near = (a: number, b: number) => Math.abs(a - b) <= 3;
  for (const bottom of horiz) for (const top of horiz) {
    if (top.y - bottom.y < 40 || !near(top.x1, bottom.x1) || !near(top.x2, bottom.x2)) continue;
    const left = vert.find((v) => near(v.x, bottom.x1) && v.y1 <= bottom.y + 3 && v.y2 >= top.y - 3);
    const right = vert.find((v) => near(v.x, bottom.x2) && v.y1 <= bottom.y + 3 && v.y2 >= top.y - 3);
    if (left && right) out.push({ x: bottom.x1, y: bottom.y, w: bottom.x2 - bottom.x1, h: top.y - bottom.y, source: "lines" });
  }
  return out;
}

/** Picks the most likely 2x2 photo box from the candidates (exported for tests). */
export function pickPhotoBox(rects: Rect[], pageW: number, pageH: number): Rect | null {
  const scored = rects
    .filter((r) => r.w >= 54 && r.h >= 54 && r.w <= 260 && r.h <= 260 && r.w < pageW * 0.6 && r.h < pageH * 0.6)
    .map((r) => { const aspect = Math.max(r.w, r.h) / Math.min(r.w, r.h); return { r, aspect, score: Math.abs(r.w - 144) + Math.abs(r.h - 144) + 220 * (aspect - 1) + (r.source === "picture" ? 60 : 0) }; })
    .filter((c) => c.aspect <= 1.35)
    .sort((a, b) => a.score - b.score);
  return scored[0]?.r ?? null;
}

/** The 2x2 photo box on the first page of a PDF template, or null when none is found. */
export async function detectPhotoBox(bytes: Uint8Array): Promise<PhotoBox | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    const box = page.getMediaBox();
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : contents ? [contents] : [];
    const text = streams.map(streamText).join("\n");
    const rects: Rect[] = [], segs: Seg[] = [];
    walk(doc, text, page.node.Resources(), [1, 0, 0, 1, -box.x, -box.y], rects, segs, 0);
    const best = pickPhotoBox([...rects, ...boxesFromLines(segs)], width, height);
    return best ? { ...best, pageW: width, pageH: height } : null;
  } catch {
    return null;
  }
}
