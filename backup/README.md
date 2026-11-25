# Backups

Copies the live Turso database into an encrypted file on this computer, then test-restores it to prove it works.

**Why:** Turso's free plan can only go back 1 day (checked November 2026).

## Set up (once)

1. In Turso, open your database and create a token with **read-only** access. Copy it, and the database URL (`libsql://...`).
2. In a terminal in this folder:

   ```powershell
   node backup/backup.js setup
   ```

   Paste the URL, then the token (it stays hidden). Never paste the token into a chat or a project file.
3. It shows a **backup passphrase**. Write it down somewhere that is not this computer. Without it nobody can open a backup, including you.

## Make a backup (about once a week)

Double-click **Back up The Bench.cmd**, or:

```powershell
node backup/backup.js
```

- Files go to `TheBenchBackups` in your user folder, not in this project.
- Copies over 90 days old are removed. If the member count suddenly drops, nothing is removed and you get a warning.
- The computer can still be lost, so copy a file to a USB stick or Google Drive now and then. They are encrypted.

## Check the newest backup

```powershell
node backup/backup.js check
```

## If the database is lost

1. In Turso, create a **new, empty** database and a token that can read and write.
2. Restore into it (it refuses a database that has anything in it):

   ```powershell
   node backup/backup.js restore the-bench-YYYY-MM-DD-HHMMSS.benchbackup turso
   ```
3. In Render, change `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the new database.

Everyone has to log in again; passwords stay the same.

**Remember:** a backup is the past. Anything added since is missing, and **accounts deleted since will be back**. Delete those again, because those people asked to be removed.
