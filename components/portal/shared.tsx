"use client";

import type { ReactNode } from "react";
import { Pill } from "@/components/ui/kit";
import type { Stage } from "@/lib/system/types";

export type Module =
  | "Dashboard"
  | "Registrations"
  | "Trainees"
  | "Enrollments"
  | "Courses & centers"
  | "Schedules"
  | "Payments"
  | "Accounting"
  | "Instructions"
  | "Attendance"
  | "Instructors"
  | "Classrooms"
  | "Training setup"
  | "Certificates"
  | "Requests"
  | "HR & payroll"
  | "User setup"
  | "Payroll"
  | "Request"
  | "Search trainee"
  | "Setup"
  | "Reports"
  | "Settings";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  padded = true,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={`panel ${padded ? "panel-padded" : ""}`}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Collapses the detailed internal stage to the four latest-stage labels
 * New Wave shows: In Training, Training Complete, Certificate Release, Pending. */
export type LatestStage = "Pending" | "In Training" | "Training Complete" | "Certificate Release";
export function simplifiedStage(stage: Stage): LatestStage {
  if (stage === "In training") return "In Training";
  if (stage === "Training complete") return "Training Complete";
  if (stage === "Certificate ready" || stage === "Certificate released") return "Certificate Release";
  return "Pending";
}

export function StageBadge({ stage }: { stage: Stage }) {
  const label = simplifiedStage(stage);
  const tone = label === "In Training" ? "blue" : label === "Training Complete" ? "green" : label === "Certificate Release" ? "violet" : "slate";
  return <Pill tone={tone}>{label}</Pill>;
}

export const STAGE_ORDER: Stage[] = [
  "Registered",
  "Awaiting payment",
  "Payment verification",
  "Paid",
  "Instructions sent",
  "In training",
  "Training complete",
  "Certificate ready",
  "Certificate released",
];

export function StageTrack({ stage }: { stage: Stage }) {
  const steps = ["Registration", "Payment", "Instructions", "Training", "Certificate"] as const;
  const reached =
    stage === "Cancelled"
      ? 0
      : stage === "Registered"
        ? 1
        : stage === "Awaiting payment" || stage === "Payment verification"
          ? 1
          : stage === "Paid"
            ? 2
            : stage === "Instructions sent"
              ? 3
              : stage === "In training"
                ? 4
                : stage === "Training complete"
                  ? 4
                  : 5;
  return (
    <ol className="stage-track">
      {steps.map((step, index) => (
        <li key={step} className={index < reached ? "done" : index === reached ? "current" : ""}>
          <span aria-hidden="true">{index < reached ? "✓" : index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}
