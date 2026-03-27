# Meta-Rational Pragmatics Virtual Machine (MRP-VM)

## The Vision: A New Generation of Agentic Architectures

The **Meta-Rational Pragmatics Virtual Machine (MRP-VM)** represents a fundamental shift in the design of autonomous agents and language-processing systems. Moving beyond the limitations of monolithic Large Language Models (LLMs) and opaque "agentic loops," MRP-VM introduces a disciplined **neuro-symbolic control layer** [1]. 

At its core, MRP-VM is a prototype for the **Meta-Rational Pragmatics (MRP)** approach—a framework that treats the coordination of multiple reasoning regimes (neural, symbolic, and retrieval-based) as a first-class architectural concern. 

### From Model Continuation to Governed Execution

In traditional AI systems, execution is often synonymous with model inference—a "black box" process that is difficult to audit or formally verify. MRP-VM reframes this by conceptualizing the **Virtual Machine** not as a processor of low-level binary instructions, but as an **orchestrator of natural language interpreters**. 

Each specialized skill or "plugin" added to the system functions as a new type of interpreter. These range from:
- **Neural Interpreters**: Leveraging LLMs for broad semantic normalization and creative synthesis.
- **Symbolic Interpreters**: Utilizing SMT solvers (like Z3), formal logic, or deterministic code for high-precision verification and constraint satisfaction.
- **Pragmatic Interpreters**: Specialized rulesets optimized for specific classes of problems, such as diagnostic reasoning or procedural implementation.

### The Neuro-Symbolic Synthesis

MRP-VM operates on the principle of **Disciplined Semantic Pluralism** [1]. It recognizes that no single model or theory is universally adequate. Instead, the VM manages a plurality of "partially adequate" models, routing execution to the most appropriate "regime" based on the user's intent and the available context.

The process is inherently neuro-symbolic:
1. **Neural Normalization**: LLMs are used as "semantic front-ends" to translate messy, ambiguous natural language into a **Controlled Natural Language (CNL)** [DS004, DS005].
2. **Context Preparation**: The system systematically prepares the "session context" and retrieves relevant evidence from the "Knowledge Base" [DS008, DS019].
3. **Symbolic Execution**: The prepared "Resolved Intent" is dispatched to the optimal interpreter, where the problem is solved within a governed and verifiable frame [DS003, DS016].

By grounding execution in explicit intents and auditable evidence, MRP-VM transforms the "opaque execution" of current AI into a **dependable, legible, and auditable system** [1].

---

**References and Further Reading:**
- [1] [Meta Rational Pragmatics (MRP) — AGISystem2](https://agisystem2.com/MRP/index.html)
- [DS001 — General Architecture](./specs/DS001-general-architecture.md)
- [DS002 — MRP-VM Core Engine](./specs/DS002-mrp-vm-core.md)

---
*Next: [The Virtual Machine Architecture](./ARCH-VM.md)*
