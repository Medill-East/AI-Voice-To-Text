<!-- director:wire BEGIN -->
- Director 看板接线〔本项目；此节由 Director 看板维护，勿手改〕
    - 开工前必读：ProjectInfo/ProjectProgress.md（现在到哪 / 下一步 / 阻塞）
    - 收工后必做：更新 ProjectInfo/ProjectProgress.md（覆盖写现状快照）；有决策则追加 ProjectInfo/roadmap.md
    - 留痕：按 ProjectInfo/ 规范（sessions/ 摘要 + dialogues/ 原始对话）；每步落盘 + git 备份
    - 全项目规矩：见用户级 AGENTS.md / CLAUDE.md 内 Director 治理节
<!-- director:wire END -->

# Project Instructions

- Prefer small, reviewable diffs and keep changes consistent with the existing Electron + TypeScript architecture.
- Add or update tests for behavior changes.
- Before editing, state the files to change and a short implementation plan.
- Every user-visible release must bump `package.json` and `package-lock.json` version before build/push; otherwise in-app update checks and GitHub Release tags may not surface the new build.
- After pushing a change that publishes a GitHub Release, run `npm run release:cleanup` locally so `release/` only keeps the current macOS DMG and `release/mac-arm64/V2T.app`.
