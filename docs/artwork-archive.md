# Artwork Archive collection

Artwork Archive is collected from a normal browser session because its listing flow is not suitable for the scheduled GitHub runner.

## Collect an export

Open the Artwork Archive call-for-entry page in Vivaldi, then use either method:

1. In DevTools (`F12`), create a reusable **Sources > Snippets** snippet containing `tools/artwork-archive-collector.js`, then run it with `Ctrl+Enter`.
2. Run `tools/Copy Artwork Archive Collector Bookmarklet.cmd`, create a bookmark, and paste the copied value into its URL field. Click the bookmark from the call-for-entry page.

The collector follows each detail page, keeps its URL as `source_url`, uses the external **Learn More** destination as the public link, and downloads `nova-artwork-archive-YYYY-MM-DD.json`. Entries without an external destination are reported and skipped.

## Review and sync

The sync command automatically selects the newest matching export in Downloads, including duplicate filenames such as `(1)`:

```text
npm run sync-opportunities -- --source artwork_archive --dry-run
npm run sync-opportunities -- --source artwork_archive
```

To choose a file explicitly:

```text
npm run sync-opportunities -- --source artwork_archive --artwork-archive-export "C:\path\to\export.json"
```

For the Windows launcher, set `GOOGLE_SERVICE_ACCOUNT_JSON` as a user environment variable, then run `tools/Import Latest Artwork Archive.cmd`. The PowerShell script also accepts `-ExportPath`, `-KeyPath`, and `-DryRun`; `-KeyPath` is used only when the environment variable is absent.
