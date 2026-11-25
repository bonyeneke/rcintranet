# Relationship Checks

Self-hosted edition of the Grant Thornton Nigeria Relationship Checks interface. It runs as a Node.js application with shared MySQL storage. The archive starts with an empty workspace and basic service reference data.

## Requirements

- Node.js 22.13 or newer and npm
- MySQL 8 with an InnoDB database and a database user for this application
- A dedicated HTTPS subdomain at the domain root
- An authorised SMTP relay for account setup messages and reminders
- A server scheduler such as cron for reminders

## Deploy

1. Extract the ZIP into a private application directory. Serve the site through Node. Keep the application directory and its configuration outside any public document root.
2. Create a dedicated MySQL database and grant the app user access to it. On cPanel, use the actual database and username shown in the panel, including any account prefix.
3. Copy `.env.example` to `.env`. Set `APP_URL` to your exact HTTPS origin without a trailing slash. Enter database and SMTP settings. Keep `.env` readable only by the application account and its administrator. For a local smoke test, retain the loopback HTTP origin and use the matching address in your browser.
4. Run from the extracted folder:

   ```sh
   npm ci --omit=dev
   npm run migrate
   npm test
   npm run admin -- admin@example.com
   ```

   Replace the example address with your work email. The last command prints a private one-time URL valid for one hour. Open it to set the initial password. If it expires, run `node --env-file-if-exists=.env cli.js admin-setup admin@example.com` to issue another. Keep the URL out of tickets and shared logs.

5. On a Linux server, run `npm start` as the application account under a process manager and reverse proxy the HTTPS subdomain to the configured loopback port. Enable `TRUST_PROXY_LOOPBACK` only when the local proxy replaces forwarded client IP headers. On cPanel, register the directory in **Application Manager** or your provider's **Setup Node.js App**. Select Node 22 or newer and `app.js` as the startup file if the panel asks. Use the root path of the dedicated subdomain. Use the Node executable and app environment selected by the hosting panel when running migration, bootstrap and cron commands. See [cPanel Node.js deployment](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/).
6. Open the subdomain and sign in. Verify `/health` returns HTTP 200, then create a test staff account under **Staff administration**. Assign DRC and IRC roles separately and use **Send setup link** on the staff profile after SMTP is configured. Staff can also request a link from the sign-in page.

## Daily reminders

Run a dry run first. This reports the number of eligible recipients and sends no messages.

```sh
npm run reminders -- --dry-run
```

Once verified with staging mail, add a daily cron job. Example for a server whose cron uses UTC. This runs at 08:00 Lagos time. Substitute your actual application path and the absolute path to the Node executable.

```cron
0 7 * * * cd /path/to/relationship-checks && /path/to/node --env-file-if-exists=.env cli.js reminders >> /path/to/private/reminders.log 2>&1
```

The job includes open, assigned checks that the eligible recipient has yet to answer. It reserves at most one digest per staff member per Lagos calendar day. Failed or interrupted sends are recorded in the database and reported in job output when the run can finish. They are not retried automatically on the same day because the mail server could already have accepted a message. Review cron output and SMTP logs after enabling.

## Staging acceptance

- Create one client and start both a DRC and an IRC for it.
- Sign in separately as an eligible respondent and a check lead. Verify that each user sees their assigned workflow and cannot administer the other module unless their role permits it.
- Submit responses, close a check, and open its report. Reports use browser print or Save as PDF and generic signatory labels.
- Disable a test account and verify an existing session and fresh login both lose access.
- Verify setup emails and a single reminder run using your staging mail relay.
- Back up the MySQL database and verify a restore. The application stores the workspace in a transactional JSON record with optimistic version checks. Database backups contain staff, check and authentication data and should be kept private.

The included automated tests exercise the HTTP app with an isolated repository and simulated SMTP. Validate the MySQL connection, migration and SMTP delivery on your staging server. The archive begins with a fresh database. Historical production data and browser demo records require a separate, reviewed migration.
