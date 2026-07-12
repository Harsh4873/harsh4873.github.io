# Gmail → Slate Inbox sync

Creates a task in Slate's **Inbox** section whenever a watched sender
(`ioerger@tamu.edu`) emails you. Runs as a free Google Apps Script on a
timer inside your own Google account — no servers, no third parties.

## How it works

- Every few minutes the script searches Gmail for recent mail from the
  watched sender.
- Each new message becomes one Firestore document in
  `slate_users/{uid}/tasks` with a deterministic id (`gmail-<messageId>`)
  and a **create-only** write, so nothing ever syncs twice — and checking
  off or deleting the task in Slate never resurrects it.
- The task title is the email subject, the notes hold a 400-character
  preview plus a deep link back to the message in Gmail, and (optionally)
  the task is due **today**, which also surfaces it in the Schedule tab's
  "Due today" panel.
- Slate picks the task up through its normal sync listeners — it appears
  on every signed-in device within seconds.

Authorization: the script calls the Firestore REST API with your own
Google OAuth token. Because your Google account **owns** the
`pickledgerpro` Firebase project, IAM grants the write — the app's
security rules stay locked down for everyone else.

## Setup (one time, ~5 minutes)

1. **Get your Slate UID.** [Firebase console](https://console.firebase.google.com)
   → project `pickledgerpro` → **Authentication → Users** → copy the
   **User UID** for `hdav4873@gmail.com`.
2. **Create the script.** Go to [script.google.com](https://script.google.com)
   **while signed in as `hdav4873@gmail.com`** → New project → paste
   `Code.gs` over the default file. Then Project Settings → check
   *"Show appsscript.json manifest file"* → paste `appsscript.json` over it.
3. **Fill in the UID** in the `SLATE_UID` constant and save.
4. **Authorize.** Select `syncWatchedSenderToSlate` in the toolbar and hit
   **Run** once; approve the Gmail + Google Cloud permissions it asks for.
5. **Add the timer.** Left sidebar → Triggers → **Add trigger** →
   `syncWatchedSenderToSlate`, event source *Time-driven*, every
   **5 minutes** (or 10 — email cadence hardly needs less).

## Getting the TAMU mail into Gmail

The professor writes to `hdav3228@tamu.edu`, but the script watches the
Gmail account that owns the Firebase project. Pick one:

- **Option A (recommended): forward the sender.** In the TAMU mailbox
  (it's Google Workspace), Settings → *Forwarding and POP/IMAP* → add
  `hdav4873@gmail.com` as a forwarding address (verify the code), then
  create a filter: `from:ioerger@tamu.edu` → *Forward to
  hdav4873@gmail.com*. Only his mail gets forwarded.
- **Option B: run the script in the TAMU account instead.** If A&M blocks
  forwarding, create the Apps Script while signed in as
  `hdav3228@tamu.edu`, and grant that account write access to the project:
  [console.cloud.google.com](https://console.cloud.google.com) → project
  `pickledgerpro` → IAM → **Grant access** → principal
  `hdav3228@tamu.edu`, role **Cloud Datastore User**. (Workspace policy
  can also block Apps Script external requests; if it does, use Option A.)

## Tweaks

- Watch someone else / several people: change `WATCH_SENDER` (duplicate
  the search line for more senders).
- Don't want the tasks due today: set `ADD_DUE_TODAY = false`.
- Tasks land in the built-in **Inbox** section (`starter-inbox`). If you
  ever delete that section, either point `INBOX_SECTION_ID` at another
  section's id or the tasks will surface under "Recovered tasks".
