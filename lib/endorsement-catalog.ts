export const PARTNER_CENTERS = [
  "Nautical Options",
  "Fareast",
  "Altitude Maritime",
  "Great Seas",
  "United International",
] as const;

export type PartnerCenter = (typeof PARTNER_CENTERS)[number];

export type PartnerOffer = {
  id: string;
  sourceRow: number;
  sourceLabel: string;
  course: string;
  center: PartnerCenter;
  trainingFeeCentavos: number;
  duration: string;
  rebateCentavos: number;
  partnerPayableCentavos: number;
  active: boolean;
};

type RawOffer = readonly [course: string, feePesos: number, duration: string, rebatePesos: number, sourceLabel?: string];

const centerRows: Readonly<Record<PartnerCenter, readonly RawOffer[]>> = {
  "Nautical Options": [
    ["Basic Training", 5500, "10 days", 1300],
    ["Basic Training - Blended", 5500, "10 days", 1300],
    ["BTR - Basic Training Refresher", 3000, "2 days", 600],
    ["BT-PSSR", 1500, "1 day", 100, "BT PSSR"],
    ["SCRB", 3900, "5 days", 900],
    ["SCRB-R", 2600, "1 day", 600],
    ["AFF", 4200, "5.5 days", 1200],
    ["AFF-R", 2500, "2 days", 600],
    ["BTOC", 3200, "5.5 days", 700],
    ["BTLGT", 3500, "5.5 days", 700],
    ["ATOT", 4700, "8 days", 800],
    ["ATCT", 4700, "8 days", 800],
    ["OIC Deck", 4500, "2 days", 500],
    ["ML Deck", 14000, "2 days", 2000],
    ["D - Security Awareness Training and Seafarers with Designated Security Duties", 700, "1 day", 300, "- SECURITY AWARENESS TRAINING AND SEAFARERS WITH DESIGNATED"],
    ["SSO - Ship Security Officer", 2000, "4 days", 700],
    ["RFPNW - Ratings Forming Part of a Watch (Deck Watchkeeping)", 2600, "6 days", 500],
    ["MEFA - Medical First Aid", 1600, "6 days", 500],
  ],
  Fareast: [
    ["BT-PSSR", 1500, "1 day", 200, "BT PSSR"],
    ["SSO - Ship Security Officer", 2900, "4 days", 200],
    ["ATOT", 5300, "8 days", 300],
    ["ATCT", 5300, "8 days", 300],
    ["ATLGT", 5300, "8 days", 300],
    ["AFF - Face-to-face", 4200, "5 days", 100, "AFF - F2F"],
    ["AFF - Distance Learning", 4500, "5 days", 100],
    ["AFF-R", 3500, "2 days", 200],
    ["Basic Training", 6500, "11 days", 200],
    ["Basic Training - Blended", 6500, "11 days", 200],
    ["BTR - Basic Training Refresher", 3400, "3 days", 100],
    ["BTOCT", 4200, "6 days", 100],
    ["BTLGT", 3800, "5 days", 100],
    ["I - Passenger Safety, Cargo Safety, and Hull Integrity Training", 5700, "3 days", 200, "I - PASSENGER SAFETY , CARGO SAFETY, AND HULL INTEGRITY TRAIN"],
    ["CMHB - Passenger Ship Crisis Management", 2400, "3 days", 200],
    ["ETR", 190000, "42 days", 10000],
    ["GOC/GMDSS", 10500, "16 days", 200],
    ["MECA - Medical Care", 4400, "6 days", 200],
    ["MEFA - Medical First Aid", 3000, "5 days", 100],
    ["FRB", 4500, "4 days", 200],
    ["FRB-R", 3800, "2 days", 200],
    ["SCRB - Face-to-face", 3800, "5 days", 100, "SCRB - F2F / 5 D AYS"],
    ["SCRB - Distance Learning", 4500, "5 days", 100],
    ["SCRB-R", 3000, "1 day", 200],
    ["RFPNW - Ratings Forming Part of a Watch (Deck Watchkeeping)", 3300, "6 days", 100],
    ["RFPEW - Ratings Forming Part of a Watch (Engine Watchkeeping)", 3300, "6 days", 100],
  ],
  "Altitude Maritime": [
    ["Basic Training", 6000, "10 days", 1300],
    ["BTR - Basic Training Refresher", 2800, "2.5 days", 600],
    ["SCRB", 3600, "5 days", 500],
    ["SCRB-R", 2400, "1.5 days", 600, "SCRB-R / 1-5 DAYS"],
    ["AFF", 4200, "5 days", 600],
    ["AFF-R", 2500, "1.5 days", 600],
    ["BTOC", 3000, "6 days", 600],
    ["RFPNW - Ratings Forming Part of a Watch (Deck Watchkeeping)", 2500, "5.5 days", 600],
    ["RFPEW - Ratings Forming Part of a Watch (Engine Watchkeeping)", 2500, "5.5 days", 600],
    ["MECA - Medical Care", 3000, "6 days", 500],
    ["MEFA - Medical First Aid", 1500, "5.5 days", 300],
    ["D - Security Awareness Training and Seafarers with Designated Security Duties", 600, "4.5 days", 300, "- SECURITY AWARENESS TRAINING AND SEAFARERS WITH DESIGNATED"],
    ["SSO - Ship Security Officer", 1000, "3 days", 300],
    ["Safety - STPPDSPPS - Passenger Safety", 1200, "1 day", 300],
    ["Crowd - PSCMT - Passenger Ship Crowd Management", 1600, "2 days", 400],
    ["Crisis - PSCMHBT - Passenger Ship Crisis Management", 1600, "2.5 days", 400],
    ["BT-PSSR", 1000, "1 day", 300, "BT PSSR"],
    ["CCMD - Crowd and Crisis Management for Domestic", 2500, "3 days", 1500],
  ],
  "Great Seas": [
    ["BT-PSSR", 1300, "1 day", 300],
    ["Basic Training", 5500, "10 days", 1000],
    ["BTR - Basic Training Refresher", 2500, "2 days", 500],
    ["AFF-R", 2500, "2 days", 300, "AFFR"],
    ["AFF", 4000, "5 days", 500],
    ["II/4", 2000, "2 days", 300],
    ["III/4", 2000, "2 days", 300],
    ["II/5 - AB Deck", 5000, "2 days", 500],
    ["III/5 - AB Engine", 5000, "2 days", 500],
    ["OIC Deck", 5000, "2 days", 500],
    ["OIC Engine", 5000, "2 days", 500],
    ["ML Deck", 13000, "2 days", 2000],
    ["ML Engine", 13000, "2 days", 2000],
    ["AB Deck", 5500, "7 days", 300],
    ["AB Engine", 5800, "8 days", 300],
    ["MLC Deck (All Function)", 30000, "27 days", 1500],
    ["MLC Deck F1", 15000, "15 days", 750],
    ["MLC Deck F2", 6000, "4 days", 300],
    ["MLC Deck F3", 9000, "8 days", 450],
    ["MLC Engine (All Function)", 43000, "43 days", 2150],
    ["MLC Engine F1", 15000, "15.5 days", 750],
    ["MLC Engine F2", 10000, "10 days", 500],
    ["MLC Engine F3", 5000, "5 days", 250],
    ["MLC Engine F4", 13000, "12.5 days", 650],
  ],
  "United International": [
    ["Messman - NC I", 3500, "6 days", 1200, "MESSMAN - NC1"],
    ["Ship's Cook - NC III", 7500, "5 days", 1000, "SHIPS COOK - NCIII"],
    ["NC I - Assessment", 2000, "1 day", 939, "NCI - ASSESSMENT"],
    ["NC III - Assessment", 3500, "1 day", 1800],
    ["NC II - Assessment", 2000, "1 day", 1118],
    ["Housekeeping - NC II", 4500, "3 days", 1500],
    ["Cookery - NC II", 7500, "3 days", 2000],
    ["Bread & Pastry - NC II", 7500, "3 days", 2000],
    ["Food & Beverages - NC II", 4500, "3 days", 1500],
    ["Bartending - NC II", 7500, "3 days", 2000],
  ],
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const ENDORSEMENT_OFFERS: readonly PartnerOffer[] = Object.entries(centerRows).flatMap(
  ([center, rows], centerIndex) => rows.map(([course, fee, duration, rebate, sourceLabel], rowIndex) => ({
    id: `${slug(center)}-${String(rowIndex + 1).padStart(2, "0")}`,
    sourceRow: centerIndex * 100 + rowIndex + 1,
    sourceLabel: sourceLabel ?? course.toUpperCase(),
    course,
    center: center as PartnerCenter,
    trainingFeeCentavos: fee * 100,
    duration,
    rebateCentavos: rebate * 100,
    partnerPayableCentavos: (fee - rebate) * 100,
    active: true,
  })),
);

export const ENDORSEMENT_SUMMARY = PARTNER_CENTERS.map((center) => ({
  center,
  offers: ENDORSEMENT_OFFERS.filter((offer) => offer.center === center).length,
}));

export const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
}).format(centavos / 100);
