/**
 * New Wave portal — evaluation forms notice (one script for every form).
 *
 * Set up once, in New Wave's Google account (the one that owns the forms):
 *   1. Go to https://script.google.com › New project. Name it "New Wave evaluation notice".
 *   2. Replace everything in Code.gs with this file and save.
 *   3. Project settings (gear) › Script properties › Add two properties:
 *        PORTAL_URL    = https://newwavemaritimemtaci.com
 *        PORTAL_SECRET = (the same text as EVALUATION_WEBHOOK_SECRET in Vercel)
 *   4. Choose the function "setup" at the top and press Run. Allow the permissions Google asks for.
 *      It connects every form whose title contains "EVALUATION" and turns on "Collect email addresses".
 *   5. When you add a new evaluation form later, press Run on "setup" again.
 *
 * Only the fact that the trainee submitted (and who) is sent; the answers stay in Google Forms.
 * The portal works out the course from the form's title (e.g. "... - HPT-Hydraulic ...").
 */
function setup() {
  var existing = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEvaluationSubmit') existing[t.getTriggerSourceId()] = true;
  });
  var files = DriveApp.searchFiles('mimeType = "application/vnd.google-apps.form" and title contains "EVALUATION" and trashed = false');
  var connected = [];
  while (files.hasNext()) {
    var file = files.next();
    var form = FormApp.openById(file.getId());
    try { form.setCollectEmail(true); } catch (err) { console.log('Email setting not changed for ' + file.getName() + ': ' + err); }
    if (!existing[file.getId()]) ScriptApp.newTrigger('onEvaluationSubmit').forForm(form).onFormSubmit().create();
    connected.push(file.getName());
  }
  console.log('Connected ' + connected.length + ' evaluation forms:\n' + connected.join('\n'));
}

function onEvaluationSubmit(e) {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('PORTAL_URL') || '').replace(/\/$/, '') + '/api/public/evaluation';
  var form = e.source;
  var response = e.response;
  var nwmtaci = '';
  response.getItemResponses().forEach(function (r) {
    if (/nwmtaci/i.test(r.getItem().getTitle())) nwmtaci = String(r.getResponse() || '').trim();
  });
  var payload = {
    formId: form.getId(),
    formTitle: form.getTitle(),
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
