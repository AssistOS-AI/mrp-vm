# codex.review.md — Remaining Issues After Refactor Sweep

Date: 2026-03-30  
Reviewer: Codex

This file contains only issues that still remain
after the current refactor pass.

## 1. Built-In KB Plugins Are Still Transitional

`kb-fast`, `kb-balanced`, and `kb-thinkingdb` are now
typed plugins and planner-visible, but they still
share one internal retrieval stack centered on
`ContextMatcher` plus legacy profile IDs.

Why this still matters:

- the kernel is thin, but KB behavior is not yet
  owned end-to-end by independently implemented
  plugins
- planner experimentation is therefore richer at the
  selection layer than at the implementation layer

Suggested next step:

- move profile-specific retrieval configuration fully
  behind per-plugin implementations or per-plugin
  manifests

## 2. Planner Learning Is Still Global, Not
Topic-Conditioned

The current learning loop now records both planner
and stage-plugin EWMA statistics, and routing also
uses `plannerHints`. That is a solid baseline, but the
learned utility is still global.

Why this still matters:

- a plugin that is strong on legal verification and
  weak on literary synthesis still gets one blended
  utility score
- a planner that works well for technical tasks and
  poorly for procedural tasks is not yet separated by
  task family

Suggested next step:

- bucket stats by coarse request features such as act,
  topic tags, and depth class
- learn on plugin combinations as well as individual
  plugin IDs
