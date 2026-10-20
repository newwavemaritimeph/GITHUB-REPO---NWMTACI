import layouts from "@/lib/certificate-template-layouts.json";
import { isFieldsV2, type TemplateFieldsV2 } from "@/lib/certificate-overlay";

/**
 * Field positions measured from New Wave's 141 Word templates (scripts/certificate-templates,
 * 20 Oct 2026), keyed by the stored file name ("ABC---Awareness-on-Basic-Computer.pdf").
 * Used when a converted template was uploaded without its .json position file, so the
 * course description, name, dates and numbers still print in place.
 */
const BY_FILE = layouts as unknown as Record<string, unknown>;

/** Storage path "<courseId>/<uuid>-<file name>" → the bundled positions for that converted template, or null. */
export function bundledLayout(storagePath: string | null | undefined): TemplateFieldsV2 | null {
  const file = storagePath?.split("/").pop()?.replace(/^[0-9a-f-]{36}-/i, "");
  const found = file ? BY_FILE[file] : null;
  return isFieldsV2(found) ? found : null;
}
