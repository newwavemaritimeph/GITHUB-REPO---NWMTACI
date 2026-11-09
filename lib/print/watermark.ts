import type { PDFImage, PDFPage } from "pdf-lib";

/**
 * New Wave's emblem, large and faint behind a report (owner, 9 Nov 2026, from New Wave's Word Attendance Sheet): about
 * 85% of the width on a portrait page with its top just below the middle, running off the bottom edge; on a landscape page
 * the same size against the height. Draw it first so the form prints over it.
 */
export function drawWatermark(page: PDFPage, emblem: PDFImage) {
  const { width: W, height: H } = page.getSize();
  const portrait = H > W, size = portrait ? W * 0.85 : H * 0.82, top = portrait ? H * 0.49 : H * 0.66;
  page.drawImage(emblem, { x: (W - size) / 2, y: top - size, width: size, height: size, opacity: 0.16 });
}
