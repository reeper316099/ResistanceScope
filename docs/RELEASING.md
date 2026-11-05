# Releasing ResistanceScope (step by step)

The repository is `https://github.com/reeper316099/ResistanceScope`. Replace the version below when you release a different one.
Nothing in these steps has been run on GitHub yet; the first run is the real test of the workflows.

## One-time setup

1. **Create the repository** (skip if it already exists, as it does for this project):
   ```bash
   gh repo create reeper316099/ResistanceScope --public --source=. --remote=origin
   ```
2. **Allow the data-refresh workflow to open pull requests.** On GitHub: *Settings → Actions → General → Workflow permissions*,
   tick **"Allow GitHub Actions to create and approve pull requests"**, then Save.
3. **Make sure Actions are enabled:** *Settings → Actions → General → Actions permissions → "Allow all actions and
   reusable workflows"* (or "Allow actions created by GitHub", which is enough: the workflows only use `actions/*`).
4. *(Optional, recommended)* Protect `main`: *Settings → Rules → Rulesets* (or Branches → Add rule): require a pull request and
   require the three CI jobs (`app`, `pipeline`, `package-smoke`) to pass. The refresh workflow already works through a pull request.

## Every release

1. **Make sure the version is right.** `package.json` `"version"` must equal the tag without the `v` (the release workflow
   checks this and stops if they differ). For this first release it is already `0.1.0`.
2. **Update `CHANGELOG.md`** if you changed anything since it was written.
3. **Commit and push to `main`:**
   ```bash
   git add -A
   git commit -m "Prepare v0.1.0"
   git push origin main
   ```
4. **Wait for CI to go green** on that commit: GitHub → *Actions → CI*. Fix anything red before tagging (the Linux
   `package-smoke` job and the Ubuntu sandbox step have never run before and may need a tweak).
5. **Create and push the tag. Pushing the tag starts the release build:**
   ```bash
   git tag -a v0.1.0 -m "ResistanceScope 0.1.0"
   git push origin v0.1.0
   ```
6. **Watch the build:** GitHub → *Actions → Release*. It creates the release, builds on Ubuntu, Windows and macOS (about 10-20
   minutes), then a last job adds `SHA256SUMS`.
7. **Find the installers:** GitHub → *Releases → v0.1.0 → Assets*, or
   `https://github.com/reeper316099/ResistanceScope/releases/tag/v0.1.0`. You should see:
   - `ResistanceScope-0.1.0-win-x64-setup.exe` and `ResistanceScope-0.1.0-win-x64-portable.exe`
   - `ResistanceScope-0.1.0-mac-universal.dmg`
   - `ResistanceScope-0.1.0-linux-x86_64.AppImage` and `ResistanceScope-0.1.0-linux-amd64.deb`
   - `SHA256SUMS` (plus `latest*.yml` and `.blockmap` helper files that electron-builder always uploads)
8. **Click through the app on your own machine** using the checklist in the README / project notes, and tick the matching
   rows in the README status table once something has really been run.

## Turn on the monthly data refresh

1. GitHub → *Actions → Refresh data*. If you see an "Enable workflow" button, click it (GitHub switches scheduled workflows off
   after 60 days without repository activity).
2. Click **Run workflow** once, on `main`, to test it. It downloads about 2.3 GB, rebuilds and validates the data, and, if
   anything changed, opens a pull request named `data-refresh/<date>` with a summary of the changes.
3. Review the pull request. Pull requests created with the default token do not start CI by themselves: **close and reopen it**
   to run CI, then merge if everything is green and the summary looks plausible.
4. After that it runs on its own at 04:17 UTC on the 1st of each month.

## If a release goes wrong

```bash
gh release delete v0.1.0 --yes --cleanup-tag   # removes the release and the tag on GitHub
git tag -d v0.1.0                              # removes the local tag
# fix the problem, push to main, wait for green CI, then tag again
```
