import type { ReactNode } from "react";

/**
 * New Wave Terms and Conditions, Revision No. 03 (owner, 5 Nov 2026). The back of the TAR and the website
 * form print this same text. Bold marks the amounts and deadlines; the wording is the owner's. A change
 * here also needs a new row in terms_documents, so each trainee's accepted version stays traceable.
 */
export const TERMS: { n: number; title: string; lines: ReactNode[] }[] = [
  { n: 1, title: "Payment Terms", lines: [
    <>Full payment or a minimum of <b>50% down payment</b> is required upon enrollment.</>,
    "Full payment must be settled before the completion of the training.",
    "Full payment is required for one (1) day courses of New Wave.",
  ] },
  { n: 2, title: "No Refund Policy", lines: [
    <><b>All fees paid are non-refundable</b> for reasons attributable to the trainee, including change of mind, incomplete requirements, failed assessment, absence, or late arrival.</>,
    "Fees already remitted to the training center are likewise non-refundable.",
  ] },
  { n: 3, title: "Rescheduling", lines: [
    <>Requests made at least <b>five (5) days</b> before the start of training are subject to a rescheduling fee of <b>₱350.00</b>.</>,
    <>Requests made less than <b>five (5) days</b> before the start of training are subject to a fee equivalent to <b>fifty percent (50%)</b> of the training fee, plus a processing fee of <b>₱250.00</b>.</>,
    "Trainees who are unable to attend their scheduled training session for courses with a duration of one (1) to two (2) days may request to have their training rescheduled.",
    "Trainees may request to reschedule their training schedule subject to slot availability and approval of the Training Center.",
  ] },
  { n: 4, title: "Cancellation", lines: [
    <>Cancellations requested at least <b>six (6) days</b> before the start of training are subject to a cancellation charge of <b>₱350.00</b>.</>,
    <>For requests made less than <b>six (6) days</b> before training, the payment may only be transferred to another New Wave course for the same trainee, to be used within <b>twelve (12) months</b>; any price difference shall be paid by the trainee.</>,
    "Payments are non-transferable to another person.",
  ] },
  { n: 5, title: "Training in Progress", lines: [
    <><b>No rescheduling or cancellation</b> shall be allowed once training has started, and all fees paid shall be forfeited.</>,
  ] },
  { n: 6, title: "Partial Payments", lines: [
    <>Trainees with partial payments must settle their remaining balance in full on or before the <b>second (2nd) day</b> of training, particularly for STCW/MARINA-mandated courses.</>,
  ] },
  { n: 7, title: "Make-Up Class Policy", lines: [
    <>Make-up classes are available only for training courses with a duration of <b>three (3) days or more</b> and subject to schedule availability and approval of the Training Center.</>,
    "Trainees who are unable to attend a scheduled training session due to valid reasons must immediately inform the Training Center.",
    <>A make-up class fee of <b>₱350.00</b> per training day shall be charged.</>,
  ] },
  { n: 8, title: "Issuance of Certificate of Completion", lines: [
    "Certificates of Completion shall be issued only to trainees who have successfully completed all course requirements and settled all outstanding balances.",
  ] },
];

export const TERMS_AMEND_NOTICE = "New Wave Maritime Training and Assessment Center, Inc. reserves the right to amend, revise, or update the details stated above without prior notice.";
