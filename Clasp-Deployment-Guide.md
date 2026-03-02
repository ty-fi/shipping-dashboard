# Clasp Deployment Guide

How to use `clasp` to sync this repo with the Google Apps Script project automatically,
eliminating manual copy-paste into the editor.

## How It Works

```
local files  ──clasp push──►  Apps Script project  ──deploy──►  web app URL
     ↑
  git repo
```

## One-Time Setup

### 1. Install clasp

clasp is already installed on this machine (Nodist global packages).
To install elsewhere: `npm install -g @google/clasp`

### 2. Enable the Apps Script API

Go to https://script.google.com/home/usersettings and turn on **Google Apps Script API**.

### 3. Log in

Run: `clasp login`

Opens a browser OAuth flow — authorize with your Google account.

### 4. Link to the existing Apps Script project

Find your Script ID in the editor URL:

    https://script.google.com/home/projects/SCRIPT_ID_HERE/edit

Then from the project directory:

    cd ~/claude-projects/shipping-dashboard
    clasp clone SCRIPT_ID_HERE --rootDir .

This creates a `.clasp.json` file and `appsscript.json` — both safe to commit.

**Gotcha: `clasp clone` also pulls down `Code.js`**

`clasp clone` pulls the live script as `Code.js`, which duplicates the existing `Code.gs` in this repo. If you push without cleaning this up, Apps Script will end up with two separate script files. Fix it before pushing:

1. Copy real credentials from `Code.js` into `Code.gs` (the `SHEET_ID` and `TRACKING_API_KEY` lines in the CONFIG block)
2. Delete `Code.js`
3. Tell git to ignore local changes to `Code.gs` so credentials don't get staged:

        git update-index --skip-worktree Code.gs

### 5. Push code

    clasp push

## Auto-Push on Git Commit (Optional)

Create `.git/hooks/post-commit` with this content:

    #!/bin/bash
    echo "Pushing to Apps Script..."
    clasp push

Then make it executable: `chmod +x .git/hooks/post-commit`

After that, every `git commit` automatically pushes code to Apps Script.

## Deployment vs. Saved Code

| Action | Effect |
|--------|--------|
| `clasp push` | Updates saved code in the editor — visible at the `/dev` URL immediately |
| `clasp deploy --description "msg"` | Publishes a new version — updates the bookmarked `/exec` URL |

Recommended workflow:
- Use `clasp push` (via git hook) for all day-to-day edits
- Test at the `/dev` URL
- Run `clasp deploy` only when releasing a stable version to the `/exec` bookmark

## Common Commands

    clasp push                        # push local files to Apps Script
    clasp pull                        # pull Apps Script files to local
    clasp deploy --description "msg"  # publish a new deployment version
    clasp logs                        # tail execution logs

## Notes

- `clasp open` is not available in the version installed on this machine
- File extensions: `.gs` files become Script files, `.html` files become HTML files
- The `/dev` URL always reflects the latest saved (pushed) code without redeployment
