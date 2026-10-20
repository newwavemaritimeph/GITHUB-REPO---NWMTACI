// Positions for the STCW templates made by convert-stcw.ps1 (owner, 20 Oct 2026): name, the
// "Conducted" paragraph, Certificate / Registration No., Date of Issue and the Trainee Photo box.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const pdfjs = await import(pathToFileURL(path.join(process.env.PDFJS_DIR, "legacy/build/pdf.mjs")).href);
const r1 = (n) => Math.round(n * 10) / 10;
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".word.json"))) {
  const key = file.replace(/\.word\.json$/, "");
  const word = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8").replace(/^﻿/, ""));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, `${key}.measure.pdf`))), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const { width: W, height: H } = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.filter((i) => i.str?.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.hypot(i.transform[0], i.transform[1]) }));
  const find = (t) => items.find((i) => i.s.includes(t));
  const sameLine = (y) => items.filter((i) => Math.abs(i.y - y) < 0.6);
  const span = (line) => ({ left: Math.min(...line.map((i) => i.x)), right: Math.max(...line.map((i) => i.x + i.w)) });
  // The name and the Conducted paragraph are Arial in these Word files.
  const fields = { version: 2, pageW: r1(W), pageH: r1(H), sans: true };
  const name = find("[TRAINEE FULL NAME]") ?? find("TRAINEE FULL NAME]");
  if (name) { const s = span(sameLine(name.y)); fields.name = { cx: r1((s.left + s.right) / 2), y: r1(name.y), size: r1(Math.max(...sameLine(name.y).map((i) => i.size))), bold: word.name?.bold ?? true, maxW: r1(W - 2 * 56.7) }; }
  // The Conducted paragraph: from its first line down while lines of the same size follow closely.
  const first = find("Conducted");
  if (first) {
    const ys = [...new Set(items.filter((i) => Math.abs(i.size - first.size) < 0.2 && i.y <= first.y + 0.5).map((i) => r1(i.y)))].sort((a, b) => b - a);
    const lines = []; for (const y of ys) { if (lines.length && lines[lines.length - 1] - y > first.size * 2) break; lines.push(y); }
    const spans = lines.map((y) => span(sameLine(y)));
    const left = Math.min(...spans.map((s) => s.left)), right = Math.max(...spans.map((s) => s.right));
    fields.conducted = { x: r1(left), y: r1(first.y), w: r1(right - left), size: r1(first.size), leading: r1(lines.length > 1 ? lines[0] - lines[1] : first.size * 1.18), lines: lines.length, align: word.conducted.align, text: word.conducted.text };
  }
  for (const [k, t] of [["certNo", "[CERTIFICATE NO.]"], ["regNo", "[REGISTRATION NO.]"], ["issueDate", "[ISSUE DATE]"]]) {
    const it = find(t);
    if (it) { const at = it.s.indexOf("["); const px = at > 0 ? it.x + it.w * (at / it.s.length) : it.x; fields[k] = { x: r1(px), y: r1(it.y), size: r1(it.size) }; }
  }
  if (word.photo) {
    const ops = await page.getOperatorList(); let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === pdfjs.OPS.save) stack.push(ctm); else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === pdfjs.OPS.transform) ctm = mul(ops.argsArray[i], ctm);
      else if ((fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) && Math.abs(ctm[0] - word.photo.w) < 1.5 && Math.abs(ctm[3] - word.photo.h) < 1.5) { fields.photo = { x: r1(ctm[4]), y: r1(ctm[5]), w: r1(ctm[0]), h: r1(ctm[3]) }; break; }
    }
  }
  const missing = ["name", "conducted", "certNo", "regNo", "issueDate", "photo"].filter((k) => !fields[k]);
  console.log(key, missing.length ? `missing ${missing.join(", ")}` : "ok", JSON.stringify({ name: fields.name, conducted: fields.conducted && { ...fields.conducted, text: undefined }, certNo: fields.certNo, issueDate: fields.issueDate, photo: fields.photo }));
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(fields, null, 1));
}
