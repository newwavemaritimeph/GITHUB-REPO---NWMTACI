"use client";

import { useEffect } from "react";

/** On-screen toolbar for the admission record; hidden when printing. Opens the print dialog once on load. */
export function PrintControls({ arNumber }: { arNumber: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className="tar-toolbar">
    <div><b>Training Admission Record · {arNumber}</b><span>Print on half a short bond sheet (8.5 × 5.5 in), landscape, at 100% scale with no margins.</span></div>
    <span className="tar-toolbar-actions"><button type="button" onClick={() => window.print()}>Print</button><button type="button" className="ghost" onClick={() => window.close()}>Close</button></span>
  </div>;
}
