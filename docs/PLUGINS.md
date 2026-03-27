# Specialized Interpreters and Symbolic Grounding

## The Plugin Ecosystem: Interpreters of Natural Language

The most profound innovation of **MRP-VM** is its conceptualization of **Plugins as Interpreters** [DS003]. In this Virtual Machine, a plugin is not just a "tool" that performs a task, but a specialized engine capable of "executing" a resolved intent bundle within a specific symbolic regime.

### The Wrapper Convention (DS016)

To maintain strict boundaries and auditability, all plugins must follow a formal **Wrapper Convention** [DS016]. 
- **Encapsulated Processes**: Each plugin runs as an independent process (e.g., in Python, Node.js, or Rust).
- **CNL I/O**: Communication is performed via `stdin` and `stdout` using **Resolved Intent Markdown**.
- **Self-Declaration**: Plugins declare their capabilities (e.g., `logical-constraint`, `sat-check`) and keywords in a `manifest.json`.

### Dynamic Dispatch and Conflict Resolution

The VM orchestrates plugin execution per **Intent Group**. When an intent is resolved (intent + current-turn context + session context + KB context), the **Plugin Manager** selects the most appropriate interpreter [DS003]:
1.  **Capability Matching**: Does the plugin claim a capability that matches the intent's pragmatic act?
2.  **Keyword Matching**: Does the intent text match the plugin's expertise?
3.  **Conflict Resolution**: If multiple plugins match, the VM uses an explicit priority system to pick the optimal one.

### Symbolic Grounding in Practice

Consider an intent to **"Verify that the deployment plan meets the security constraint X."**
- **Phase 1-3**: The VM normalizes the intent, extracts constraints from the session, and retrieves technical rules from the KB.
- **Phase 4**: The system identifies a `z3-solver` plugin capable of `logical-constraint` verification.
- **Execution**: The plugin receives a single Markdown document containing all evidence. It translates the claims into formal Z3 SMT logic, solves it, and returns a **Plugin Result** in CNL.

```markdown
## Plugin Result
Status: success
Plugin: z3-solver
Confidence: high
Result: Deployment plan satisfies constraint X.
Evidence: SMT solver returned SAT.
```

- **Phase 5**: The final answer is synthesized, incorporating this formal proof as **explicitly cited evidence**.

### The Future of the Virtual Machine

At its current prototype stage, MRP-VM demonstrates that **Meta-Rational Pragmatics** can turn the inherent fluidity of language into a disciplined medium for execution. By adding new plugins, we don't just "teach the agent a skill"—we **extend the Virtual Machine's instruction set with new symbolic regimes**. 

Whether the interpreter uses an LLM+code "skill," a formal SMT solver, or a specialized symbolic-only template, its integration into the VM remains **governed, auditable, and grounded in explicit evidence** [1].

---

**References:**
- [1] [Meta Rational Pragmatics (MRP) — AGISystem2](https://agisystem2.com/MRP/index.html)
- [DS003 — Plugin System](./specs/DS003-plugin-system.md)
- [DS016 — External Interpreter Wrapper Convention](./specs/DS016-wrapper-convention.md)
