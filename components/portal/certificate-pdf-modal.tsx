"use client";

import { useEffect, useState } from "react";

// Renders a certificate as a PDF in the browser from the course's active
// template, overlaying the trainee's details and an OPTIONAL 2x2 photo.
//
// The photo box is auto-detected from the template (server-side) so the officer
// only uploads the photo — no coordinates. The 2x2 photo is handled entirely
// client-side (held in memory, embedded into the generated PDF, then discarded)
// — it is NEVER uploaded or stored anywhere.
export type CertPdfTarget = {
  templateId: string | null;
  traineeName: string;
  courseName: string;
  enrollmentNumber: string;
  certificateNumber?: string | null;
  conductedDate?: string | null;
  issuedDate?: string | null;
  registrationNumber?: string | null;
};

type PhotoBox = { x: number; yTop: number; w: number; h: number; pageW: number; pageH: number } | null;
type Meta = { url?: string; isPdf?: boolean; photoBox?: PhotoBox; error?: string };

export function CertificatePdfModal({ target, onClose }: { target: CertPdfTarget; onClose: () => void }) {
  const [photo, setPhoto] = useState<{ bytes: ArrayBuffer; type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  // Manual fallback box (points from TOP-LEFT), used only when auto-detect finds nothing.
  const [px, setPx] = useState(238);
  const [py, setPy] = useState(710);
  const [psize, setPsize] = useState(118);
  // Trainee-name baseline, points from top-left; X auto-centres unless overridden.
  const [ny, setNy] = useState(300);
  const [nameSize, setNameSize] = useState(24);
  const [center, setCenter] = useState(true);

  useEffect(() => {
    let live = true;
    if (!target.templateId) { setMeta({ error: "This course has no active certificate template yet. Upload one first." }); return; }
    fetch(`/api/staff/certificate-templates/${target.templateId}`).then((r) => r.json()).then((m) => { if (live) setMeta(m); }).catch(() => { if (live) setMeta({ error: "Could not load the template." }); });
    return () => { live = false; };
  }, [target.templateId]);

  const autoBox = meta?.photoBox ?? null;

  async function onPhoto(file: File | undefined) {
    if (!file) { setPhoto(null); return; }
    if (file.type !== "image/png" && file.type !== "image/jpeg") { setMessage("Use a PNG or JPEG 2x2 photo."); return; }
    if (file.size > 8 * 1024 * 1024) { setMessage("The photo must be smaller than 8 MB."); return; }
    setMessage("");
    setPhoto({ bytes: await file.arrayBuffer(), type: file.type });
  }

  async function generate() {
    if (!meta?.url) { setMessage(meta?.error ?? "Template is not ready."); return; }
    setBusy(true); setMessage("");
    try {
      const templateBytes = await fetch(meta.url).then((r) => r.arrayBuffer());
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      let page;
      if (meta.isPdf) {
        const src = await PDFDocument.load(templateBytes);
        const [copied] = await pdf.copyPages(src, [0]);
        page = pdf.addPage([copied.getWidth(), copied.getHeight()]);
        const embedded = await pdf.embedPage(copied);
        page.drawPage(embedded, { x: 0, y: 0, width: copied.getWidth(), height: copied.getHeight() });
      } else {
        const image = meta.url.toLowerCase().includes(".png") || isPng(new Uint8Array(templateBytes)) ? await pdf.embedPng(templateBytes) : await pdf.embedJpg(templateBytes);
        page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const H = page.getHeight(), W = page.getWidth();
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);

      if (target.traineeName.trim()) {
        const name = target.traineeName.toUpperCase();
        const x = center ? (W - font.widthOfTextAtSize(name, nameSize)) / 2 : 150;
        page.drawText(name, { x, y: H - ny, size: nameSize, font, color: rgb(0.07, 0.25, 0.39) });
      }
      const sub = [target.courseName, target.certificateNumber && `Cert No. ${target.certificateNumber}`, target.registrationNumber && `Reg No. ${target.registrationNumber}`, target.conductedDate && `Conducted ${target.conductedDate}`, target.issuedDate && `Issued ${target.issuedDate}`].filter(Boolean).join("   ·   ");
      if (sub) {
        const subFont = await pdf.embedFont(StandardFonts.Helvetica);
        const x = center ? (W - subFont.widthOfTextAtSize(sub, 11)) / 2 : 150;
        page.drawText(sub, { x, y: H - ny - 22, size: 11, font: subFont, color: rgb(0.3, 0.4, 0.47) });
      }

      if (photo) {
        const img = photo.type === "image/png" ? await pdf.embedPng(photo.bytes) : await pdf.embedJpg(photo.bytes);
        if (autoBox) {
          page.drawImage(img, { x: autoBox.x, y: H - autoBox.yTop - autoBox.h, width: autoBox.w, height: autoBox.h });
        } else {
          page.drawImage(img, { x: px, y: H - py - psize, width: psize, height: psize });
          page.drawRectangle({ x: px, y: H - py - psize, width: psize, height: psize, borderColor: rgb(0.6, 0.7, 0.76), borderWidth: 0.8 });
        }
      }

      const bytes = await pdf.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate the certificate PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="portal-modal" role="dialog" aria-modal="true" aria-labelledby="cert-pdf-title">
        <header><div><span className="portal-eyebrow">Certificate</span><h2 id="cert-pdf-title">Generate certificate PDF</h2></div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
        <div className="portal-form">
          {message && <div className="portal-message full" role="status">{message}</div>}
          <div className="full"><strong>{target.traineeName}</strong> — {target.courseName} · {target.enrollmentNumber}</div>
          <div className="full portal-form-note">{autoBox ? "✓ Photo box auto-detected on the template — the photo is placed automatically." : meta && !meta.error ? "No photo box detected on this template — set the position below." : "Loading template…"}</div>
          <label className="full">2x2 photo (used only for this PDF, never saved)
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          {!autoBox && meta && !meta.error && (<>
            <label>Photo — X (from left)<input type="number" value={px} onChange={(e) => setPx(Number(e.target.value))} /></label>
            <label>Photo — Y (from top)<input type="number" value={py} onChange={(e) => setPy(Number(e.target.value))} /></label>
            <label>Photo size (pt · 144 = 2in)<input type="number" value={psize} onChange={(e) => setPsize(Number(e.target.value))} /></label>
          </>)}
          <label className="portal-check full"><input type="checkbox" checked={center} onChange={(e) => setCenter(e.target.checked)} /><span>Centre the trainee name horizontally</span></label>
          <label>Name — Y (from top)<input type="number" value={ny} onChange={(e) => setNy(Number(e.target.value))} /></label>
          <label>Name size<input type="number" value={nameSize} onChange={(e) => setNameSize(Number(e.target.value))} /></label>
          <p className="portal-form-note full">The PDF opens in a new tab to view or print. The 2x2 photo is embedded into this one PDF only and is never uploaded or stored.</p>
          <div className="portal-form-actions full">
            <button type="button" className="ghost-button" onClick={onClose}>Close</button>
            <button type="button" className="portal-primary" disabled={busy || !meta?.url} onClick={() => void generate()}>{busy ? "Generating…" : "Generate & open PDF"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

// Sniff a PNG signature so image templates render even when the URL lacks an extension.
function isPng(bytes: Uint8Array) {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}
