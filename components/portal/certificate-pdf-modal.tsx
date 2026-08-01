"use client";

import { useState } from "react";

// Renders a certificate as a PDF in the browser from the course's active
// template, overlaying the trainee's details and an OPTIONAL 2x2 photo.
//
// The 2x2 photo is handled entirely client-side (held in memory, embedded into
// the generated PDF, then discarded) — it is NEVER uploaded or stored anywhere.
export type CertPdfTarget = {
  templateId: string | null;
  traineeName: string;
  courseName: string;
  enrollmentNumber: string;
  certificateNumber?: string | null;
  completionDate?: string | null;
};

const PT_PER_INCH = 72;

export function CertificatePdfModal({ target, onClose }: { target: CertPdfTarget; onClose: () => void }) {
  const [photo, setPhoto] = useState<{ bytes: ArrayBuffer; type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Photo box, in points from the TOP-LEFT of the page (2x2 inch default).
  const [px, setPx] = useState(410);
  const [py, setPy] = useState(120);
  const [psize, setPsize] = useState(144);
  // Trainee-name baseline, points from top-left.
  const [nx, setNx] = useState(150);
  const [ny, setNy] = useState(300);
  const [nameSize, setNameSize] = useState(24);

  async function onPhoto(file: File | undefined) {
    if (!file) { setPhoto(null); return; }
    if (file.type !== "image/png" && file.type !== "image/jpeg") { setMessage("Use a PNG or JPEG 2x2 photo."); return; }
    if (file.size > 8 * 1024 * 1024) { setMessage("The photo must be smaller than 8 MB."); return; }
    setMessage("");
    setPhoto({ bytes: await file.arrayBuffer(), type: file.type });
  }

  async function generate() {
    if (!target.templateId) { setMessage("This course has no active certificate template yet. Upload one first."); return; }
    setBusy(true); setMessage("");
    try {
      const meta = await fetch(`/api/staff/certificate-templates/${target.templateId}`).then((r) => r.json());
      if (!meta.url) throw new Error(meta.error ?? "Could not load the template.");
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
      const H = page.getHeight();
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);

      // Trainee name (top-left coords → pdf bottom-left origin).
      if (target.traineeName.trim()) {
        page.drawText(target.traineeName.toUpperCase(), { x: nx, y: H - ny, size: nameSize, font, color: rgb(0.07, 0.25, 0.39) });
      }
      // Small supporting line: course · certificate no. · date.
      const sub = [target.courseName, target.certificateNumber, target.completionDate].filter(Boolean).join("   ·   ");
      if (sub) page.drawText(sub, { x: nx, y: H - ny - 22, size: 11, font: await pdf.embedFont(StandardFonts.Helvetica), color: rgb(0.3, 0.4, 0.47) });

      // 2x2 photo — embedded transiently, never stored.
      if (photo) {
        const img = photo.type === "image/png" ? await pdf.embedPng(photo.bytes) : await pdf.embedJpg(photo.bytes);
        page.drawImage(img, { x: px, y: H - py - psize, width: psize, height: psize });
        page.drawRectangle({ x: px, y: H - py - psize, width: psize, height: psize, borderColor: rgb(0.6, 0.7, 0.76), borderWidth: 0.8 });
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
          <label className="full">2x2 photo (optional — used only for this PDF, never saved)
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          <label>Photo — X (from left)<input type="number" value={px} onChange={(e) => setPx(Number(e.target.value))} /></label>
          <label>Photo — Y (from top)<input type="number" value={py} onChange={(e) => setPy(Number(e.target.value))} /></label>
          <label>Photo size (pt · 144 = 2in)<input type="number" value={psize} onChange={(e) => setPsize(Number(e.target.value))} /></label>
          <label>Name — X<input type="number" value={nx} onChange={(e) => setNx(Number(e.target.value))} /></label>
          <label>Name — Y<input type="number" value={ny} onChange={(e) => setNy(Number(e.target.value))} /></label>
          <label>Name size<input type="number" value={nameSize} onChange={(e) => setNameSize(Number(e.target.value))} /></label>
          <p className="portal-form-note full">Adjust the positions to match your template, then generate. The PDF opens in a new tab to view or print. The 2x2 photo is embedded into this one PDF only and is never uploaded or stored.</p>
          <div className="portal-form-actions full">
            <button type="button" className="ghost-button" onClick={onClose}>Close</button>
            <button type="button" className="portal-primary" disabled={busy || !target.templateId} onClick={() => void generate()}>{busy ? "Generating…" : "Generate & open PDF"}</button>
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
