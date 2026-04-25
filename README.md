# AI Voice To Text

V2T is a cross-platform Electron + TypeScript voice-to-text MVP for Windows and macOS.

## Current MVP

- Global hotkey recording with short-press toggle and long-press hold behavior.
- Local-first ASR model setup with hardware-based recommendations.
- SenseVoice ONNX model management through `sherpa-onnx`.
- Natural input mode for conservative correction.
- Structured input mode for Markdown-oriented cleanup.
- Text injection into the current focused app with clipboard fallback.
- Syncable settings, lexicon, prompts, and text-only history.

## Development

```bash
npm install
npm test
npm run build
npm run dev:electron
```

Local models are stored under the Electron user data directory and are not committed to the repository.
