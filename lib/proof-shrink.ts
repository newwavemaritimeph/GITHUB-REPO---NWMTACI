/**
 * Proofs go through the hosting platform, which refuses uploads over about
 * 4.5 MB. Photos and screenshots are scaled down to at most 2000 px and saved
 * as JPEG (stepping the quality down until under 3.5 MB); PDFs over the limit
 * are refused with a plain message.
 */
const PROOF_LIMIT = 3.5 * 1024 * 1024;
export async function shrinkProof(file: File): Promise<File> {
  if (file.size <= PROOF_LIMIT && file.type !== "image/heic") return file;
  if (!file.type.startsWith("image/")) throw new Error("The PDF is too large. Use a PDF under 3.5 MB or a screenshot.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This image type can't be read here. Save it as JPEG or PNG and try again."); });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= PROOF_LIMIT) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  throw new Error("The image is still too large after shrinking. Crop it to the payment details and try again.");
}
