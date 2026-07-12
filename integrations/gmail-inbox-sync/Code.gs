/**
 * Slate — Gmail → To-Do Inbox sync
 *
 * Watches Gmail for new mail from WATCH_SENDER and creates one task per
 * message in Slate's Inbox section (slate_users/{uid}/tasks in the
 * `pickledgerpro` Firebase project). Runs as a time-driven Apps Script
 * trigger in the Google account that owns the Firebase project.
 *
 * Idempotent by design: the task's document id is derived from the Gmail
 * message id and the write is create-only, so a message is never synced
 * twice — and completing or deleting the task in Slate never brings it back.
 */

const WATCH_SENDER = 'ioerger@tamu.edu';
const TITLE_PREFIX = 'Ioerger: ';
const FIREBASE_PROJECT_ID = 'pickledgerpro';
const SLATE_UID = 'PASTE_YOUR_FIREBASE_AUTH_UID_HERE'; // Firebase console -> Authentication -> Users
const INBOX_SECTION_ID = 'starter-inbox'; // Slate's built-in Inbox section
const SEARCH_WINDOW = 'newer_than:3d'; // how far back each run looks
const ADD_DUE_TODAY = true; // also surfaces the task in Schedule's "Due today" panel

function syncWatchedSenderToSlate() {
  const threads = GmailApp.search('from:' + WATCH_SENDER + ' ' + SEARCH_WINDOW);
  let created = 0;
  let alreadySynced = 0;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      // Threads can contain your own replies; only sync the watched sender's.
      if (extractAddress_(message.getFrom()) !== WATCH_SENDER.toLowerCase()) return;
      if (createTask_(message) === 'created') created += 1;
      else alreadySynced += 1;
    });
  });

  Logger.log('Slate sync: %s created, %s already synced.', created, alreadySynced);
}

function extractAddress_(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim().toLowerCase();
}

function createTask_(message) {
  const docId = 'gmail-' + message.getId();
  const nowIso = new Date().toISOString();
  const subject = message.getSubject() || '(no subject)';
  const preview = message.getPlainBody().replace(/\s+/g, ' ').trim().slice(0, 400);
  const link = 'https://mail.google.com/mail/u/0/#all/' + message.getId();

  const fields = {
    id: { stringValue: docId },
    sectionId: { stringValue: INBOX_SECTION_ID },
    title: { stringValue: TITLE_PREFIX + subject },
    notes: {
      stringValue: 'From: ' + message.getFrom()
        + '\nReceived: ' + message.getDate()
        + '\n\n' + preview
        + '\n\n' + link,
    },
    done: { booleanValue: false },
    order: { doubleValue: message.getDate().getTime() }, // chronological, below hand-added tasks
    createdAt: { stringValue: nowIso },
    updatedAt: { stringValue: nowIso },
  };
  if (ADD_DUE_TODAY) {
    fields.due = {
      stringValue: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    };
  }

  const url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
    + '/databases/(default)/documents/slate_users/' + SLATE_UID
    + '/tasks?documentId=' + encodeURIComponent(docId);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ fields: fields }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code === 200) return 'created';
  if (code === 409) return 'exists'; // already synced on an earlier run
  throw new Error('Firestore write failed (' + code + '): ' + response.getContentText());
}
