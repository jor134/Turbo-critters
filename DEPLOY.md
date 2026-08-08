# Turbo Critters — deploying the shared record board

## Repo layout

Both files go in the **repository root**. The `api` folder must be at the top
level, not inside a subfolder, or Vercel won't turn it into a function.

```
your-repo/
├── index.html        <- turbo-critters.html, renamed
└── api/
    └── records.js
```

## Steps

1. **Commit both files.** Rename `turbo-critters.html` to `index.html`. Create a
   folder named `api` and put `records.js` inside it.

2. **Connect a Redis store.** In your Vercel project: **Storage → Create
   Database → Upstash Redis** (the Marketplace option), then connect it to this
   project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the
   project's environment variables for you.

3. **Redeploy.** Environment variables are read at deploy time, so a store
   connected after the last deploy won't be visible until you redeploy.
   Deployments → ⋯ → Redeploy, or just push another commit.

4. **Check it.** Open the game, tap **🏅 Records**. The line under the heading
   should read *"everyone racing this link shares one board"*. You can also
   visit `https://your-site.vercel.app/api/records?ping=1` — it should return
   `{"ok":true}`.

## If it still says times are saved on this device

The Records screen prints the actual reason. The three you're likely to see:

| Message | Meaning |
|---|---|
| `No /api/records endpoint` | The file isn't deployed, or `api/` isn't at the repo root. |
| `Found /api/records, but no KV store is connected` | Step 2 or step 3 is missing — connect the store, then **redeploy**. |
| `Couldn't reach /api/records` | You're opening the HTML file directly rather than through the deployed site. |

Times are still saved on your device in every one of these cases; only the
sharing is off.

## Notes

- `api/records.js` is written as **CommonJS** (`module.exports`) on purpose.
  A plain `.js` file in `/api` is loaded as CommonJS unless the project sets
  `"type": "module"`, so `export default` fails on Node 20 runtimes.
- The Upstash token is read server-side and never reaches the browser. There is
  a `CONFIG.UPSTASH_URL` slot in the HTML for calling Upstash directly, but
  don't use it — anything in that file is readable by anyone who opens the page,
  and a write-capable token there lets a stranger wipe your leaderboard.
- The endpoint merges submissions server-side, so two people finishing at the
  same moment can't overwrite each other. It also rejects implausible lap times,
  unknown track names, and oversized ghost payloads.
- Storage used is tiny: one key per circuit, roughly 20 KB each including the
  ghost lap. Five circuits is well under any free-tier limit.
