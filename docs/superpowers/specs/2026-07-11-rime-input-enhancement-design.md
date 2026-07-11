# Rime Input Enhancement Design

## Goal

Improve the local Squirrel + rime-ice full-pinyin experience while preserving upstream rime-ice updates.

## Changes

- Add `rime_ice.custom.yaml` with bidirectional fuzzy matching for z/zh, c/ch, s/sh, n/l, an/ang, en/eng, and in/ing.
- Add narrowly scoped typo derivations for `qai -> qia` and `dna -> dan`.
- Add `default.custom.yaml` to set the candidate page size to 10.
- Add `squirrel.custom.yaml` to select Squirrel's supported `linear` candidate layout.

## Boundaries

Squirrel only supports stacked and linear candidate layouts. The candidate window will be horizontal and show up to 10 candidates per page, but it cannot be constrained to a fixed five-column, two-row grid.

The fuzzy and typo rules are maintained as Rime patches. No upstream rime-ice file is modified.

## Validation

Reload Squirrel to deploy the configuration, inspect the generated build configuration, and confirm that deployment completes without YAML or schema errors. Manual acceptance checks are `qai`, `dna`, a front/back nasal-final pair, and a ten-candidate page in the horizontal window.
