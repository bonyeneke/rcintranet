# Deploying on GoDaddy

Upload this ZIP under **Node.js Hosting**, using its ZIP upload workflow. The cPanel File Manager alone only stores or extracts files.

In the Node.js app settings, configure these environment variables before starting or redeploying the service:

- `APP_URL` — the exact HTTPS origin assigned to the app, with no trailing slash.
- `HOST` — `0.0.0.0` for managed Node.js Hosting.
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — an existing MySQL database and a user permitted to connect from the app runtime. Use `DB_TLS=true` if the database requires TLS with a trusted certificate.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` — your SMTP settings for invitations and reminders.

GoDaddy supplies the app port. Keep actual credentials out of the archive and public folders.

Run `npm ci --omit=dev`, `npm run migrate` and `npm run admin -- YOUR_WORK_EMAIL` from a terminal that can reach the same database. Use the same app origin and database settings in that terminal. If the managed app lacks a shell, use an authorised machine with access to the database. If there is no such access, confirm a supported database or hosting arrangement with GoDaddy before proceeding. The app expects its database schema before startup.

Use the URL printed by the admin command privately to set your password. Confirm `/health` returns HTTP 200 and follow the staging checks in README.md.

[GoDaddy ZIP deployment guide](https://www.godaddy.com/en-uk/help/upload-my-ai-generated-app-to-nodejs-hosting-42987)
