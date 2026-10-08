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
 *
 * Google allows only 20 triggers per script, so instead of one trigger per form a single
 * trigger checks every form whose title contains "EVALUATION" every 5 minutes and sends
 * the new submissions. New evaluation forms are picked up automatically.
 * Only the fact that the trainee submitted (and who) is sent; the answers stay in Google Forms.
 * The portal works out the course from the form's title (e.g. "... - HPT-Hydraulic ...").
 */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkEvaluations').timeBased().everyMinutes(5).create();
  var props = PropertiesService.getScriptProperties();
  var now = new Date().toISOString();
  var forms = evaluationForms();
  forms.forEach(function (form) {
    try { form.setCollectEmail(true); } catch (err) { console.log('Email setting not changed for ' + form.getTitle() + ': ' + err); }
    // Start from now: earlier submissions are not sent.
    if (!props.getProperty('since_' + form.getId())) props.setProperty('since_' + form.getId(), now);
  });
  console.log('Watching ' + forms.length + ' evaluation forms every 5 minutes:\n' + forms.map(function (f) { return f.getTitle(); }).join('\n'));
}

function evaluationForms() {
  var files = DriveApp.searchFiles('mimeType = "application/vnd.google-apps.form" and title contains "EVALUATION" and trashed = false');
  var forms = [];
  while (files.hasNext()) {
    try { forms.push(FormApp.openById(files.next().getId())); } catch (err) { console.log(err); }
  }
  return forms;
}

function checkEvaluations() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().toISOString();
  evaluationForms().forEach(function (form) {
    var key = 'since_' + form.getId();
    var since = props.getProperty(key);
    if (!since) { props.setProperty(key, now); return; } // a new form: start from now
    var latest = since;
    form.getResponses(new Date(since)).forEach(function (response) {
      var ts = response.getTimestamp().toISOString();
      if (ts <= since) return;
      if (send(form, response)) { if (ts > latest) latest = ts; }
    });
    props.setProperty(key, latest);
  });
}

function send(form, response) {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('PORTAL_URL') || '').replace(/\/$/, '') + '/api/public/evaluation';
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
  var code = result.getResponseCode();
  console.log(form.getTitle() + ' → ' + code + ' ' + result.getContentText());
  // 2xx and "not found" (no matching trainee) are final; anything else is retried next run.
  return code < 300 || code === 404 || code === 400;
}
