---
name: process-parts-batch
description: Plan and run a batch of new process parts by delegating the Blender first pass to a 3D-capable model or sub-agent, then registering and verifying the results. Use when adding more than two parts from docs/assets/process-catalog.md (a "wave"), or when handing part scripts to another agent.
---

# Run a batch of process parts

One part is [process-part-add](../process-part-add/SKILL.md). A batch is the
same work split in two roles: **generators** write Blender scripts and GLBs
(first pass, shape only), and **one integrator** owns everything else.

## Roles

- **Generator (one per batch of about five parts, one batch at a time):**
  writes `blender/parts/process/<slug>.py` and builds
  `assets/models/<slug>.glb` plus previews, nothing else. No TypeScript, JSON,
  docs, commits, worktrees, `_common.py` or `holodeck_bpy.py` edits. A
  batch-private helper goes in `_<name>.py`.
- **Integrator (you):** reads every preview, sends back fixes, then does the
  registration (`models.json`, `parts.json`, catalogue, README, Studio) and
  verification ([process-part-verify](../process-part-verify/SKILL.md)),
  commits, and opens one PR so reviewers see the family once.

## Procedure

1. **Pick the batch from the catalogue** (`docs/assets/process-catalog.md`):
   parts of one family, so one hand draws them. Check that a part's status is
   not already `have`.
2. **Write the brief** from
   [references/batch-brief-template.md](references/batch-brief-template.md):
   one row per part with kind, what it is, ports, anim nodes and which piece
   takes `hd.accent`. Be specific about ports and nodes; those are contract.
   Name the closest shipped parts to copy (see the style guide's "Pick a
   reference part").
3. **Run generators serially.** A model-generation job is expensive and may
   have its own usage limits. Start one batch, review it, then the next.
   Do not fan out parallel jobs against one shared working directory; two
   writers in one tree is how files get overwritten.
4. **Review every preview yourself** at full and 160 px size next to the
   pilot parts. Send specific corrections (silhouette, proportion, a floating
   piece, an accent on the wrong piece) back to the generator and expect two
   rounds. Never accept a loosened `c.check`.
5. **Integrate** each accepted part with process-part-add step 4. Do it in one
   pass for the whole batch; the order of `models.json`, `parts.json`, the
   catalogue and `process-package.ts` must agree.
6. **Verify the batch**: process-part-verify steps 3 to 6, plus a contact
   sheet per batch for the PR body.
7. **Ship one PR** for the batch. Put the contact sheet and the weak-points
   list in the PR body; file issues for what you are not fixing now.

## What to ask the generator to report

The table from process-part-verify step 7, plus anything in the contract that
got in its way and any helper it thinks belongs in `_common.py`. If it hit a
usage limit or a Blender crash mid-batch, it must say which parts are built
and verified, which have a script but no GLB, and which are untouched.

## Rules of thumb from wave 1 (28 parts in 5 jobs)

- A pilot of five or six diverse parts first, then batches by family: it set
  the look, found the contract gaps (animator settings, state colours,
  mount height) cheaply, and gave every later brief concrete siblings.
- Four generators in parallel all died mid-batch: they exhausted a shared
  usage window in minutes. One at a time, about five parts each, worked.
- Contract gaps (a motion no built-in animator covers, per-piece accent
  colours, grid-aligned nozzles) surface in review, not generation. Decide
  early whether to extend the editor or to note the limit in the catalogue;
  extending the editor is a separate, major PR.
- Prefer grid-aligned nozzles in the brief (x or z on a whole cell) so the
  part gets grid ports and is routable; off-grid nozzles cost a follow-up.
