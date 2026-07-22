export function findPaymentReference(text: string) {
  const labelled = text.match(/(?:reference|ref\.?|transaction|trace)(?:\s*(?:no|number|id)\.?)?\s*[:#-]?\s+([A-Z0-9-]{6,32})/i);
  if (labelled?.[1]) return labelled[1].toUpperCase();
  const candidate = text.match(/\b(?=[A-Z0-9-]{8,32}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/i);
  return candidate?.[0]?.toUpperCase() ?? "";
}
