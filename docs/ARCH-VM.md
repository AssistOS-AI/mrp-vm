# The Neuro-Symbolic Virtual Machine (MRP-VM)

## Architecture: The Governed Control Layer

The **MRP-VM** functions as a governed runtime for language-centric execution. Unlike conventional VMs that process opcodes (e.g., JVM or EVM), MRP-VM processes **Intents** and **Context** expressed in Controlled Natural Language (CNL) [DS001].

### Core Architecture and Components

The architecture is designed around the **MRPEngine**, the central orchestrator responsible for managing the request lifecycle across twelve distinct phases [DS002].

<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="780" height="380" fill="#f9f9f9" stroke="#333" stroke-width="2"/>
  
  <!-- Core -->
  <rect x="300" y="50" width="200" height="60" rx="10" fill="#e1f5fe" stroke="#01579b" stroke-width="2"/>
  <text x="400" y="85" font-family="Arial" font-size="16" text-anchor="middle" font-weight="bold">MRP Core Engine</text>
  
  <!-- Layers -->
  <rect x="50" y="150" width="140" height="50" rx="5" fill="#fff9c4" stroke="#fbc02d" stroke-width="1.5"/>
  <text x="120" y="180" font-family="Arial" font-size="14" text-anchor="middle">Normalizer</text>
  
  <rect x="210" y="150" width="140" height="50" rx="5" fill="#fff9c4" stroke="#fbc02d" stroke-width="1.5"/>
  <text x="280" y="180" font-family="Arial" font-size="14" text-anchor="middle">Decomposer</text>
  
  <rect x="370" y="150" width="140" height="50" rx="5" fill="#fff9c4" stroke="#fbc02d" stroke-width="1.5"/>
  <text x="440" y="180" font-family="Arial" font-size="14" text-anchor="middle">Retrieval</text>
  
  <rect x="530" y="150" width="140" height="50" rx="5" fill="#fff9c4" stroke="#fbc02d" stroke-width="1.5"/>
  <text x="600" y="180" font-family="Arial" font-size="14" text-anchor="middle">Synthesis</text>
  
  <!-- Storage/Plugins -->
  <rect x="250" y="260" width="140" height="50" rx="5" fill="#dcedc8" stroke="#33691e" stroke-width="1.5"/>
  <text x="320" y="290" font-family="Arial" font-size="14" text-anchor="middle">Knowledge Base</text>
  
  <rect x="410" y="260" width="140" height="50" rx="5" fill="#f8bbd0" stroke="#880e4f" stroke-width="1.5"/>
  <text x="480" y="290" font-family="Arial" font-size="14" text-anchor="middle">Plugins (Wrappers)</text>
  
  <!-- Connections -->
  <path d="M 400 110 L 400 130 L 120 130 L 120 150" fill="none" stroke="#333" stroke-width="1.5"/>
  <path d="M 400 110 L 400 150" fill="none" stroke="#333" stroke-width="1.5" stroke-dasharray="5,5"/>
  <path d="M 400 110 L 400 130 L 280 130 L 280 150" fill="none" stroke="#333" stroke-width="1.5"/>
  <path d="M 400 110 L 400 130 L 600 130 L 600 150" fill="none" stroke="#333" stroke-width="1.5"/>
  
  <path d="M 440 200 L 440 230 L 320 230 L 320 260" fill="none" stroke="#333" stroke-width="1.5"/>
  <path d="M 440 200 L 440 230 L 480 230 L 480 260" fill="none" stroke="#333" stroke-width="1.5"/>
</svg>

### Structural Components

1.  **MRPEngine**: The central coordinator [DS002]. It manages the request state, enforces operational budgets (e.g., LLM attempt limits), and handles the transitions between neural and symbolic phases.
2.  **NL Normalizer**: The "semantic bridge" [DS006]. It utilizes LLMs (under `llm-assisted` strategy) to translate raw input into **Intent CNL** and **Context CNL**. This normalization phase is crucial for grounding subsequent steps in a formal, auditable format.
3.  **Intent Decomposer**: A symbolic module that splits complex requests into discrete, actionable **Intent Groups** [DS011]. Each group is assigned a **Pragmatic Act** (e.g., *compare*, *verify*, *implement*) that guides the selection of the appropriate execution regime [DS004].
4.  **Retrieval & Context Matching**: A multi-strategy engine [DS012, DS023] that gathers evidence from:
    - **Current-Turn Context**: Facts extracted from the user's latest message.
    - **Session context**: Temporary facts persisted during the current conversation [DS019].
    - **Persistent Knowledge Base**: Long-term organizational knowledge [DS008].
5.  **Plugin System (External Interpreters)**: The "ALU" of the VM [DS003, DS016]. Specialized processes (e.g., Z3 solvers or domain-specific code) are invoked to solve formal parts of the intent, returning results back in CNL.
6.  **Answer Synthesizer**: The final output generator [DS017]. It produces structured Markdown that cites explicit evidence, ensuring that the assistant's answer is grounded and verifiable.

### The Neuro-Symbolic Boundary

The MRP-VM enforces a strict boundary between **neural intuition** and **symbolic logic**. 
- LLMs are relegated to the roles of **Normalizers** and **Synthesizers**, where their creative fluidity is an asset.
- Logical reasoning, fact retrieval, and formal verification are handled by **Symbolic Decomposers, Retrieval Indices, and Specialized Plugins**, where precision is paramount.

By separating these concerns, the VM provides a predictable environment where errors can be localized (e.g., a "Plugin Error" vs. a "Retrieval Timeout") and corrected with precision [DS001].

---
*Next: [The Intent Decomposition and Lifecycle](./PIPELINE.md)*
