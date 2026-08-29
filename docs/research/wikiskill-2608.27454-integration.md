# WikiSkill paper digest and Project Constellation integration

Source: **WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution**, arXiv:2608.27454v1, 27 August 2026.
Canonical HTML: https://arxiv.org/html/2608.27454

This note separates **paper findings** from **Project Constellation design decisions**. The paper is about optimizing reusable agent skills on benchmark tasks; Project Constellation is a browser-side project/continuity system, so the translation below keeps the architecture principles while avoiding claims the paper did not test.

## 1. The paper's central architecture

WikiSkill separates agent learning into three layers instead of repeatedly rewriting one prompt/skill from recent traces:

1. **Raw experience** — immutable execution traces. These preserve what actually happened, including failures.
2. **Persistent wiki knowledge** — structured, cumulative patterns, root causes, fixes, evolution history, and an impact tracker. This survives even when a proposed skill edit is rejected.
3. **Executable skills** — compact procedures used directly by the task-solving agent.

The evolutionary loop is likewise separated by responsibility: an inference agent produces traces, a Wiki Maintainer extracts reusable knowledge, a Skill Proposer creates a small patch, and a validation gate accepts or rolls back the skill patch. Crucially, the wiki still learns from the experiment even when the skill patch rolls back.

### Why this matters

The architecture separates **remembering** from **acting**. Raw traces remain evidence; the wiki compounds interpretation; the skill stays concise enough to execute. This reduces destructive rewriting and allows failed interventions to become useful future evidence.

## 2. What the wiki stores

The persistent wiki is not just a summary. The paper describes:

- an index used as the first routing surface;
- pattern pages that describe the problem, root cause, and fix;
- an evolution log;
- a skill-impact tracker containing proposed changes, validation outcomes, and accepted/rejected status;
- recurrence/history so later proposals can use earlier failed attempts rather than rediscover them.

The maintainer is instructed to capture both successes and failures, patch existing patterns instead of duplicating them, and keep pattern pages concise. The proposer reads the index and impact history first, then opens only the relevant pattern pages/traces on demand.

## 3. The most important empirical result for a second brain

The ablation is especially relevant to Project Constellation:

- with the wiki available to the proposer but **not** exposed directly to the inference agent, average performance was 63.7;
- removing the persistent wiki reduced the proposer average to 48.7, a **15.0-point drop**;
- exposing the wiki to the inference agent during rollouts reduced the average from 63.7 to 60.9.

The paper's interpretation is that direct access can make task trajectories less informative because the agent may solve from wiki content rather than demonstrating whether the compiled skill itself is good.

**Constellation takeaway:** an ultimate second brain should not mean injecting the whole archive everywhere. Keep the complete memory, but compile a small, relevant working context for the current project/task.

## 4. Main benchmark results

Across the reported models WikiSkill has the highest average in the main comparison. Examples from the main table:

| Model | No skill | WikiSkill |
| --- | ---: | ---: |
| Qwen-3.5-9B | 29.9 | 47.4 |
| Qwen-3.6-27B | 39.4 | 63.3 |
| Gemini-3.5-Flash | 49.5 | 68.1 |

The paper also reports that the benefit complements model scaling rather than simply disappearing on stronger models.

## 5. Transferability result

The cross-model experiments show that evolved procedural knowledge can transfer well across model families and can sometimes outperform a skill evolved by the target model itself. The paper also finds an important failure mode: low-level, model-specific workarounds can transfer negatively, and overly fragmented diagnostic procedures can consume tool budget without helping.

**Constellation takeaway:** distinguish project-general knowledge from provider/model-specific quirks. A project decision or release rule can be broadly reusable; a workaround for one provider DOM/state surface should retain provider provenance and not silently become a universal rule.

## 6. Qualitative evolution behavior

The qualitative examples show a useful asymmetry:

- wiki knowledge continues accumulating while the executable skill remains comparatively concise;
- rejected proposals are retained and can inform a later successful refinement;
- useful accepted updates can occur in middle and later iterations rather than only at initialization.

This supports a **living memory with an impact history**, not a static handoff document that gets overwritten on every checkpoint.

## 7. Efficiency observations

The implementation keeps the expensive proposer focused: it starts from the wiki index, impact tracker, and current outcome summary, then reads details selectively. The full-batch formulation uses one maintainer pass plus a bounded proposer loop rather than one optimization call per training trace.

**Constellation takeaway:** index first, hydrate details on demand. The project Home surface should be an atlas of compact state/working context, with exact source chats and artifacts one click away.

## 8. What the paper does *not* establish

The authors explicitly call out limits that matter for our translation:

- it does not evaluate automatic skill retrieval/triggering;
- strict validation gating may reject neutral changes that are stepping stones to later improvements;
- the wiki has no automatic pruning/compaction mechanism;
- evaluation does not cover very long-horizon, multi-hour tasks.

Project Constellation therefore should not claim the paper proves our project retrieval, browser grouping, pruning, or long-running workflow design. Those are product extensions inspired by the architecture, not paper results.

# Project Constellation v0.15 translation

## A. Raw layer — immutable source truth

Already present and preserved:

- canonical chat/turn history;
- immutable assistant turn revisions;
- Output Vault snapshots;
- files/artifacts and source URLs;
- provider/project IDs;
- recovery/integrity/events.

v0.15 does **not** replace these with summaries.

## B. Compounding project brain — curated knowledge

v0.15 adds a deterministic Project Brain compiler over existing `knowledgeItems` and project continuity.

For each Constellation project it compiles:

- decisions;
- next actions/follow-ups;
- strategies/recommendations/ideas;
- procedures/commands/code;
- repositories/documents/packages/links and other resources;
- versions;
- active/attention chats;
- latest artifact;
- coverage counts and provenance.

Every working-memory entry keeps its source chat/turn and confidence. The compiler deduplicates by canonical key and creates a bounded **Working set** rather than exposing the full vault.

## C. Memory impact/policy ledger

Project Brain adds concept-level policies:

- **Pin** — keep a memory high in the working set;
- **Ignore** — remove it from active working context without deleting source evidence;
- **Restore** — reactivate an ignored/superseded memory;
- internal support for **Superseded** policies.

Policies are stored at the project/canonical-key level so repeated mentions of the same concept cannot silently resurrect an ignored idea. Re-indexing preserves policies and the raw source remains intact.

This is the closest Constellation analogue to WikiSkill's skill-impact tracker: failed/rejected guidance becomes historical evidence rather than disappearing.

## D. Project Atlas organization

The Projects workspace becomes a retrieval/router surface:

- project cards show Active / Needs attention / Completed counts;
- default chat layout is **Project + state**;
- within a selected project, chats appear as Active, Needs attention, Completed, and Archived lanes;
- across the workspace, each project gets its own cluster, then state lanes inside it;
- State-only and Flat modes remain available and the preference persists locally.

This gives multiple concurrent chats on one project a coherent home without mixing unfinished and completed work.

## E. Native browser tab groups

Chrome cannot nest native tab groups, so v0.15 represents the same hierarchy as separate managed groups:

- `PC ✦ 🟣 Project Name · Active`
- `PC ✦ ⚠️ Project Name · Needs attention`
- `PC ✦ ✅ Project Name · Completed`

Completed groups collapse by default; Active and Needs attention stay expanded. If a chat has no known project, Constellation falls back to the global state group. The popup provides **Project + state** (default) and **State only** modes.

The existing ownership invariant is preserved: Constellation only moves tabs from groups carrying its exact managed prefix/status grammar. A user-created Chrome group is never stolen.

## F. Deliberate non-goals for this release

- No model request is made to generate Project Brain summaries.
- No whole-wiki injection into provider prompts.
- No automatic deletion/pruning of source history.
- No claim that inferred knowledge outranks user decisions.
- No automatic movement out of a user-created browser group.

## Acceptance contract

v0.15 is acceptable only if:

1. source-backed Project Brain entries can open their exact chat provenance;
2. Pin/Ignore/Restore persists across recompilation/re-indexing;
3. project cards report state counts correctly;
4. project-state organizer layout works with multiple projects and multiple states;
5. project-aware native groups converge after transient Chrome grouping failures;
6. State-only remains available;
7. user-created groups remain untouched;
8. existing Black Box Truth, Work Rescue, Capacity Guard, Output Vault, Drive durability, and No Surprise Navigation tests remain green.
