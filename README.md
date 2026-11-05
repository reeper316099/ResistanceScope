# ResistanceScope

An offline desktop app for exploring which antibiotic-resistance genes appear in publicly available bacterial genome
data: in which bacteria, where, when, and **how much to trust the picture**. Everything is computed from public NCBI
files by a Python pipeline and shipped inside the app as small, validated JSON files, so the app itself never touches
the network.

> **Educational use only. Not for clinical decisions.** The numbers are shares of *sequenced isolates in public
> databases* (not random samples, not true prevalence), and a gene call is a genotype prediction, not proof that a
> drug fails.

*(Full project documentation, screenshots and the data-flow diagram are completed in the final phase.)*

## Download

Installers are attached to each [GitHub Release](https://github.com/reeper316099/ResistanceScope/releases):

| System | File |
|---|---|
| Windows | `ResistanceScope-<version>-win-x64-setup.exe` (installer) or `…-portable.exe` |
| macOS (Apple Silicon and Intel) | `ResistanceScope-<version>-mac-universal.dmg` |
| Linux | `ResistanceScope-<version>-linux-x86_64.AppImage` or `…-linux-amd64.deb` |

Each release also has a `SHA256SUMS` file. To check a download: `shasum -a 256 <file>` (macOS), `sha256sum <file>`
(Linux) or `Get-FileHash <file>` (Windows PowerShell) and compare with the line in `SHA256SUMS`.

## Unsigned apps: what you will see and how to open them

The installers are **not code-signed or notarized** (that needs paid developer certificates, which this free project
does not have). Your operating system will therefore warn you. That is expected for this project; it does not mean
anything was tampered with, but you should still only download from the official Releases page and check the checksum.

**Windows (SmartScreen: "Windows protected your PC / unknown publisher")**
1. Run the installer. When the blue SmartScreen box appears, click **More info**.
2. Click **Run anyway**.

**macOS (Gatekeeper: "cannot be opened because the developer cannot be verified")**
1. Open the `.dmg` and drag ResistanceScope to **Applications**.
2. In Applications, **right-click (or Control-click) ResistanceScope, choose Open**, then click **Open** in the dialog.
3. If macOS still refuses (newer versions): open **System Settings, Privacy & Security**, scroll to the message about
   ResistanceScope and click **Open Anyway**.
4. Last resort, in Terminal: `xattr -dr com.apple.quarantine /Applications/ResistanceScope.app`

**Linux**
- AppImage: `chmod +x ResistanceScope-*.AppImage`, then run it.
- Debian/Ubuntu: `sudo apt install ./ResistanceScope-*-linux-amd64.deb`.
- On recent Ubuntu versions Chromium-based apps can fail to start with a sandbox message. If that happens, the usual
  workarounds are to allow unprivileged user namespaces
  (`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`) or to start the app with `--no-sandbox`
  (which disables an important protection, so only do it for this app).
  *This Linux guidance comes from how Electron behaves on Ubuntu runners; it was not tested on a desktop machine.*

Signing, notarization and automatic updates are on the stretch list below.

## What was and was not tested (honest status)

| What | Status |
|---|---|
| App (dev build) on macOS: unit tests, lint, typecheck, 48 Electron end-to-end tests | **Ran and passed** |
| Pipeline: 92 pytest tests, full run on the real data, independent spot-check | **Ran and passed** |
| macOS **universal `.dmg`** built here; mounted; packaged app launched and passed 4 packaged-app tests (arm64 slice) | **Ran and passed** |
| Electron security fuses effective in the packaged macOS binary (cannot run as plain Node, ignores `--inspect`) | **Ran and passed** |
| macOS Intel (x86_64) slice of the universal app | **UNTESTED LOCALLY** (built, never launched) |
| Windows installer and portable `.exe` | Built here by cross-compiling; **never launched. UNTESTED LOCALLY, verified only by CI** |
| Linux AppImage and `.deb` | Built here by cross-compiling; **never launched. UNTESTED LOCALLY, verified only by CI** |
| `ci.yml`, `release.yml`, `refresh-data.yml` | Syntax-checked with `actionlint`; **never run. UNTESTED LOCALLY, verified only by CI** |
| Linux packaged smoke test under a virtual display (job `package-smoke` in `ci.yml`) | **UNTESTED LOCALLY, verified only by CI** |
| Time and disk needed by the monthly data refresh on a GitHub runner | **Not measured** |

This table is updated when a real run passes.

## Run from source

Requires Node 22 and, for the data pipeline, Python 3.11.

```bash
npm ci
npm run dev          # window opens in the foreground; use `npm run dev:bg` to open it without taking focus
npm run typecheck && npm run lint && npm test
npm run test:e2e     # builds, then drives the real Electron app
npm run dist:dir     # unpacked app for your OS in release/ (then: npm run test:packaged)
npm run dist         # installers for your OS
```

Rebuild the data (downloads about 2.3 GB from NCBI, see `pipeline/README.md`):

```bash
cd pipeline && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && cd ..
npm run data:rebuild
```

Building installers inside an iCloud-synced folder (for example the macOS Desktop) can fail at the code-signing step
because iCloud adds file attributes that `codesign` rejects. Build from a normal folder, or write the output elsewhere:
`npx electron-builder --mac -c.directories.output=/tmp/rs-release`.

## Automation (GitHub Actions)

- **CI** (`ci.yml`): format, types, lint, unit tests (including a test that loads the real `data/` through the zod
  schemas), Electron end-to-end tests under a virtual display, pipeline lint and tests, and a packaged Linux smoke test.
- **Release** (`release.yml`): pushing a tag like `v0.1.0` builds Windows, macOS and Linux installers, attaches them to
  the release and adds `SHA256SUMS`. Only official `actions/*` actions and the preinstalled GitHub CLI are used.
- **Refresh data** (`refresh-data.yml`): monthly, rebuilds `data/` from NCBI, validates it, and opens a **pull request**
  with a summary of what changed. It never pushes to `main`. Repository setting needed once:
  *Settings, Actions, General, Workflow permissions: "Allow GitHub Actions to create and approve pull requests"*.
  Pull requests created with the default token do not start CI by themselves; close and reopen the pull request to run it.
- There is deliberately no web version and no GitHub Pages workflow.

## Security notes

Context isolation on, Node integration off, renderer sandbox on, strict Content-Security-Policy (no inline script, no
`eval`), all non-`app://` requests blocked, navigation and new windows blocked, permissions denied, a three-function
preload whose arguments are re-validated in the main process, and Electron fuses switched off for `ELECTRON_RUN_AS_NODE`,
`NODE_OPTIONS` and `--inspect` in the packaged app. The app makes no network requests; the only outbound action is
opening an allowlisted `https` link in your system browser when you click it.

## Stretch list (not done)

1. Code signing and notarization (Windows certificate, Apple Developer ID) so the warnings above disappear.
2. Automatic updates (needs signed builds to be safe).
3. A "surveillance gaps" view showing where data is thin.
4. Lab-measured phenotype data (BV-BRC) next to genotype calls.
5. Gene co-occurrence network, and plasmid vs chromosome breakdown.

## Licence and data

Code: MIT (see `LICENSE`). Data: aggregates derived from public NCBI data (public-domain policy); see
[`DATA-SOURCES.md`](DATA-SOURCES.md) for sources, licence wording, citations and what is deliberately not used (CARD).
