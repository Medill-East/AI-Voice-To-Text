# Project Instructions

- Prefer small, reviewable diffs and keep changes consistent with the existing Electron + TypeScript architecture.
- Add or update tests for behavior changes.
- Before editing, state the files to change and a short implementation plan.
- Every user-visible release must bump `package.json` and `package-lock.json` version before build/push; otherwise in-app update checks and GitHub Release tags may not surface the new build.
- After pushing a change that publishes a GitHub Release, run `npm run release:cleanup` locally so `release/` only keeps the current macOS DMG and `release/mac-arm64/V2T.app`.
