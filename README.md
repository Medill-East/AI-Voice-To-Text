# AI Voice To Text

V2T is a cross-platform Electron + TypeScript voice-to-text MVP for Windows and macOS.

## Current MVP

- Global hotkey recording with short-press toggle and long-press hold behavior, including safe single-key triggers such as function keys.
- Local-first ASR model setup with hardware-based recommendations.
- Installable local ASR models through `sherpa-onnx`, including Fun-ASR-Nano, FireRed ASR2, and SenseVoice.
- Natural input mode for conservative correction.
- Structured input mode for Markdown-oriented cleanup.
- Text injection into the current focused app with clipboard fallback.
- Syncable settings, lexicon, and prompts. Text history stays local by default.

## Development Run

```bash
npm install
npm run dev:electron
```

## Build Run

```bash
npm run build
npm start
```

## Checks

```bash
npm test
npm run build
```

## Local Data

V2T keeps user data under the Electron user data directory.

- Syncable data: `sync/settings.json`, `sync/lexicon.json`, and `sync/prompts/`.
- Text history: `sync/history/<device>/YYYY-MM.jsonl`.
- Local ASR models: `models/`.

Model files are not committed to this repository and should not be synced through GitHub.

## GitHub Sync

The app can connect to a user-provided Git repository for settings and lexicon sync.

Only these files are exported:

- `settings.json`
- `lexicon.json`
- `prompts/natural.md`
- `prompts/structured.md`

History, models, logs, environment files, API keys, and Electron cache files are excluded. The app uses the local `git` CLI and your existing SSH or HTTPS credentials; it does not store GitHub tokens.
