# kiro_real.md — Remaining Disagreement Notes

All actionable findings from the latest Kiro audit
that I agreed with have been fixed and removed from
this file.

## Disagreement 1 — Budget Off-By-One

The claim that:

```javascript
if (llmCallCount > maxLLMAttempts)
```

allows one extra LLM call is incorrect in the current
engine flow.

Reason:

- `llmCallCount` is incremented after the plugin
  reports the actual number of calls it consumed
- equality means the request has exactly exhausted the
  allowed budget, not exceeded it
- pre-invocation skipping is already handled
  separately through `maxLLMCalls` and
  `reserveBudgetOrSkip`

So the next attempted LLM consumption would be the
first one that exceeds the budget.
