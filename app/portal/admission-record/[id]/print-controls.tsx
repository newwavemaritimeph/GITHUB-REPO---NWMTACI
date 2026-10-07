"use client";

import { useEffect } from "react";

/** On-screen toolbar for the admission record; hidden when printing. Opens the print dialog once on load. */
export function PrintControls({ arNumber }: { arNumber: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className="tar-toolbar">
    <div><b>Training Admission Record · {arNumber}</b><span>Print on legal paper (8.5 × 14 in), portrait, at 100% scale with no margins. Cut along the dashed line: original for the trainee, duplicate for the file.</span></div>
    <span className="tar-toolbar-actions"><button type="button" onClick={() => window.print()}>Print</button><button type="button" className="ghost" onClick={() => window.close()}>Close</button></span>
  </div>;
}
