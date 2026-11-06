-- =====================================================================
-- Owner, 6 Nov 2026. RUN ONCE in the Supabase SQL Editor (run the whole file, nothing highlighted).
-- 1. Puts back each course's own certificate template: MARPOL 3-Day (24 Hours) and HACCP (8 Hours).
-- 2. Corrects 63 cut-off or garbled course names. Names only: no duration, price, batch or enrollment changes.
--    BRM-BTM, PSCMT, PSCMHBT, UBT-PSSR and CCMI keep their current names on purpose. Each change is audited.
-- =====================================================================

begin;

update public.certificate_templates t
   set active = (t.storage_path like '%MARPOL-3DAY---%')
 where t.course_id in (select id from public.courses where code = 'MARPOL');

update public.certificate_templates t
   set active = (t.storage_path like '%Hazard-Analysis-and-Critical-Control-Points%')
 where t.course_id in (select id from public.courses where code = 'HACCP');

with official(code, name) as (values
  ('AI/RA', 'Accident Investigation and Risk Assessment Course'),
  ('AIIRCA', 'Accident Investigation and Root Cause Analysis'),
  ('APA', 'Anti Piracy Awareness'),
  ('AIS', 'Automatic Identification System'),
  ('AMMS', 'Auxiliary Marine Machinery Systems'),
  ('ABC', 'Awareness on Basic Computer'),
  ('AHPR', 'Awareness on Harassment Prevention and Response'),
  ('BULKFAM', 'Bulk Carrier Familiarization and Safety'),
  ('BCAF', 'Bunkering Calculation and Familiarization'),
  ('CHSM', 'Catering Health and Safety Management'),
  ('CM', 'Catering Management'),
  ('CA', 'Collision Avoidance'),
  ('COLREG', 'Collision Regulations on Rules of the Road'),
  ('CCTC', 'Consumption Control Training Course'),
  ('HAZMAT', 'Dangerous, Hazardous and Harmful Cargoes (HAZMAT)'),
  ('EPS', 'Electro Pneumatic System'),
  ('FCM', 'Food and Catering Management'),
  ('FRAMO', 'FRAMO Pump'),
  ('HUPH', 'HACCP and United States Public Health'),
  ('HCIM', 'Hatch Cover Inspection and Maintenance'),
  ('HACCP', 'Hazard Analysis and Critical Control Points'),
  ('HAZMAT-CFR', 'HAZMAT with CFR'),
  ('HPT', 'Hydraulic and Pneumatic Training'),
  ('HSBAT', 'Hydrogen Sulfide Basic Awareness Training'),
  ('ISM', 'International Safety Management (ISM) Code'),
  ('IHM', 'Inventory of Hazardous Materials'),
  ('LMT', 'Leadership and Management Training'),
  ('LCBOCT', 'Liquid Cargo and Ballast Operations for Chemical Tankers'),
  ('LSC', 'Low Sulfur'),
  ('MLH', 'Marine Leadership and Human Behavior'),
  ('MOSHA', 'Marine Occupational Safety and Health Awareness'),
  ('MP', 'Marine Positioning'),
  ('MLA', 'Maritime Law Awareness'),
  ('MSC', 'Messman/Steward Course'),
  ('ORB', 'Oil Record Book'),
  ('ECDIS', 'Operational Use of Electronic Chart, Display and Information System'),
  ('OPESLOG', 'Orientation on Proper Entries on Ships'' Logbooks'),
  ('PEVF', 'Personal Effectiveness and Values Formation'),
  ('PSA', 'Personal Safety Awareness'),
  ('PADAMS', 'Prevention of Alcohol and Drug Abuse in the Maritime Sector'),
  ('PFRBC', 'Proficiency in Fast Rescue Boat Coxswain'),
  ('RNRPUA', 'Radar Navigation, Radar Plotting and Use of ARPA'),
  ('ROPA', 'Radar Observation and Plotting'),
  ('RADAROC', 'RADAR Operation Course'),
  ('RCSHM', 'Refresher Course on Ship Handling and Maneuvering'),
  ('RSDI', 'Rightship Inspection'),
  ('RAC', 'Risk Assessment Course'),
  ('RAIA', 'Risk Assessment, Incident Investigation and Analysis'),
  ('SFH', 'Safe Food Handling'),
  ('SNCA', 'Safe Navigation and Collision Avoidance'),
  ('SNC', 'Safe Navigation Course'),
  ('SMO', 'Safe Mooring Operations'),
  ('SARTA', 'SART Awareness'),
  ('SATSDSD', 'Security Awareness Training and Seafarer with Designated Security Duties'),
  ('SGS', 'Ship General Safety'),
  ('SHM', 'Ship Handling and Maneuvering'),
  ('SSO', 'Ship Security Officer'),
  ('SCCM', 'Shipboard Culinary and Catering Management'),
  ('SOPEP', 'Shipboard Oil Pollution Emergency Plan'),
  ('SVI', 'SIRE and Vetting Inspection'),
  ('VOC', 'Volatile Organic Compound'),
  ('VPCC', 'Voyage Planning and Chart Correction'),
  ('WH', 'Working at Heights')
), changed as (
  update public.courses c set name = o.name, updated_at = now()
  from official o
  where o.code = c.code and c.delivery_type = 'In-House' and c.name is distinct from o.name
  returning c.id, c.code, c.name
)
insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
select null, 'system', 'course.renamed_to_catalog', 'course', id::text, jsonb_build_object('code', code, 'name', name) from changed;

commit;

-- Check: MARPOL-3DAY and Hazard-Analysis are active, and the names below read correctly.
select 'Template' as item, c.code, t.version::text as version, t.storage_path as detail
  from public.certificate_templates t join public.courses c on c.id = t.course_id
 where c.code in ('MARPOL', 'HACCP') and t.active
union all
select 'Name', c.code, '', c.name from public.courses c
 where c.delivery_type = 'In-House' and c.code in ('APA', 'ISM', 'COLREG')
union all
select 'Soft Copy Email', e.template_code, e.version::text, e.subject from public.email_templates e
 where e.template_code = 'certificate.softcopy' and e.active
order by 1, 2;
