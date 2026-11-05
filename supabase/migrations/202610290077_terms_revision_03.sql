-- Terms and Conditions Revision No. 03 (owner, 5 Nov 2026). Safe to re-run.
-- * Training Instructions: the seven new policy lines, only where the Admin has not edited the old text.
-- * terms_documents: new applicants are recorded as accepting this version. Earlier rows stay, so each
--   trainee's accepted version stays traceable. /api/public/registrations picks the newest active row.

update public.instruction_category_templates
set policies = E'Payment: Full payment for 1-day courses; 50% down payment otherwise.\nPartial Payments: Settle in full by the 2nd day of training, particularly for STCW/MARINA courses.\nNo Refund: Fees paid are non-refundable for reasons attributable to the trainee.\nReschedule: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCancellation: 6+ days before: Php 350.00. Under 6 days: transfer to another New Wave course only, within 12 months.\nTraining in Progress: No rescheduling or cancellation; all fees paid are forfeited.\nCertificate: Released after all requirements and balances are complete.',
    updated_at = now()
where policies = E'Payment: Full payment for 1-day courses; 50% down payment otherwise.\nReschedule: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCancellation: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCertificate: Released after all requirements and balances are complete.';

insert into public.terms_documents(version, title, public_asset_path, effective_from, active)
values ('2026-11-05-r03', 'New Wave Maritime Terms and Conditions', '/document-templates/terms-and-conditions-r03.png', '2026-11-05', true)
on conflict (version) do nothing;

select
  (select count(*) from public.instruction_category_templates where policies like '%Training in Progress:%') as templates_with_new_lines,
  (select count(*) from public.instruction_category_templates where policies like '%Cancellation: 5+ days%') as templates_with_old_lines,
  exists (select 1 from public.terms_documents where version = '2026-11-05-r03' and active) as new_terms_version_active;
