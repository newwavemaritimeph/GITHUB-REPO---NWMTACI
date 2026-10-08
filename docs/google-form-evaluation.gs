/**
 * New Wave portal — Google Forms evaluation notice.
 *
 * Paste this once into each course's evaluation form:
 *   1. In the form: Settings › Responses › turn on "Collect email addresses"
 *      (or add a short-answer question titled "NWMTACI number").
 *   2. Form menu (⋮) › Script editor. Replace everything with this file.
 *   3. Project settings (gear) › Script properties › Add:
 *        PORTAL_URL   = https://newwavemaritimemtaci.com
 *        PORTAL_SECRET = (the same value as EVALUATION_WEBHOOK_SECRET in Vercel)
 *   4. Triggers (clock) › Add trigger › function onFormSubmit · From form · On form submit › Save,
 *      then allow the permissions Google asks for.
 *   5. In the portal: Releasing Officer › Templates › paste this form's link for the course.
 *
 * Only the fact that the trainee submitted (and who) is sent; the answers stay in Google Forms.
 */
function onFormSubmit(e) {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('PORTAL_URL') || '').replace(/\/$/, '') + '/api/public/evaluation';
  var response = e.response;
  var nwmtaci = '';
  response.getItemResponses().forEach(function (r) {
    if (/nwmtaci/i.test(r.getItem().getTitle())) nwmtaci = String(r.getResponse() || '').trim();
  });
  var payload = {
    formId: FormApp.getActiveForm().getId(),
    responseId: response.getId(),
    email: response.getRespondentEmail() || '',
    nwmtaciNo: nwmtaci,
    submittedAt: response.getTimestamp().toISOString()
  };
  var result = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-evaluation-secret': props.getProperty('PORTAL_SECRET') || '' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  console.log(result.getResponseCode() + ' ' + result.getContentText());
}
