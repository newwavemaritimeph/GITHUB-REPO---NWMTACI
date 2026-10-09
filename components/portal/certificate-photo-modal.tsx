"use client";

import { useEffect, useState } from "react";
import { PHOTO_MAX_BYTES, PHOTO_SIZE, whiteBackground } from "@/lib/certificate-photo";
import { Message, Modal } from "./shared-ui";

/**
 * Certificate 2x2 photo upload (owner, 9 Oct 2026). Any phone photo is
 * centre-cropped to a square and resized in the browser to 600 × 600 px
 * (2 in at 300 dpi), saved as a JPEG of at most 500 KB. The background is
 * checked for white, and the Releasing Officer confirms the white background
 * and white polo with collar before saving.
 */

type Prepared = { blob: Blob; url: string; from: string; to: string; white: boolean; share: number };
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function prepare(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE; canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize photos.");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  const check = whiteBackground(ctx.getImageData(0, 0, PHOTO_SIZE, PHOTO_SIZE).data, PHOTO_SIZE, PHOTO_SIZE);
  let quality = 0.92, blob: Blob | null = null;
  for (;;) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("The photo could not be resized.");
    if (blob.size <= PHOTO_MAX_BYTES || quality <= 0.5) break;
    quality -= 0.07;
  }
  const result = { blob, url: URL.createObjectURL(blob), from: `${bitmap.width} × ${bitmap.height} · ${kb(file.size)}`, to: `${PHOTO_SIZE} × ${PHOTO_SIZE} · ${kb(blob.size)}`, white: check.ok, share: check.whiteShare };
  bitmap.close();
  return result;
}

export function CertificatePhotoModal({ enrollmentId, traineeName, fileName, replacing, onClose, onDone }: { enrollmentId: string; traineeName: string; fileName: string; replacing?: boolean; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [photo, setPhoto] = useState<Prepared | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  async function choose(file: File | undefined) {
    setError(""); setConfirmed(false);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError("Choose a JPEG, PNG or WebP photo."); return; }
    if (file.size > 20 * 1024 * 1024) { setError("The photo is larger than 20 MB. Choose a smaller one."); return; }
    try { setBusy(true); setPhoto(await prepare(file)); } catch (e) { setError(e instanceof Error ? e.message : "The photo could not be read."); } finally { setBusy(false); }
  }
  async function save() {
    if (!photo) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("enrollmentId", enrollmentId);
      form.set("file", new File([photo.blob], fileName, { type: "image/jpeg" }));
      form.set("confirmed", String(confirmed));
      form.set("backgroundWhite", String(photo.white));
      form.set("width", String(PHOTO_SIZE)); form.set("height", String(PHOTO_SIZE));
      const response = await fetch("/api/staff/certificate-photo", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The photo could not be saved.");
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "The photo could not be saved."); } finally { setBusy(false); }
  }
  return <Modal title={replacing ? "Replace 2x2 Photo" : "Upload 2x2 Photo"} onClose={onClose}><div className="cp-modal">
      <p className="cp-who"><b>{traineeName}</b><span className="cl-mono">{fileName}</span></p>
      {error && <Message kind="error" text={error} />}
      <div className="cp-body">
        <div className="cp-frame">{photo ? <img src={photo.url} alt="2x2 photo preview" /> : <span>2 × 2</span>}</div>
        <div className="cp-side">
          <label className="portal-secondary cp-pick">{photo ? "Choose Another Photo" : "Choose Photo"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void choose(e.target.files?.[0])} hidden /></label>
          <ul className="cp-rules"><li>White background</li><li>White polo with collar</li><li>Face centred, looking straight ahead</li></ul>
          {photo && <>
            <p className="cp-note">Resized from {photo.from} to {photo.to}.</p>
            {photo.white ? <p className="cp-ok">✓ White background</p> : <p className="cp-warn">⚠ The background does not look white. Retake the photo against a white wall.</p>}
          </>}
        </div>
      </div>
      <label className="cp-confirm"><input type="checkbox" checked={confirmed} disabled={!photo} onChange={(e) => setConfirmed(e.target.checked)} /> White background and white polo with collar</label>
      <div className="portal-form-actions"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !photo || !confirmed} onClick={() => void save()}>{busy ? "Saving…" : "Save Photo"}</button></div>
  </div></Modal>;
}

/** Opens the stored photo (signed link) in a new tab. */
export async function openCertificatePhoto(enrollmentId: string) {
  const win = window.open("", "_blank");
  const response = await fetch(`/api/staff/certificate-photo?enrollmentId=${enrollmentId}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (win) { if (body.url) win.location.href = body.url; else win.close(); }
}
