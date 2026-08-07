export type InHouseCourse = {
  id: string;
  category: "Accredited MARINA STCW" | "MARINA Domestic" | "Maritime In-House" | "Catering (ILO / MLC 2006)";
  code: string;
  course: string;
  duration: string;
  modality: string;
  priceCentavos: number;
};

const raw = `
#Accredited MARINA STCW
SATSDSD|Security Awareness Training and Seafarer with Designated Security Duties|1 day|Face-to-face|60000
SSO|Ship Security Officer|3 days|Face-to-face|200000
STPPDSPPS|Safety Training for Personnel Providing Direct Service to Passengers in Passenger Spaces|1 day|Face-to-face|120000
PSCMT|Crowd Management Training|2 days|Face-to-face|160000
PSCMHBT|Passenger Ship Crisis Management and Human Behavior Training|3 days|Face-to-face|160000
UBT-PSSR|Updating Training on Basic Training - PSSR|1 day|Face-to-face|130000
CCMI|Safety, Crowd and Crisis Package|5.5 days|Face-to-face|420000
#MARINA Domestic
CCMD|Crowd and Crisis Management - Domestic|3 days|Blended|250000
#Maritime In-House
ABC|Awareness on Basic Computer|1 day|Online|90000
AHPR|Awareness on Harassment Prevention and Response|2 days|Online|150000
APA|Anti Piracy Awareness|1 day|Online|60000
AI|Accident Investigation|1 day|Online|90000
AI/RA|Accident Investigation and Risk Assessment Course|3 days|Online|150000
AIS|Automatic Identification System|1 day|Online|200000
AIIRCA|Accident Investigation and Root Cause Analysis|1 day|Online|250000
AMMS|Auxiliary Marine Machinery Systems|1 day|Online|150000
ARPA|Automatic Radar Plotting Aids|5 days|Online|400000
BAC|Basic Arabic Culture|1 day|Online|200000
BNC|Basic Networking Course|1 day|Online|150000
BMT|Banksman Training|2 days|Online|200000
BBSC|Behavioral Based Safety Course|2 days|Online|250000
BRM|Bridge Resources Management|3 days|Online|200000
BRM-BTM|BRM with BTM|5 days|Online|500000
RBTMBRM|Refresher for BRM and BTM|3 days|Online|300000
BS|Banksman and Slinging|2 days|Online|200000
BTM|Bridge Team Management|2 days|Online|300000
BULKFAM|Bulk Carrier Familiarization and Safety|2 days|Online|500000
BCAF|Bunkering Calculation and Familiarization|3 days|Online|300000
CA|Collision Avoidance|2 days|Online|150000
CE|Control Engineering|1 day|Online|150000
CFC|Classification Familiarization Course|2 days|Online|250000
CHCC|Cargo Handling and Care of Cargo|5 days|To be confirmed|450000
CSA|Cyber Security Awareness|1 day|Online|250000
CSF|Container Ship Familiarization|To be confirmed|Online|100000
CST|Crane Safety Training|1 day|Online|150000
COC|Crane Operation Course|2 days|Online|150000
COW|Crude Oil Washing System|1 day|Online|150000
DCST|Deck Crane Safety Training|2 days|Online|150000
DMA|Deck Machinery Awareness|1 day|Online|200000
ECDIS|Operational Use of Electronic Chart, Display and Information System|5 days|Online|300000
EPS|Electro Pneumatic System|1 day|Online|180000
ESE|Enclosed Space Entry|1 day|Online|250000
EMS|Environmental Management System|1 day|Online|100000
ERTM|Engine Room Team Management|3 days|Online|300000
ERRM|Engine Room Resource Management|2 days|Online|200000
FRAMO|FRAMO Pump|3 days|Online|300000
HAZMAT|Dangerous, Hazardous and Harmful Cargoes (HAZMAT)|4 days|Online|100000
HAZMAT-CFR|HAZMAT with CFR|2 days|Online|100000
HAZID|Hazard Identification|1 day|Online|350000
HVT|High Voltage Training|2 days|Online|150000
HPT|Hydraulic and Pneumatic Training|1 day|Online|150000
H2S|Hydrogen Sulfide Awareness|1 day|Online|200000
HSBAT|Hydrogen Sulfide Basic Awareness Training|2 days|Online|250000
INCI|Incident Investigation|1 day|Online|90000
IHM|Inventory of Hazardous Materials|1 day|Online|350000
ISM|FRAMO Pump|1 day|Online|70000
IP|Injury Prevention|1 day|Online|70000
LCBOCT|Liquid Cargo and Ballast Operations for Chemical Tankers|1 day|Online|100000
LMT|Leadership and Management Training|1 day|Online|150000
LSC|Low Sulfur|1 day|Online|250000
LSHB|Leadership and Human Behavior|1 day|Online|150000
LT|Leadership and Teamwork|1 day|Online|180000
MAEN|Maritime English|1 day|Online|90000
MEA|Marine Environmental Awareness|1 day|Online|150000
MARPOL|Consolidated MARPOL Annex I-VI|3 days|Online|110000
MEFAR|Medical First Aid - Refresher|1 day|Online|150000
MECAR|Medical Care - Refresher|2 days|Online|250000
MHA|Mental Health Awareness|2 days|Online|150000
MOSHA|Marine Occupational Safety and Health Awareness|1 day|Online|100000
MLA|Maritime Law Awareness|1 day|Online|150000
MLSO|Maritime Law for Ship Officers|1 day|Online|150000
MLH|Marine Leadership and Human Behavior|1 day|Online|150000
MP|Marine Positioning|2 days|Online|300000
OPA|Oil Pollution Act|2 days|Online|150000
OPESLOG|Orientation on Proper Entries on Ships' Logbooks|1 day|Online|90000
ORB|Oil Record Book|1 day|Online|350000
PAMA|Paint Maintenance|1 day|Online|100000
PADAMS|Prevention of Alcohol and Drug Abuse in the Maritime Sector|2 days|Online|70000
PDS|Practical Deck Skill|2 days|Online|200000
PP|Passage Planning|2 days|Online|250000
PEVF|Personal Effectiveness and Values Formation|2 days|Online|160000
PSA|Personal Safety Awareness|1 day|Online|150000
PSC|Port State Control|2 days|Online|90000
PPE|Personal Protective Equipment|1 day|Online|100000
PAP|Preparation of Arrival in Port|2 days|Online|150000
RNRPUA|Radar Navigation, Radar Plotting and Use of ARPA|5 days|Online|400000
RADAROC|RADAR Operation Course|3 days|Online|250000
RAM|Risk Assessment and Management|1 day|Online|100000
RAC|Risk Assessment Course|1 day|Online|90000
RAIA|Risk Assessment, Incident Investigation and Analysis|3 days|Online|250000
RSDI|Rightship Inspection|2 days|Online|400000
RCSHM|Refresher Course on Ship Handling and Maneuvering|3 days|Online|200000
ROPA|Radar Observation and Plotting|2 days|Online|150000
SAM|Stress and Anger Management|2 days|Online|200000
SARTA|SART Awareness|1 day|Online|200000
SMC|Stress Management Course|1 day|Online|200000
SMO|Safe Mooring Operations|1 day|Online|250000
SNCA|Safe Navigation and Collision Avoidance|3 days|Online|200000
SNC|Safe Navigation Course|4 days|Online|150000
SNT|Safe Navigation Training|4 days|Online|150000
SSOR|Ship's Security Officer - Refresher|2 days|Online|100000
SOC|Safety Officer Course|1 day|Online|100000
SSOC|Shipboard Safety Officer Course|1 day|Online|100000
SOTC|Security Officer Training Course|3 days|Online|150000
SOPEP|Shipboard Oil Pollution Emergency Plan|3 days|Online|150000
SGS|Ship General Safety|3 days|Online|150000
SHM|Ship Handling and Maneuvering|5 days|Online|450000
SDC|Smoke Diving Course|1 day|Online|200000
SVI|SIRE and Vetting Inspection|2 days|Online|200000
TANKFAM|Tanker Familiarization and Safety|2 days|Online|500000
TAS|Trim and Stability|3 days|Online|500000
TI|Tank Inspection|1 day|Online|100000
MRC|Media Response Course|1 day|Online|300000
HCIM|Hatch Cover Inspection and Maintenance|3 days|Online|500000
PFRBC|Proficiency in Fast Rescue Boat Coxswain|3 days|Online|300000
COLREG|Collision Regulations on Rules of the Road|3 days|Online|350000
VOC|Volatile Organic Compound|1 day|Online|400000
VRM|Vessel Resource Management|5 days|Online|500000
VP|Voyage Planning|2 days|Online|350000
VPCC|Voyage Planning and Chart Correction|2 days|Online|350000
WH|Working at Heights|2 days|Online|200000
#Catering (ILO / MLC 2006)
BAC-CAT|Basic Arabic Course|2 days|Online|150000
BFH|Basic Food Hygiene|2 days|Online|180000
BNHACCP|Basic Nutrition with HACCP|2 days|Online|180000
BSFM|Basic Shipboard Food Management|5 days|Online|350000
CHSM|Catering Health and Safety Management|2 days|Online|180000
CM|Catering Management|5 days|Online|350000
CCTC|Consumption Control Training Course|3 days|Online|285000
FCM|Food and Catering Management|5 days|Online|350000
FH|Food Hygiene|2 days|Online|180000
FH-HACCP|Food Hygiene with HACCP|2 days|Online|180000
FHS|Food Hygiene and Sanitation|2 days|Online|180000
FSH|Food Safety and Hygiene|2 days|To be confirmed|180000
FST|Food Safety Training|2 days|Online|180000
GAC|Galley Awareness Course|2 days|Online|180000
GAH|Galley Affairs and Housekeeping|2 days|Online|180000
GHFS|Galley Hygiene and Food Sanitation|2 days|Online|180000
GHH|Galley Hygiene with HACCP|2 days|Online|180000
GHC|Good Housekeeping Course|2 days|Online|180000
GPM|Galley (Provision) Management|2 days|Online|180000
HACCP|Hazard Analysis and Critical Control Points|1 day|Online|180000
HUPH|HACCP and United States Public Health|2 days|Online|180000
MSC|Messman/Steward Course|2 days|Online|150000
PHS|Public Health and Sanitation|2 days|Online|180000
SC|Shipboard Culinary|3 days|Online|350000
SCCM|Shipboard Culinary and Catering Management|5 days|Online|350000
SFH|Safe Food Handling|2 days|Online|180000
SV|Shipboard Victualling|2 days|Online|250000
`;

let category: InHouseCourse["category"] = "Maritime In-House";
export const IN_HOUSE_COURSES: readonly InHouseCourse[] = raw.trim().split("\n").flatMap((line, index) => {
  if (line.startsWith("#")) {
    category = line.slice(1) as InHouseCourse["category"];
    return [];
  }
  const [code, course, duration, modality, price] = line.split("|");
  return [{ id: `nwm-${String(index + 1).padStart(3, "0")}`, category, code, course, duration, modality, priceCentavos: Number(price) }];
});

export const IN_HOUSE_CATEGORIES = ["All New Wave categories", "Accredited MARINA STCW", "MARINA Domestic", "Maritime In-House", "Catering (ILO / MLC 2006)"] as const;
