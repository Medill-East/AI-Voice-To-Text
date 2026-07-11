# Rime Input Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve local Squirrel + rime-ice tolerance for selected fuzzy pronunciations and typo orders, while using a ten-candidate horizontal page.

**Architecture:** Keep all user choices in Rime patch files under `~/Library/Rime`; do not modify rime-ice's managed YAML files. Append spelling algebra rules so upstream correction rules remain intact, and use separate frontend/global patches for candidate count and layout.

**Tech Stack:** Squirrel 1.1.2, Rime 1.16.0, rime-ice YAML patches.

---

## File Structure

- `~/Library/Rime/rime_ice.custom.yaml`: Appends fuzzy-pronunciation and exact typo-order spelling rules to the full-pinyin schema.
- `~/Library/Rime/default.custom.yaml`: Sets the global candidate-page size to 10.
- `~/Library/Rime/squirrel.custom.yaml`: Selects Squirrel's supported horizontal flow layout.

### Task 1: Capture Baseline And Validate The Deployment Path

**Files:**
- Read: `~/Library/Rime/rime_ice.schema.yaml`
- Read: `~/Library/Rime/default.yaml`
- Read: `~/Library/Rime/squirrel.yaml`

- [ ] **Step 1: Confirm the source settings that will be patched**

Run:

```bash
rg -n 'candidate_list_layout|page_size|speller:' \
  "$HOME/Library/Rime/rime_ice.schema.yaml" \
  "$HOME/Library/Rime/default.yaml" \
  "$HOME/Library/Rime/squirrel.yaml"
```

Expected: `speller` exists in the schema, `page_size: 5` exists in `default.yaml`, and Squirrel uses `candidate_list_layout: stacked`.

- [ ] **Step 2: Confirm the Squirrel deployment executable is present**

Run:

```bash
test -x "/Library/Input Methods/Squirrel.app/Contents/MacOS/Squirrel"
```

Expected: exit status 0.

### Task 2: Add The Non-Destructive Rime Patches

**Files:**
- Create: `~/Library/Rime/rime_ice.custom.yaml`
- Create: `~/Library/Rime/default.custom.yaml`
- Create: `~/Library/Rime/squirrel.custom.yaml`

- [ ] **Step 1: Write the schema patch**

Create `~/Library/Rime/rime_ice.custom.yaml`:

```yaml
patch:
  speller/algebra/+:
    - derive/^([zcs])h/$1/
    - derive/^([zcs])([^h])/$1h$2/
    - derive/^n/l/
    - derive/^l/n/
    - derive/ang$/an/
    - derive/an$/ang/
    - derive/eng$/en/
    - derive/en$/eng/
    - derive/in$/ing/
    - derive/ing$/in/
    - derive/^qia$/qai/
    - derive/^dan$/dna/
```

The first ten derivations are bidirectional fuzzy matching for the requested initials and finals. The final two rules permit only `qai` for `qia` and `dna` for `dan`, rather than enabling all high-risk transposition families.

- [ ] **Step 2: Write the ten-candidate page patch**

Create `~/Library/Rime/default.custom.yaml`:

```yaml
patch:
  menu/page_size: 10
```

- [ ] **Step 3: Write the horizontal frontend patch**

Create `~/Library/Rime/squirrel.custom.yaml`:

```yaml
patch:
  style/candidate_list_layout: linear
```

### Task 3: Deploy And Verify

**Files:**
- Verify: `~/Library/Rime/build/rime_ice.schema.yaml`
- Verify: `~/Library/Rime/build/default.yaml`
- Verify: `~/Library/Rime/build/squirrel.yaml`

- [ ] **Step 1: Reload Squirrel and capture deployment output**

Run:

```bash
"/Library/Input Methods/Squirrel.app/Contents/MacOS/Squirrel" --reload
```

Expected: deployment completes without YAML, schema, or patch errors.

- [ ] **Step 2: Verify generated configuration contains each patch**

Run:

```bash
rg -n 'page_size: 10|candidate_list_layout: linear|derive/\^qia\$|derive/\^dan\$' \
  "$HOME/Library/Rime/build/default.yaml" \
  "$HOME/Library/Rime/build/squirrel.yaml" \
  "$HOME/Library/Rime/build/rime_ice.schema.yaml"
```

Expected: all four expected settings appear in their generated files.

- [ ] **Step 3: Run manual acceptance checks**

Type `qai`, `dna`, `zhong` and `zong`, `lin` and `ling`, then type an input with more than five candidates. Expected: the intended normal-pinyin candidates remain available for the typo/fuzzy forms; the candidate window is horizontal and offers up to ten candidates per page.

### Task 4: Document The Local Change

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-rime-input-enhancement-design.md`

- [ ] **Step 1: Add deployment outcome and manual acceptance result to the design record**

Append a short `## Deployment Result` section that records the date, whether the reload completed without errors, and the result of each manual acceptance check. Do not copy local user-dictionary content into the repository.
