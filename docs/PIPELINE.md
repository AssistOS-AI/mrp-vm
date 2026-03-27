# The Lifecycle of an Intent (Execution Pipeline)

## From Raw Language to Grounded Answer

The MRP-VM pipeline is a deterministic sequence of transformations designed to turn a messy natural language request into a verifiable result [DS002]. 

### Phase 1: Intent Normalization and Validation

The pipeline begins with **Neural Normalization** [DS006]. The VM does not attempt to "answer" the user's request at this stage. Instead, it rewrites the request into a **Controlled Natural Language (CNL)** format called **Intent CNL** [DS004]. 

**Intent CNL** is characterized by the mandatory **Act Invariant**: every intent group must declare a **Pragmatic Act** (e.g., *compare*, *diagnose*, *verify*).

```markdown
## Intent Group 1
Act: compare
Intent: Compare BM25 and dense retrieval for lexical search.
Criterion: Fast response time, low memory.
Output: Comparative recommendation.
```

The normalized output is immediately passed through a **Symbolic Validator** [DS007] to ensure it adheres to the CNL schema. If validation fails, the VM attempts a single corrective retry before failing explicitly—no "guessing" is allowed.

### Phase 2: Intent Decomposition and Context Profiling

Once validated, the intent is symbolically decomposed [DS011]. 
- **Target Extraction**: The VM identifies the core subject of the intent (e.g., "BM25 and dense retrieval").
- **Context Profiling**: The system derives a "profile" that specifies the type of evidence needed and the preferred roles (e.g., *Comparison*, *Evaluation*) based on the pragmatic act.

### Phase 3: Evidence Selection (The Retrieval Layer)

The VM then executes a **Retrieval Plan** [DS012, DS023]. Unlike standard RAG systems, MRP-VM matches the **Intent Profile** against structured **Context Units** [DS005] across two memory layers:
1.  **Session Temporary Context**: Facts and preferences established in the current conversation [DS019].
2.  **Persistent Knowledge Base**: Documents ingested and normalized into the system's long-term memory [DS008].

Retrieval is governed by **Risk Profiles** (e.g., *balanced*, *symbolic-grounded*, *meta-rational*), allowing the VM to escalate search strategies if initial evidence is weak [DS023].

### Phase 4: Regulated Execution (Plugins)

If an intent group's pragmatic act matches a specialized capability (e.g., *verify* → logical proof), the VM dispatches the **Resolved Intent** (intent + all retrieved context) to an **External Interpreter** (Plugin) [DS003]. 

Plugins operate in a "clean room" environment:
- They receive a structured CNL document as input [DS016].
- they execute specialized logic (e.g., SMT solving, custom calculations).
- they return results as **Plugin Evidence** in CNL format.

### Phase 5: Synthesis and Grounding

Finally, the **Answer Synthesizer** [DS017] receives the full bundle of resolved intents, retrieved evidence, and plugin results. It uses an LLM to generate a final response, but under a strict **Grounding Policy**:
- The answer must be based **only** on the provided evidence.
- Every claim in the answer must cite a specific context unit or plugin result.
- If no evidence is found, the system returns a `no-context` status instead of hallucinating.

---
*Next: [Knowledge, Context, and Retrieval Profiles](./RETRIEVAL.md)*
