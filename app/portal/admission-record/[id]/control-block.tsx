import { controlRows, type DocumentControl } from "@/lib/document-controls";

/** The form's details on the TAR and the Acknowledgement Receipt; the empty spacer keeps the letterhead centered when none are set. */
export function ControlBlock({ control }: { control?: DocumentControl | null }) {
  const rows = controlRows(control);
  if (!rows.length) return <i />;
  return <div className="tar-ctl">{rows.map(([label, value]) => <p key={label}><span>{label}</span><em>{value}</em></p>)}</div>;
}
