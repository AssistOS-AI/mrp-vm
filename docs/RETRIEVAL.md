# Knowledge, Context, and Retrieval Profiles

## Memory: From Raw Data to Contextual Evidence

In MRP-VM, "Knowledge" is not a static repository of documents, but an actively governed store of **Context Units** [DS005]. 

### The Knowledge Base (KB) Ingest Pipeline

When a raw document (e.g., Markdown or plain text) is added to the **Knowledge Base** [DS008], it undergoes an atomic transformation process:
1.  **Semantic Chunking**: The document is segmented into chunks small enough for coherent reasoning but large enough to preserve context [DS018].
2.  **Context Normalization**: Each chunk is transformed into one or more **Context CNL Units**. These units are enriched with pragmatic information:
    - **Role**: The function of the information (e.g., *Procedure*, *Constraint*, *Definition*) [DS005].
    - **Utility Acts**: A list of pragmatic acts the unit is particularly well-suited to serve (e.g., *compare*, *implement*).

This process ensures that "raw language" is systematically converted into **"symbolic evidence"** that the VM can query and match with high precision.

### The Session Context Store

A key differentiator of MRP-VM is its handling of **Session Context** [DS019]. The system does not simply store the full transcript of a conversation. Instead, it extracts factual details, preferences, and constraints from each user turn and persists them as temporary **Context Units**. 

Importantly, the system explicitly excludes direct requests, questions, or assistant-authored text from this store. This ensures the **Session Context** contains only stable, user-established facts, creating a "clean" environment for reasoning.

### Retrieval Strategies and Risk Profiles

The matching of intents with context is orchestrated through a pluggable **Strategy Layer** [DS012, DS023]. 

- **Lexical Matching (BM25)**: The baseline strategy for exact token overlap [DS009].
- **HDC/VSA Associative Matching**: A neuro-symbolic strategy using high-dimensional vectors (hypervectors) for fast, approximate matching of structural patterns (e.g., matching a topic even when exact keywords differ) [DS024].
- **Symbolic Grounding**: Advanced strategies that use symbolic logic to confirm or prune retrieved evidence based on formal constraints [DS023].

These strategies are configured into **Retrieval Risk Profiles** that manage the trade-off between latency, recall, and certainty:

| Profile | Strategy Lifecycle | Use Case |
|:--- |:--- |:--- |
| **fast** | Single lexical pass. | Lowest latency, high keyword reliance. |
| **balanced** | Lexical pass + conditional escalation. | Recommended default for general interaction. |
| **wide-recall** | Parallel execution of multiple strategies. | Maximum evidence discovery for complex queries. |
| **symbolic-grounded** | Lexical pass followed by symbolic pruning. | High-certainty reasoning for formal domains. |
| **meta-rational** | Adaptive escalation and cross-strategy fusion. | The most advanced "rational" profile [DS023]. |

By choosing the right profile, the VM can optimize its "regime of truth" for the task at hand.

---
*Next: [The Plugin Ecosystem and Symbolic Grounding](./PLUGINS.md)*
