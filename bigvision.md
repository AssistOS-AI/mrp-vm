# Current MRP-VM architecture as I understand it
General character

The current system is a recursive problem-solving runtime in which the primary representation is natural language rather than a formal intermediate representation. The system does not assume a single canonical knowledge base, a single canonical parsing, or a single canonical execution regime. Instead, it relies on multiple plugins that each provide partial interpretations, knowledge extraction, retrieval, planning, or resolution capabilities. The runtime advances by repeatedly trying plugin-based interpretations for each stage, with a form of controlled backtracking when a local path appears weak, invalid, or unproductive.

Core representational units

The central working units are no longer SOP Lang instructions, but two softer operational objects.

A Knowledge Unit (KU) is a meaningful chunk of knowledge detected from context, files, plugin-specific knowledge bases, or intermediate reasoning. A KU is not necessarily formal, normalized, or globally canonical. It is a pragmatic unit of usable knowledge, extracted at a granularity judged useful for later retrieval, matching, planning, or execution. Different plugins may produce overlapping or differently shaped KUs from the same source material.

A seed is an intent-bearing query unit or problem fragment extracted from the current request, context, or subproblem. Seeds represent candidate directions of interpretation, retrieval, decomposition, or action. They serve as local starting points for KB exploration and recursive solving.

Input and ingestion

The system receives an initial problem in natural language. It does not require translation into a controlled language or intermediate representation before processing. Instead, one or more ingestion plugins analyze the current request and surrounding conversational or document context in order to extract distinct intents, generate initial seeds, and detect candidate KUs relevant to the problem.

This means that early processing is already plural and heuristic. The system may derive multiple interpretations of the same request and keep them available in parallel rather than forcing early convergence to a single representation.

Knowledge base organization

The system maintains multiple KB plugins rather than one unified KB. Each KB plugin may index, store, derive, or organize knowledge differently. The same underlying source material may therefore be duplicated across plugins, possibly with different chunking, different KU boundaries, different metadata, different indexing strategies, or different semantic assumptions.

This duplication is not treated as a defect but as an intentional architectural feature. The goal is to preserve multiple useful perspectives over the same material so that different interpretation regimes can later exploit different KB organizations.

Each KB plugin may also associate KUs not only with source content but with plugin descriptions, skill descriptions, or operational affordances. In particular, plugins themselves may be described by KUs indicating what kinds of problems they solve, what transformations they support, what evidence they require, and what outputs they can produce.

Stage structure

MRP-VM is currently organized as a set of working stages, but each stage is implemented through plugins rather than a fixed formal language. At a high level, the flow appears to be:

The request is ingested in natural language.
Initial intents and seeds are extracted.
Relevant KUs are searched or derived from one or more KB plugins.
A local execution plan is proposed, often with LLM assistance.
The problem is decomposed into smaller subproblems.
For each subproblem, the runtime attempts one or more solving plugins corresponding to different interpretation regimes.
Intermediate results may recursively trigger further decomposition, retrieval, or plugin selection.
If a path fails, appears weak, or cannot be validated sufficiently, the runtime backtracks and tries alternative plugins, seeds, KB perspectives, or decompositions.

Plugin role

Plugins are the operational core of the runtime. They appear to fall into several broad classes.

Ingestion plugins detect intents, seeds, and initial KUs from requests or documents.

KB plugins store or expose KUs and retrieval strategies over different knowledge organizations.

Planning plugins help project a local execution strategy for the current problem or subproblem.

Solving plugins correspond to different interpretation regimes. A regime might be retrieval-heavy, synthesis-heavy, symbolic, procedural, comparative, verification-oriented, or otherwise specialized.

There may also be plugins that describe other plugins, so plugin selection is itself informed by knowledge units about capabilities.

Local planning

There is no single global program representation. Instead, the runtime constructs a local plan for the current problem horizon. This local plan is likely natural-language-based or semi-structured rather than formally compiled. It exists to guide immediate decomposition and plugin selection, not to serve as a durable canonical artifact.

Thus planning is situated, revisable, and recursive. As new KUs are found or partial results appear, the local plan may be revised or replaced.

Recursion and backtracking

The runtime uses recursive decomposition. A complex problem is broken into smaller problems, and each smaller problem is solved through the same general mechanism: seed extraction, KU discovery, plugin selection, local planning, solving attempts, and possible further decomposition.

Backtracking is a central control principle. The system does not assume that the first interpretation is correct. Instead, it explores multiple possible paths and abandons or revises paths when they do not produce sufficient progress, evidence, compatibility, or validation.

This makes the runtime more like a search process over interpretations than a pipeline over fixed representations.

Validation style

Validation appears pragmatic rather than fully formal. A subproblem is considered resolved either when a solving path reaches a sufficiently acceptable result under some plugin-specific notion of success, or when the system approximates validation through available evidence, consistency, or usefulness. Validation is therefore heterogeneous and regime-dependent.

Current philosophical position

The current architecture assumes that premature formalization is often counterproductive. Rather than forcing all knowledge and control flow into SOP Lang IR or even a controlled natural language, the system leaves both problem representation and intermediate reasoning closer to ordinary natural language and relies on plugin diversity plus recursive search to progressively stabilize meaning and solution structure.

That is the architecture I infer from your description. In substantive terms, it is coherent.

My commentary

I think this architecture is more pragmatic than the earlier SOP-centered formulation and is probably closer to what actually works with current models. At the same time, it gives up several strong guarantees that the earlier formulation could, at least in principle, have provided. So the question is not whether it is valid. It is valid. The question is what you are buying and what you are losing.

What is strong in this architecture

The strongest point is that it matches the empirical behavior of present-day LLM systems better than a prematurely rigid IR-first approach. Current models are often good at local decomposition, soft semantic clustering, plausible seed generation, plugin selection by textual affordance, and approximate planning. They are often much worse at faithfully maintaining a strict formal intermediate language over long horizons. In that sense, your shift is technically sensible.

A second strong point is that KUs are likely a better working abstraction than sentence-level facts and, in many cases, better than formally normalized micro-statements. A KU can be large enough to preserve semantic integrity yet small enough to be retrievable and reusable. This is important.

A third strength is pluralism of KB organization. In practice, there is rarely a single universally best chunking or indexing strategy. Allowing duplication across KB plugins and treating that as multi-view knowledge rather than waste is a good design choice, especially if different regimes exploit different organizations.

A fourth strength is that backtracking is no longer an afterthought. It is part of the control model. That is one of the most important ideas in your broader MRP view: meaning is not fixed at the first parse, and resolution requires trying alternative theories of the problem.

A fifth strength is that plugins can be semantically described by KUs. This is useful because plugin selection then becomes a knowledge-guided retrieval problem rather than a hardcoded dispatch table.

The deepest limits

The deepest limit is that you are replacing explicit structure with distributed soft structure. This can work, but it changes the nature of the system. Structure has not disappeared. It has merely been pushed into prompts, plugin descriptions, KU boundaries, retrieval heuristics, and local plan text. The result can be powerful, but much harder to inspect and stabilize.

The second deep limit is loss of canonicality. If the same content appears in several KB plugins with different KU boundaries and different semantic framing, then the system gains plurality but loses a single truth-maintaining center. This is acceptable only if you are comfortable treating the runtime as a search ecology rather than a canonical knowledge engine. If not, inconsistencies will become difficult to reason about.

The third limit is that natural language becomes both the representation and the control medium. This is convenient, but dangerous. Natural language is rich, flexible, and compressive, but it is also ambiguous, lossy, and unstable under iterative rewriting. Once both knowledge and local plans are mostly NL, you risk subtle drift across recursion depth.

The fourth limit is that validation becomes uneven. If each regime validates outputs differently, then global trust becomes difficult to define. You can still have useful outputs, but system-wide reliability becomes a statistical property rather than a clean semantic guarantee.

Main risks
Drift risk

Without SOP Lang IR or even a disciplined CNL, every recursive step risks slight reinterpretation of the problem. These small shifts accumulate. Eventually, a branch may still look coherent locally while no longer solving the original problem. This is one of the main dangers of NL-only recursive systems.

Hidden control logic

When the architecture is described as “plugin-based” and “NL-first,” it may sound flexible, but much of the real logic becomes hidden inside prompts, heuristics, ranking functions, and plugin interfaces. This makes it harder to know what the machine really is. In effect, the architecture may become less a VM and more a family of coupled heuristics with emergent behavior.

Evaluation opacity

If backtracking chooses among branches using mixed criteria such as plausibility, relevance, local consistency, and output usefulness, then it becomes hard to measure why one path was chosen over another. You can log it, but explaining it rigorously is harder than in a typed or rule-constrained system.

Recursive cost explosion

Recursive decomposition plus multi-plugin backtracking can grow very quickly in cost, latency, and branching factor. Even if each local step is reasonable, the total search space can become large. Without strong pruning and budget discipline, the architecture can become computationally expensive and behaviorally erratic.

KU instability

The KU abstraction is good, but only if KU boundaries are relatively stable and useful. If different plugins generate KUs that are too heterogeneous, then matching, reuse, and provenance become weak. You may end up with many useful local fragments but poor long-range compositionality.

Plugin semantic mismatch

If plugins are described by KUs and selected through semantic similarity or LLM judgment, then plugin invocation may be plausible but wrong in subtle ways. A plugin may appear semantically relevant yet be inappropriate for the required validation regime or data assumptions.

Weak provenance

Once the system is NL-first and multi-view, provenance becomes harder unless you explicitly engineer it. Otherwise, a final answer may depend on many soft transformations, paraphrases, intermediate KUs, and branch choices that are difficult to reconstruct cleanly.

What this architecture still needs in order to remain disciplined

Even if you abandon SOP Lang IR, I do not think you can safely abandon all structural normalization. You probably still need a very small set of stable internal objects, even if they are not full formal programs. For example, the system should probably preserve stable identifiers for problems, subproblems, KUs, plugin invocations, branch attempts, validations, and failures. Otherwise, the runtime becomes too fluid.

You also need explicit branch budgets and stopping criteria. A backtracking architecture without cost governance becomes unstable.

You need at least lightweight provenance. Not full formal proof, but enough to reconstruct which KUs, which plugins, which branch, and which validations produced a result.

You need a notion of KU quality. Not every extracted KU should have equal standing. Some may be source-grounded, some inferred, some speculative, some plugin-descriptive, some user-provided. Those differences matter.

You also need some notion of local semantic invariants. Even if all text remains NL, some constraints should survive recursion unchanged: the original goal, key entities, critical user constraints, hard exclusions, validation obligations, and maybe confidence thresholds.

My overall judgment

I think the current architecture is more realistic than the original one as an implementation strategy for near-term results. It fits how current LLMs are actually useful. It also fits your meta-rational thesis better than a rigid early formalization, because the runtime explicitly treats interpretation as exploratory, plural, and revisable.

But it also moves MRP-VM away from being a clearly specifiable virtual machine and toward being a controlled search-and-interpretation framework. That is not necessarily bad. It may even be the correct move. Still, you should recognize the conceptual cost: you gain empirical effectiveness and lose some semantic sharpness.

So my verdict is this. The architecture is coherent, plausible, and probably productive. Its main weakness is not that it is too informal in the abstract, but that informality can silently migrate into places where you still need discipline: identity, provenance, branch control, validation, and invariants. If those are kept explicit, the architecture can remain strong even without SOP Lang and without CNL. If they are not, the system risks becoming difficult to reason about, difficult to evaluate, and difficult to trust.

Compressed specification

A compact way to state the current MRP-VM would be the following.

MRP-VM is a plugin-oriented recursive interpretation runtime operating primarily over natural language rather than a canonical formal intermediate representation. It extracts intent-bearing seeds and pragmatic knowledge units from requests, context, and multiple parallel knowledge-base views. For each problem or subproblem, it constructs a local execution plan, retrieves or derives relevant KUs, and attempts resolution through alternative plugins corresponding to different interpretation regimes. Execution is recursive and backtracking-based: the runtime may revise decomposition, retrieval strategy, plugin choice, and local plan when a branch fails or yields weak validation. Multiple KB plugins may intentionally duplicate and reorganize knowledge differently, allowing parallel epistemic views rather than a single canonical store. Validation is regime-dependent and pragmatic, with results accepted when sufficiently supported by plugin-specific evidence, consistency, or usefulness criteria.

1. Compact but detailed description of the architecture

The current architecture is a plugin-centered recursive interpretation and resolution runtime operating over natural language and heterogeneous knowledge units rather than over a single canonical formal representation. Its purpose is to solve user problems by progressively extracting intentions, discovering relevant knowledge, constructing local plans, selecting appropriate interpretation regimes, and recursively resolving subproblems with backtracking when a path is weak, invalid, or unproductive.

A request enters the system in natural language. The first stage does not force immediate normalization into a rigid internal language. Instead, one or more ingestion plugins analyze the request and its surrounding context in order to identify distinct problem intentions, derive initial query seeds, and extract or propose candidate knowledge units. These outputs are not assumed to be final or uniquely correct. They are working hypotheses that define the first local search frontier.

The architecture is built around the concept of a Knowledge Unit. A Knowledge Unit is a bounded unit of usable knowledge, extracted or stored at a pragmatically useful granularity. A Knowledge Unit is not necessarily a sentence, a fact, a logical clause, or a formal object. It may represent a conceptual chunk, a procedural description, a constraint bundle, a capability description, a partial interpretation, a source-grounded statement, a derived pattern, or any other unit that a plugin can recognize and exploit. Different plugins may produce different Knowledge Units from the same source material, and this plurality is intentional rather than accidental.

Knowledge is not stored in a single canonical knowledge base. Instead, the system uses multiple knowledge plugins, each of which may organize, index, enrich, or reinterpret the same source material differently. One plugin may privilege semantic grouping, another procedural affordances, another retrieval efficiency, another structural decomposition, and another source fidelity. Duplication across plugins is acceptable because the architecture does not assume that there is one universally optimal representation of the same material. The runtime treats these parallel organizations as different epistemic views over the same broad informational domain.

In addition to ordinary knowledge content, plugins themselves are described by Knowledge Units. These plugin-descriptive units characterize what a plugin does, what kind of inputs it accepts, what ontological kinds of knowledge it understands, what kinds of outputs it can produce, what validation style it supports, and under what conditions it is likely to be useful. This allows plugin selection to be guided not only by hardcoded dispatch rules but also by semantically meaningful capability descriptions.

Once initial seeds and candidate Knowledge Units have been produced, the runtime attempts to construct a local execution horizon for the current problem. This horizon is not a full global plan and not a permanent representation. It is a temporary, revisable control object that captures the immediate problem interpretation, the most plausible subproblems, the available evidence, and the candidate solving directions. Planning at this stage may be assisted by language models, symbolic heuristics, plugin affordance matching, or combinations thereof.

The core operational step is recursive decomposition and regime selection. A problem is broken into smaller subproblems whenever direct resolution is too uncertain, too broad, or too costly. Each subproblem is then treated as a new interpretation target. For that subproblem, the runtime may generate refined seeds, retrieve or derive additional Knowledge Units, consult plugin descriptions, and select one or more solving plugins that correspond to different interpretation regimes. These regimes may include retrieval-centered resolution, procedural execution, symbolic checking, synthesis, comparison, transformation, verification, approximation, or other specialized forms of problem handling.

The runtime does not assume that the first chosen regime is correct. Instead, control proceeds through a form of interpretive search with backtracking. If a chosen branch produces a weak result, fails validation, cannot find sufficient evidence, encounters incompatible Knowledge Units, or reaches an unproductive dead end, the runtime can retreat and try an alternative decomposition, another seed, another knowledge view, another plugin, or another interpretation regime. This backtracking is not merely error recovery. It is part of the architecture’s core theory of operation: many problems do not have a uniquely obvious interpretation at the start, and useful resolution often requires trying multiple plausible local theories before one becomes sufficiently supported.

Validation is plural and regime-dependent. The architecture does not assume one universal proof notion. Instead, a result may be accepted because it satisfies symbolic constraints, matches source-grounded evidence, survives a comparison test, meets plugin-specific acceptance criteria, or reaches a threshold of practical adequacy under the current local objective. This means that the system’s reliability emerges from structured control over multiple partial validation methods rather than from one single formal criterion.

The architecture therefore has four central characteristics. It is natural-language-first, because it does not force all knowledge into a canonical formal encoding. It is plugin-centered, because plugins are the primary carriers of interpretation, retrieval, planning, and resolution capability. It is multi-view, because knowledge may exist in several parallel forms without forced unification. It is search-based, because solving is achieved through recursive decomposition, selective exploration, and backtracking across interpretations.

In concise technical terms, the system can be described as follows: it is a recursive runtime for problem resolution in which intentions, query seeds, and knowledge units are extracted from natural language context; multiple knowledge plugins maintain parallel, possibly overlapping organizations of usable knowledge; plugins are themselves semantically described and selectable; local plans guide short-horizon decomposition and resolution; subproblems are delegated to specialized interpretation regimes; and control advances through backtracking over seeds, knowledge views, plugins, and decompositions until a sufficiently supported result is found.

2. Where a CNL could help without forcing universal formalization

I think your intuition here is strong. A CNL should not be the universal representation of all knowledge. It should be used only where the architecture needs stable control surfaces. In your system, these surfaces are not the full content of knowledge, but the parts that coordinate search, dispatch, refusal, pruning, and validation.

The right principle is this: use CNL where the machine must make repeatable control decisions, not where it must preserve the richness of heterogeneous knowledge.

A. Intent formulation
A first good place for CNL is the formulation of problem intentions. The runtime should not force the original user request into a rigid structure, but after ingestion it can derive one or more normalized intent statements in a constrained form. These statements should capture only the elements relevant for orchestration: task type, target object, scope, constraints, required evidence style, expected output type, and possibly urgency or cost sensitivity.

This helps because the same user request can be phrased in many ways, but the runtime benefits from a stable intent object for branch comparison, decomposition, and planning. A symbolic planner or dispatcher can work over such intents without reinterpreting full natural language at every step.

B. Seed formulation
Seeds are an even better candidate for CNL. Seeds are already small, operational units. If they are represented in a constrained way, they become much easier to compare, refine, merge, split, rank, and hand over to plugins. A CNL seed does not need to express everything. It only needs to express the operational query direction clearly enough for retrieval and dispatch.

For example, a seed could be normalized around a small schema such as action, target, perspective, evidence need, and decomposition status. This would make seed management much more disciplined without formalizing all knowledge in the KB.

C. Local decomposition objects
The decomposition of a large problem into subproblems is another good area for partial CNL. I would not formalize the entire content of each subproblem, but I would formalize the role of the subproblem in the larger search. A subproblem should have at least a normalized statement of what it seeks, what it depends on, what kind of answer would count as success, and whether it is exploratory, verificatory, transformational, or executable.

This is valuable because backtracking becomes much cheaper if branches can be compared at the level of normalized decomposition objects rather than only by reading free text.

D. Plugin descriptions
This is one of the best uses of CNL. Plugin descriptions should be much more constrained than ordinary knowledge. A plugin is an operational object. It has capability boundaries. It should explicitly say what ontological categories of Knowledge Units it understands, what input form it expects, what output form it can produce, what validation style it supports, what failure modes are normal, and what it refuses immediately.

This is where symbolic dispatch can become useful. If plugin descriptions are expressed in a narrow CNL, the runtime can reject many impossible plugin calls without an LLM.

E. KU metadata, not KU content
I strongly agree that the right place for “ontological nature” is primarily in metadata around KUs, not in forcing all KUs themselves into formal syntax. A Knowledge Unit may remain natural language or otherwise heterogeneous, but it should carry metadata that tells the runtime what kind of thing it is.

This metadata could include, in some compact CNL or symbolic schema, fields such as ontological kind, source status, inferential status, domain, granularity, intended use, validation level, and plugin compatibility hints. Then a plugin can refuse immediately if it does not handle that ontological kind.

This is probably the most important selective formalization in your architecture. It allows fast pruning without flattening the epistemic richness of the knowledge itself.

F. Refusal and compatibility contracts
A plugin should not need to inspect arbitrary KU content in depth just to discover that it cannot operate on it. A narrow CNL layer can help define compatibility contracts. The plugin can declare the kinds of seeds, KU metadata, and subproblem forms it accepts, and the runtime can test those contracts symbolically before invoking it.

This reduces waste, accelerates backtracking, and decreases unnecessary LLM use.

Proposed selective CNL design

I would not define one large CNL. I would define a family of narrow control CNLs, each for a specific role.
One small CNL for normalized intents.
One small CNL for seeds.
One small CNL for subproblem descriptors.
One small CNL for plugin capability descriptions.
One small metadata vocabulary for KU typing and compatibility.

These CNLs should be minimal, shallow, and operational. They should not try to encode deep world knowledge. Their job is to stabilize control and reduce ambiguity at dispatch boundaries.

Proposed ontological metadata for Knowledge Units

A KU should probably carry at least the following metadata classes.
An ontological kind, indicating what sort of thing the KU is. For example: factual, procedural, definitional, capability, constraint, example, hypothesis, interpretation, evidence, source excerpt, comparison pattern, transformation rule, or validation criterion.
An epistemic status, indicating whether the KU is source-grounded, derived, inferred, speculative, user-provided, model-generated, plugin-generated, or validated.
A granularity marker, indicating whether the KU is atomic, composite, summary-level, local-detail, or cross-document synthetic.
A domain or regime affinity, indicating whether it is primarily useful for retrieval, symbolic checking, procedural execution, planning, comparison, synthesis, or validation.
A compatibility surface, indicating which plugin classes can consume it directly, which require transformation, and which should reject it.
This alone would greatly improve backtracking efficiency.

Architectural effect of this selective formalization

With this approach, the architecture remains pluralistic and natural-language-friendly, but it gains a fast symbolic shell around the most expensive control decisions. The language model is still used where semantic flexibility matters: interpreting requests, extracting candidate Knowledge Units, generating local plans, proposing decompositions, and synthesizing outputs. But symbolic components can take over where the task is mainly one of classification, compatibility checking, pruning, or routing over normalized control objects.

This seems exactly aligned with your goal: not to formalize all knowledge, but to formalize only those regions where the runtime benefits from stable structure and where symbolic equivalents can replace expensive or unstable language-model interpretation.

My opinion on the overall direction

I think this is a good move. The pluralistic architecture remains intact. You are not betraying it by adding CNL. You are adding a thin governance layer over it. The mistake would be to force all KUs into that layer. The correct use is to formalize only the control-relevant boundary objects.

So the architecture I would recommend is this: keep heterogeneous KUs as the main knowledge substrate, keep multi-plugin duplication and parallel epistemic views, keep recursive backtracking, but introduce narrow normalized control objects for intent, seed, decomposition, plugin capability, and KU metadata. That gives you faster refusal, faster dispatch, better pruning, lower LLM dependence, and more analyzable runtime behavior without destroying the flexibility that made the current implementation productive.

Requirements Specification for a Recursive Multi-Plugin Problem-Solving Runtime with Selective CNL Control Surfaces
1. Purpose
This document specifies a recursive problem-solving runtime that operates over natural language inputs, heterogeneous knowledge units, multiple knowledge and solver plugins, and a selective controlled natural language layer used only at control-critical boundaries. The system is intended to solve complex problems by iteratively extracting intentions, generating operational seeds, retrieving and producing knowledge units, selecting suitable interpretation regimes, decomposing problems into subproblems, and backtracking when a branch fails or becomes implausible.
The specification defines the system as a self-contained architecture. It does not assume a canonical global formal language for all knowledge. It assumes instead that only selected boundary objects are normalized through controlled natural language in order to improve dispatch, pruning, compatibility checking, backtracking efficiency, validation, and reproducibility.

2. System objective
The system shall transform an initial problem expressed in natural language into one or more sufficiently supported results through recursive interpretation and plugin-based search. The runtime shall avoid premature full formalization of knowledge while enforcing explicit structure at the points where stable control is needed.
The architecture shall support plural knowledge views, heterogeneous problem-solving regimes, partial failure, recursive decomposition, and selective symbolic control. It shall preserve flexibility for semantically rich knowledge while introducing disciplined invariants over intent statements, seeds, subproblem descriptors, plugin capability descriptors, and metadata attached to knowledge units.

3. Architectural principles
The system is based on six principles.
First, input interpretation is provisional. The first reading of a problem is not assumed to be final.
Second, useful knowledge can exist in multiple parallel representations. Duplication across plugins is acceptable if it improves retrieval or solving quality.
Third, problem solving proceeds through recursive local horizons rather than a single fixed global plan.
Fourth, backtracking is a primary control mechanism rather than an exception path.
Fifth, controlled natural language is used only where it improves control, not where it would damage representational richness.
Sixth, every control-relevant transition shall be governed by explicit compatibility rules and runtime invariants.

4. Main runtime entities
4.1 Problem
A problem is the current target of resolution. A problem may be the initial user request or a recursively produced subproblem. Every problem shall have a stable runtime identity.
A problem shall contain at least the following internal attributes: source text, current interpretation status, local goal, current constraints, parent problem if any, branch lineage, associated seeds, associated knowledge units, candidate plugins, local plan state, validation status, and termination status.

4.2 Knowledge Unit
A Knowledge Unit is a bounded unit of usable knowledge. A Knowledge Unit may contain free natural language, semi-structured data, extracted source content, derived interpretations, procedural descriptions, capability descriptions, evidence statements, constraints, hypotheses, or other forms of useful informational content.
A Knowledge Unit shall not be required to conform to a universal formal language. However, each Knowledge Unit shall carry mandatory metadata that supports control, filtering, compatibility, and provenance.

4.3 Seed
A seed is a compact operational representation of a problem direction. A seed expresses a query intent, hypothesis direction, decomposition axis, retrieval objective, or action-oriented subgoal. Seeds are control objects and shall be represented in controlled natural language.

4.4 Intent
An intent is a normalized statement of what the runtime is trying to obtain for the current problem horizon. An intent is not a full semantic paraphrase of the original request. It is a control-oriented description of the task, target, scope, required answer type, and major constraints. Intents shall be represented in controlled natural language.

4.5 Subproblem Descriptor
A subproblem descriptor is a controlled representation of a recursively generated problem fragment. It records what the subproblem seeks, how it relates to its parent, what evidence or output would count as success, and what regime types are plausible for it. Subproblem descriptors shall be represented in controlled natural language.

4.6 Plugin
A plugin is an operational component that performs a bounded class of functions. Plugins may ingest requests, derive intents or seeds, retrieve Knowledge Units, transform Knowledge Units, compare alternatives, validate branches, synthesize results, or solve subproblems under a particular interpretation regime.
Every plugin shall expose a capability descriptor in controlled natural language and a machine-readable interface for runtime compatibility checks.

4.7 Branch
A branch is a concrete attempt to solve a problem under a specific local interpretation, seed set, knowledge view, plugin sequence, and validation path. A branch is the unit of interpretive search and backtracking.

4.8 Local Plan
A local plan is a bounded control object for the current problem horizon. It does not represent the full computation. It records the current intent, active seeds, candidate subproblems, plausible regime choices, local ordering assumptions, and current stopping criteria.

5. Plugin classes
The runtime shall support several plugin classes.
An ingestion plugin analyzes natural language input and proposes normalized intents, initial seeds, candidate Knowledge Units, and possibly early subproblem boundaries.
A knowledge plugin stores, indexes, derives, or exposes Knowledge Units according to a particular organization strategy. Different knowledge plugins may represent the same source content differently.
A planning plugin proposes or refines local plans, branch priorities, decomposition strategies, and likely plugin candidates.
A solving plugin attempts direct resolution of a problem or subproblem under a specific interpretation regime.
A validation plugin evaluates whether a branch result is sufficient according to structural, evidential, procedural, or task-specific criteria.
A synthesis plugin combines validated partial results into larger results.
A refusal plugin or refusal mode may explicitly reject incompatible seeds, Knowledge Units, or subproblem forms without deeper processing.

6. Selective controlled natural language layer
6.1 General requirement
The system shall use controlled natural language only for control-critical objects. The system shall not require all Knowledge Units to be represented in controlled natural language. Controlled natural language shall be mandatory for intents, seeds, subproblem descriptors, plugin capability descriptors, and selected metadata declarations.

6.2 Purpose of the controlled layer
The controlled layer exists to enable stable routing, symbolic filtering, fast refusal, compatibility testing, branch comparison, branch pruning, reproducible decomposition, and explicit invariants across recursive steps.

6.3 Scope of the controlled layer
The controlled layer shall cover the following representational zones:
the normalized intent for each active problem;
the operational seeds attached to each branch;
the descriptor of each generated subproblem;
the capability descriptor of each plugin;
the ontological and epistemic metadata attached to each Knowledge Unit;
the local validation requirement declaration for each branch, when such a declaration is needed.

6.4 Non-scope of the controlled layer
The controlled layer shall not be imposed on arbitrary source excerpts, open-ended notes, rich explanations, literary content, ambiguous human discourse, or other Knowledge Unit bodies where forced normalization would destroy important meaning or produce unnecessary cost.

7. Controlled representations
7.1 Intent representation
An intent shall be a normalized control statement with at least the following fields: task kind, target, scope, expected result form, required evidence mode, and mandatory constraints.
A valid intent shall be singular enough to guide one local horizon. If multiple incompatible task kinds are present, separate intents shall be created.
An intent shall not contain unresolved pronouns, ambiguous referents, or incompatible task expectations.

7.2 Seed representation
A seed shall represent one operational direction only. A seed shall contain enough structure to support retrieval and dispatch without requiring full semantic reconstruction from the original problem text.
A seed shall declare at least the target of inquiry, the operation or perspective to be applied, and whether it is exploratory, confirmatory, corrective, comparative, or action-oriented.
Seeds shall be comparable and mergeable. Two seeds may be merged only if their task direction, target domain, and validation expectation are compatible.

7.3 Subproblem descriptor representation
A subproblem descriptor shall declare the parent problem, the local objective, the reason for decomposition, the expected completion signal, and the class of regimes considered plausible.
A subproblem descriptor shall not merely restate the parent problem. It shall narrow, isolate, or specialize some part of the parent objective.

7.4 Plugin capability descriptor representation
Each plugin shall declare in controlled language the following: plugin role, accepted input classes, accepted ontological types of Knowledge Units, accepted epistemic statuses if restricted, output form, supported validation style, refusal conditions, and cost profile if available.
A plugin capability descriptor shall be strict enough that the runtime can reject obvious incompatibilities without consulting a language model.

7.5 Knowledge Unit metadata representation
Each Knowledge Unit shall carry metadata with at least the following attributes.
It shall have an ontological kind. This indicates what sort of informational object it is, such as factual statement, procedural instruction, capability description, constraint, example, hypothesis, evidence excerpt, interpretation, comparison rule, or validation criterion.
It shall have an epistemic status. This indicates how the unit is positioned with respect to trust and origin, such as source-grounded, user-provided, plugin-derived, inferred, speculative, synthesized, or validated.
It shall have a granularity marker. This indicates whether it is atomic, composite, summary-level, local detail, or cross-source synthetic.
It shall have a regime affinity. This indicates which kinds of plugins or reasoning regimes are likely to consume it effectively.
It shall have compatibility annotations. These indicate which plugin classes may accept it directly, which require transformation, and which should reject it immediately.
It shall have provenance fields. These indicate where it came from and through which branch or plugin chain it was produced.

8. Runtime loop
8.1 Entry
The runtime shall receive a natural language request. It shall create an initial problem object and assign a stable identity.

8.2 Initial interpretation
One or more ingestion plugins shall analyze the request and produce candidate intents, seeds, and initial Knowledge Units. The runtime may keep several alternative interpretations if early disambiguation is weak.

8.3 Local horizon formation
The runtime shall select or construct a local horizon consisting of one active intent, a ranked seed set, currently relevant constraints, candidate Knowledge Units, candidate plugins, and stopping conditions.

8.4 Retrieval and filtering
Knowledge plugins shall retrieve or derive candidate Knowledge Units relevant to the active seeds and intent. Filtering shall first use metadata-level compatibility and refusal checks before deeper semantic processing.

8.5 Planning
A planning component shall propose a local plan. The local plan may include direct solving, decomposition, comparative evaluation of branches, or deferred validation. The plan may be proposed by an LLM, by symbolic heuristics, or jointly.

8.6 Plugin dispatch
Plugins shall be considered for dispatch based on the current intent, seed set, subproblem type, plugin capability descriptor, and Knowledge Unit metadata. Immediate formal refusal shall be preferred over deep semantic analysis when incompatibility is obvious.

8.7 Solving or decomposition
A selected plugin may attempt direct resolution or may produce one or more subproblem descriptors. If subproblems are produced, each subproblem enters the same loop recursively.

8.8 Validation
Each candidate result shall be checked against the branch’s declared validation needs. Validation may be symbolic, source-based, structural, procedural, or pragmatic, but it shall be explicit.

8.9 Backtracking
If a branch fails, becomes inconsistent, exceeds budget, cannot satisfy validation, or loses plausibility relative to alternatives, the runtime shall backtrack and attempt another branch.

8.10 Synthesis and termination
Validated partial results may be synthesized into larger results. The problem shall terminate when a result satisfies the active stopping criteria or when the runtime exhausts allowed strategies under the current budget and returns a bounded failure or partial result.

9. Invariants enabled by the controlled layer
The introduction of controlled natural language at selected boundaries enables explicit invariants. These invariants are mandatory because they reduce drift, improve dispatch precision, and preserve branch coherence.

9.1 Intent invariants
At every recursive level, there shall be at least one active intent in normalized form.
An active intent shall remain stable within a branch unless an explicit reinterpretation event is recorded.
A branch shall not silently drift from one task kind to another. If the task kind changes, a new intent shall be issued and linked to the previous one by a revision relation.
An intent shall preserve all hard constraints inherited from its ancestors unless a formal relaxation event is recorded.

9.2 Seed invariants
Every active seed shall be compatible with the active intent.
A seed shall represent one operational direction only. Conjunctive or ambiguous seeds shall be split before dispatch.
A seed shall not survive unchanged after repeated failed use if the failure reason implies structural incompatibility.
A seed shall be traceable to its generator and to the problem horizon in which it became active.

9.3 Subproblem invariants
Every subproblem shall narrow or specialize its parent problem in an explicit way.
A subproblem shall inherit the hard constraints of its parent unless it carries a justified scoped exception.
A subproblem shall declare what would count as completion before expensive solving begins.
No subproblem shall be created if its descriptor is semantically equivalent to the parent with no effective narrowing.

9.4 Plugin dispatch invariants
A plugin shall not be called unless its capability descriptor is compatible with the active intent or subproblem form.
A plugin shall be allowed to refuse immediately based on controlled metadata and capability mismatch.
A plugin shall not consume Knowledge Units whose ontological kind it explicitly rejects.
A plugin shall not produce outputs outside its declared output class without emitting a capability violation.

9.5 Knowledge Unit invariants
Every Knowledge Unit shall have mandatory metadata before it is admitted into the active branch memory.
The body of a Knowledge Unit may remain unconstrained, but its metadata shall be explicit enough to support routing and refusal.
A Knowledge Unit marked as source-grounded shall preserve source traceability.
A Knowledge Unit marked as speculative shall not be treated as validated evidence unless a validation event upgrades its status.
If a plugin transforms a Knowledge Unit, the new unit shall retain a provenance link to the original unit.

9.6 Branch invariants
Every branch shall maintain a stable identity, lineage, current intent, active seed set, and validation goal.
A branch shall record why it was created, why it was continued, and why it was pruned or accepted.
A branch shall not merge with another branch unless their active intents, inherited hard constraints, and validation expectations are compatible.

9.7 Validation invariants
Every accepted result shall have an explicit validation basis.
A result shall not be marked final if its validation basis is weaker than the minimum required by the active intent.
If validation is pragmatic rather than formal, the runtime shall record the criteria used and the reasons stricter validation was not available.

9.8 Backtracking invariants
Backtracking shall not erase the record of failed branches.
A failed branch shall produce a failure classification if possible. This classification may later inform pruning.
Repeated dispatch of structurally equivalent failed branches shall be prevented unless new evidence or altered constraints justify retry.

10. Rules for symbolic filtering and fast refusal
The controlled layer enables symbolic rejection before expensive interpretation. The system shall exploit this aggressively.
If a plugin descriptor states that it accepts only procedural Knowledge Units, then factual or literary units shall be rejected immediately at metadata level.
If a branch requires source-grounded evidence, speculative units shall not satisfy that requirement.
If a seed declares a comparative task, plugins that only produce direct synthesis without comparison support shall be deprioritized or rejected.
If a subproblem expects a validation criterion that a plugin cannot support, the plugin shall be rejected before invocation.
If an ontological kind is absent or unknown, the runtime may either route the Knowledge Unit to a typing plugin or treat it as low-trust and ineligible for strict branches.

11. Recursive control and budget rules
The runtime shall impose explicit budgets on recursion depth, branch count, plugin invocations, validation attempts, and synthesis cycles.
Every branch shall know its remaining budget.
The runtime shall prioritize branches according to plausibility, compatibility, evidence richness, and expected cost.
The runtime shall prefer pruning over uncontrolled expansion when many branches are weakly differentiated.
A planner may propose several branches, but only a bounded number shall be expanded at any point.
When the runtime cannot complete a problem under current budgets, it shall return the best bounded result available together with its validation status and unresolved points.

12. Failure classification
The runtime shall classify failures whenever possible. Failure classes shall include at least incompatibility, missing knowledge, missing plugin capability, unresolved ambiguity, invalid decomposition, validation failure, budget exhaustion, and branch degeneration.
Failure classification shall be reusable. It shall inform later pruning, seed rewriting, plugin selection, and decomposition policy.

13. Minimal symbolic kernel required by the architecture
Although the architecture remains primarily natural-language-based, it shall contain a small symbolic kernel for control. This kernel shall support identity management, metadata typing, compatibility checks, branch lineage tracking, invariant checks, budget accounting, refusal logic, and provenance linkage.
This symbolic kernel shall not attempt to encode all knowledge. It shall govern the search process around knowledge.

14. Expected benefits of the selective controlled layer
The selective controlled layer is expected to provide the following operational effects.
It reduces semantic drift across recursive steps because intents and subproblem roles remain normalized.
It reduces unnecessary language model calls because many incompatibilities can be detected symbolically.
It accelerates backtracking because failed or implausible branches can be rejected early.
It improves reproducibility because branch transitions and plugin calls become more stable.
It improves trust because accepted results must carry explicit validation bases and provenance links.
It preserves pluralism because rich Knowledge Unit bodies remain heterogeneous and open.

15. Non-goals
The architecture does not aim to force all knowledge into one ontology.
It does not aim to eliminate natural language from internal processing.
It does not aim to guarantee one universal proof notion for all problem types.
It does not assume a single best knowledge representation or a single best plugin regime.
It does not treat duplication across knowledge plugins as an error if that duplication improves search quality or regime diversity.

16. Concluding requirement statement
The system shall be implemented as a recursive, plugin-centered problem-solving runtime in which knowledge remains heterogeneous but control-critical objects are selectively normalized through controlled natural language. The runtime shall use these normalized objects to enforce compatibility, invariants, pruning, and provenance across recursive search. It shall allow multiple knowledge organizations and multiple solving regimes to coexist. It shall support explicit backtracking, explicit validation, and explicit refusal. It shall preserve representational flexibility where semantic richness is needed and impose formal discipline only where control efficiency and reliability require it.

Proposal for SOP Lang Control

This document proposes a small control language named SOP Lang Control. It is not a universal representation language for all knowledge. It is a compact textual language used only for runtime control, plugin description, seed management, branch coordination, validation targets, and a limited class of metadata-bearing Knowledge Units. Its purpose is to make recursive search, dispatch, pruning, refusal, and backtracking more efficient and more stable, without forcing heterogeneous knowledge into a single formal shape.

The core design decision is the following. Rich knowledge remains in ordinary natural language or in any other convenient representation. SOP Lang Control is introduced only at those boundaries where the runtime benefits from explicit structure and deterministic parsing. This keeps the architecture pluralistic while giving it a small symbolic kernel.

1. Role of SOP Lang Control

SOP Lang Control is the control membrane of the runtime. It is used where the machine must make repeatable decisions. It is not used where semantic richness matters more than uniformity.

It should be used for the following classes of objects.

Plugin-descriptive Knowledge Units should use it, because plugin selection must be fast and symbolic whenever possible. A plugin should declare what it can consume, what it can produce, what it refuses, and what validation styles it supports.

Seeds should use it, because seeds are operational objects rather than open-ended knowledge. A seed must be comparable, rankable, splittable, and rejectable without requiring repeated reinterpretation of free text.

Intents should use it, because each recursive horizon needs a stable statement of what is currently being pursued.

Subproblem descriptors should use it, because decomposition must be explicit enough to prevent recursive drift.

Validation targets should use it, because a branch should know what counts as success before expensive solving starts.

Branch records should use it, because backtracking requires branch lineage, failure memory, and explicit relation between problem, seed, plugin, and validation mode.

Knowledge Unit metadata may use it, but only for the metadata shell. The body of a Knowledge Unit does not need to be expressed in SOP Lang Control unless that unit is itself procedural or declarative in nature.

It may also be useful for planner outputs, but only for planner outputs that must be admitted into runtime state. A planner may reason in natural language internally, but once it proposes an operational object to the runtime, that object should be expressed in SOP Lang Control.

2. What SOP Lang Control is not

It is not a language for arbitrary source documents.

It is not a replacement for natural language storage.

It is not a deep ontology language.

It is not a proof language.

It is not intended to represent every Knowledge Unit.

It is a small language for creating stable control objects inside a recursive search runtime.

3. Core syntactic model

The language uses line-based statements of the form:

 @src/core/llm/bridge.mjs command arg1 arg2 arg3 ...

Each statement creates or updates one runtime object. Arguments may be literals, quoted strings, references to other objects, or small inline lists.

The reference form is:

$otherId

A block groups related statements:

 @block1 begin planning
  ...
 @end

The block is for grouping, scoping, and readability. It should not introduce hidden procedural semantics on its own. Any real semantics must still be expressed explicitly through commands and references.

The language is graph-oriented. Order may matter locally for readability and incremental authoring, but semantic dependency is carried primarily by explicit references.

4. Lexical rules

Identifiers start with @ when introduced and with $ when referenced.

Commands are lowercase keywords.

Atoms are unquoted tokens without whitespace.

Free text is always quoted.

Lists use square brackets.

Examples:

 @i1 intent explain "current architecture" full technical_note structural
 @s1 seed $i1 explore locate "plugin descriptors" runtime_control structural leaf
 @p1 plugin knowledge
 @p2 accepts_kind $p1 capability
 @p3 accepts_kind $p1 evidence
 @p4 rejects_kind $p1 literary
 @k1 ku capability plugin_declared atomic [dispatch planning] plugin_registry [knowledge planning] declared

5. Design principle of commands

The command vocabulary must remain small. The language becomes unstable if command proliferation turns it into a second natural language.

Commands should satisfy three conditions. They should correspond to real runtime objects or transitions. They should have fixed signatures. They should be parsable without an LLM.

The recommended base vocabulary is enough for the current architecture and should not be extended until there is repeated evidence of need.

6. Main command families
6.1 Intent commands

An intent states what the current horizon is trying to achieve.

Canonical constructor:

 @i1 intent <task> "<target>" <scope> <output> <evidence>

Example:

 @i1 intent explain "current architecture" full technical_note structural

Optional constraints are attached separately:

 @i2 constrain $i1 self_contained
 @i3 constrain $i1 precise
 @i4 constrain $i1 no_external_references

This split is deliberate. Constraints are additive and inherit well across recursive levels.

6.2 Seed commands

A seed is a small operational object used for retrieval, decomposition, routing, or solving.

Constructor:

 @s1 seed <intentRef> <mode> <action> "<focus>" <domain> <evidenceNeed> <state>

Example:

 @s1 seed $i1 explore locate "plugin capability descriptors" runtime_control structural leaf

A seed may be refined or split:

 @s2 split $s1 explore locate "plugin input kinds" runtime_control structural leaf
 @s3 split $s1 explore locate "plugin validation modes" runtime_control structural leaf

A seed may also be deactivated after repeated structural failure:

 @s4 deactivate $s1 plugin_mismatch

6.3 Subproblem commands

A subproblem records recursive decomposition explicitly.

Constructor:

 @sp1 subproblem <parentProblemRef> "<goal>" <reason> "<successSignal>"

Allowed regimes and constraints are attached separately:

 @sp2 allows $sp1 symbolic
 @sp3 allows $sp1 llm_assisted
 @sp4 constrain $sp1 deterministic_parse
 @sp5 constrain $sp1 minimal_syntax

This keeps the constructor short while preserving structure.

6.4 Plugin commands

A plugin is described by multiple small facts rather than one large record. This makes extension easier and fits the graph model better.

Plugin declaration:

 @p1 plugin knowledge

Capability declarations:

 @p2 accepts_task $p1 locate
 @p3 accepts_task $p1 compare
 @p4 accepts_mode $p1 explore
 @p5 accepts_mode $p1 confirm
 @p6 accepts_kind $p1 fact
 @p7 accepts_kind $p1 evidence
 @p8 accepts_kind $p1 capability
 @p9 accepts_status $p1 source_grounded
 @p10 accepts_status $p1 derived
 @p11 outputs $p1 summary
 @p12 outputs $p1 evidence
 @p13 validates $p1 source_trace
 @p14 validates $p1 structural_match
 @p15 cost $p1 medium
 @p16 rejects_kind $p1 literary
 @p17 rejects_rule $p1 missing_focus
 @p18 rejects_rule $p1 formal_proof_required

This representation is verbose in line count but simple in structure. Each line is easy to parse, compare, index, and edit.

6.5 KU metadata commands

The body of a KU may stay free. Its metadata should be structured.

Constructor:

 @k1 ku <kind> <status> <granularity> [affinity1 affinity2 ...] <sourceType> [compatTag1 compatTag2 ...] <validationLevel>

Example:

 @k1 ku capability plugin_declared atomic [dispatch planning] plugin_registry [knowledge planning] declared

Optional provenance and parent relations are attached separately:

 @k2 source_ref $k1 "PL-KB-02"
 @k3 created_by $k1 plugin_registry_loader
 @k4 parent $k1 $k0

If a KU is a plugin-descriptive KU, the metadata should also link to the plugin object it describes:

 @k5 describes $k1 $p1

6.6 Validation commands

Validation must be explicit per branch or per problem horizon.

Constructor:

 @v1 validate <mode> <strength> <partialAllowed> <preserveConstraints>

Example:

 @v1 validate structural_plus_source sufficient yes yes

A branch or problem links to it explicitly:

 @b1 needs $v1

6.7 Branch commands

A branch is a concrete attempt to solve a problem with a given intent, seed, plugin, and validation target.

Constructor:

 @b1 branch <problemRef> <intentRef> <seedRef> <pluginRef>

Attachments:

 @b2 needs $b1 $v1
 @b3 uses $b1 $k1
 @b4 uses $b1 $k2
 @b5 status $b1 active

If the branch fails:

 @b6 fail $b1 plugin_mismatch

If it succeeds:

 @b7 result $b1 $r1

6.8 Result commands

A result is linked explicitly, not inferred informally.

Constructor:

 @r1 result_record <kind> <validationStatus>

Attachments:

 @r2 supports $r1 $k10
 @r3 supports $r1 $k11
 @r4 preserves_constraints $r1 yes
 @r5 structural_complete $r1 yes
 @r6 body $r1 "Concrete specification produced and validated under structural_plus_source."

7. Recommended object patterns

A useful pattern is to treat each control object as one constructor line plus multiple refinement lines. This gives a good balance between compactness and extensibility.

For example, an intent is not one huge statement. It is a compact constructor plus constraint links. A plugin is not one overloaded line with twenty fields. It is one declaration plus a set of capability statements. A branch is one anchor plus relations. This fits both machine parsing and human editing better than either JSON or sentence-like CNL.

8. Minimal grammar

A simple grammar is enough.

A statement is one of:

statement := object_decl | relation_decl | block_open | block_close

An object declaration is:

 @src/core/llm/bridge.mjs command arg*

A relation declaration is just the same form; the distinction is semantic, not syntactic.

Arguments are one of:

an atom
a quoted string
a reference $id
a list [item1 item2 ...]

This grammar is intentionally weak at the syntax level. The real discipline comes from command signatures.

9. Command signatures

The parser should not merely parse tokens. It should validate command-specific arity and argument kinds.

For example, intent has signature:

intent <taskAtom> <quotedTarget> <scopeAtom> <outputAtom> <evidenceAtom>

seed has signature:

seed <intentRef> <modeAtom> <actionAtom> <quotedFocus> <domainAtom> <evidenceAtom> <stateAtom>

accepts_kind has signature:

accepts_kind <pluginRef> <kindAtom>

validate has signature:

validate <modeAtom> <strengthAtom> <yesNoAtom> <yesNoAtom>

This approach gives you a very small parser and a strong validator without needing a heavy formal grammar system.

10. Where SOP Lang Control is useful

Its primary use is in plugin-descriptive KUs. There the value is highest, because plugin selection is one of the main places where symbolic pruning can reduce LLM use.

Its second strong use is in seeds. A seed is a pure control object. Free natural language is unnecessary there except for the focus string.

Its third strong use is in intents and subproblems. Recursive systems drift unless each horizon has a stable control representation.

Its fourth strong use is in KU metadata. A plugin should be able to reject a KU from metadata alone if the KU is of a kind it cannot handle.

Its fifth strong use is in branch and failure memory. Backtracking becomes much more efficient when failure patterns are structured.

Its sixth use is in planner outputs that need to enter runtime state. The planner may think in free text, but admitted control objects should be normalized.

Its seventh use is in validation declarations. Different branches may need different validation modes; making this explicit avoids ad hoc acceptance.

11. Where it should not be forced

It should not be forced on source excerpts, long explanations, literary content, ambiguous knowledge, or open-ended conceptual notes. Those can remain free NL KUs with structured metadata.

It also should not be used to encode every inference step. If you try to use it as a proof calculus or as a universal semantic substrate, you will recreate the same overformalization problem that you are trying to avoid.

12. Concrete parsing model

The runtime parser should do only three things.

First, tokenize statements deterministically.

Second, validate signatures against the command table.

Third, build internal runtime objects and relations.

Internal storage can be normal language-native objects. The important point is that the visible authoring language is just SOP Lang Control.

A simple parser outline is enough:

function parseLine(line) {
  const tokens = tokenize(line);
  const id = tokens[0];
  const command = tokens[1];
  const args = tokens.slice(2);
  validateSignature(command, args);
  return buildNode(id, command, args);
}

The tokenizer only needs to recognize quoted strings, lists, atoms, and $ references.

13. Concrete runtime algorithms over SOP Lang Control
13.1 Initial intent and seed generation

An LLM may be used to propose intent and seed lines, but admission into runtime requires deterministic parsing.

Example output:

 @i1 intent design "SOP Lang Control specification" full technical_note structural
 @i2 constrain $i1 self_contained
 @i3 constrain $i1 precise
 @s1 seed $i1 explore locate "plugin descriptive objects" runtime_control structural leaf
 @s2 seed $i1 derive synthesize "command signatures" runtime_control structural leaf
 @s3 seed $i1 derive synthesize "dispatch algorithm" runtime_control structural leaf

The LLM is only a proposer. The parser and validator decide what enters state.

13.2 Plugin filtering

Because plugin descriptors are explicit, candidate filtering can be symbolic.

Suppose the runtime has seed $s1 and a set of KUs. For each plugin, it checks whether the plugin accepts the task, accepts the seed mode, accepts the KU kinds, and does not reject the status or required validation mode.

This means dispatch can run on structured relations instead of semantic similarity alone.

13.3 KU admission

A KU enters active branch memory only if it has structured metadata. If the body exists but metadata does not, the runtime routes it first to a typing step that produces the metadata shell.

Thus the runtime never operates on an untyped KU at control level.

13.4 Branch creation

A new solving attempt is explicitly materialized.

Example:

 @b1 branch $p_main $i1 $s1 $p1
 @b2 needs $b1 $v1
 @b3 uses $b1 $k12
 @b4 uses $b1 $k19
 @b5 status $b1 active

This makes branch lineage and failure tracking first-class.

13.5 Failure memory and backtracking

If a branch fails due to structural incompatibility, the runtime records it:

 @b6 fail $b1 plugin_mismatch

This matters because later the runtime can refuse to retry equivalent combinations of seed, plugin, and KU profile unless new evidence appears.

If a seed repeatedly leads to structural mismatches, it may be deactivated:

 @s4 deactivate $s1 repeated_structural_failure

13.6 Decomposition

If direct solving is weak, the planner or solver creates explicit subproblems.

 @sp1 subproblem $p_main "define plugin descriptor syntax" planner_requires_dispatch_stability "plugin descriptor lines parse deterministically"
 @sp2 allows $sp1 symbolic
 @sp3 constrain $sp1 minimal_syntax

These subproblems enter the same loop recursively.

13.7 Validation

Validation targets are explicit and branch-linked.

 @v1 validate structural sufficient yes yes
 @b2 needs $b1 $v1

A result is admitted only if the branch meets the linked validation requirements.

14. Invariants enabled by SOP Lang Control

The main reason to introduce the language is not style. It is invariants.

An intent cannot silently change task inside a branch. If the task changes, a new intent object must be created.

A seed cannot remain a vague free-text hint. It has a fixed mode, action, and focus, and is therefore comparable to other seeds.

A plugin cannot be invoked as a black box without a declared capability surface.

A KU cannot circulate through branches without at least a typed metadata shell.

A branch cannot succeed without an explicit validation target.

A failed branch cannot disappear into logs; it has a structured failure record.

A subproblem cannot be merely a paraphrase of the parent; it must have a distinct goal and success signal.

These invariants are exactly what the pluralistic architecture needs in order not to dissolve into uncontrolled NL search.

15. How plugin-descriptive KUs should look

This is one of the most important parts.

A plugin-descriptive KU should have two layers. Its body may remain explanatory natural language. Its control shell should be SOP Lang Control.

Example:

 @k1 ku capability plugin_declared atomic [dispatch planning] plugin_registry [planning knowledge] declared
 @k2 describes $k1 $p1
 @p1 plugin knowledge
 @p2 accepts_task $p1 locate
 @p3 accepts_task $p1 compare
 @p4 accepts_mode $p1 explore
 @p5 accepts_kind $p1 capability
 @p6 accepts_kind $p1 evidence
 @p7 outputs $p1 summary
 @p8 validates $p1 source_trace
 @p9 cost $p1 medium

And then separately the KU body can still exist in NL:

 @k10 body $k1 "This plugin retrieves source-grounded capability and evidence units from indexed KB shards and is appropriate for dispatch preparation and structured retrieval."

That is the right compromise. The machine reads the shell first. The human and the LLM may also inspect the body.

16. How seeds should look

Seeds should be sparse and operational.

Example:

 @s1 seed $i1 explore locate "plugin capability descriptors" runtime_control structural leaf
 @s2 seed $i1 derive synthesize "dispatch constraints" runtime_control structural leaf
 @s3 seed $i1 compare test "candidate plugin compatibility" runtime_control structural leaf

This is enough for ranking, splitting, routing, and refusal. A seed should not try to encode the whole reasoning task.

17. How KU metadata should look

KU metadata should be the smallest shell needed for routing.

Example:

 @k20 ku fact source_grounded atomic [retrieval validation] source_doc [knowledge validation] validated
 @k21 source_ref $k20 "doc-17:p3"
 @k22 body $k20 "The parser must reject malformed quoted strings."

The KU body remains free. The metadata allows symbolic control.

18. How the planner should interact with SOP Lang Control

The planner does not need to think in SOP Lang Control internally. It may use free reasoning. But when it proposes something for runtime admission, it should emit valid statements.

For example, if the planner decides that the problem should be decomposed, it should emit subproblem objects and not just prose saying decomposition is recommended.

This distinction is important. The planner is allowed to be semantically rich. The runtime state must remain structurally explicit.

19. Suggested minimal command set

A practical minimal set is enough.

For object creation: intent, seed, subproblem, plugin, ku, validate, branch, result_record.

For refinement and relation: constrain, accepts_task, accepts_mode, accepts_kind, accepts_status, rejects_kind, rejects_rule, outputs, validates, cost, allows, needs, uses, supports, source_ref, created_by, describes, parent, body, status.

For control transitions: split, deactivate, fail, result.

This is already sufficient for a strong first implementation.

20. Suggested implementation order

First, implement the tokenizer and command table.
Second, implement constructor and relation validation.
Third, implement plugin descriptors and symbolic dispatch filters.
Fourth, implement seed state transitions and failure memory.
Fifth, implement KU metadata admission and KU typing.
Sixth, implement recursive branch creation, subproblem generation, and validation linkage.
Seventh, only after that, integrate LLM prompts that emit SOP Lang Control lines.

This order matters because the language should discipline runtime behavior, not merely document it after the fact.

21. Final assessment

SOP Lang Control is useful precisely because it does less than a full intermediate representation. It does not try to absorb the whole epistemic content of the system. It only structures the parts that must remain stable under recursive search.

Used in plugin-descriptive KUs, seeds, intents, subproblems, validation targets, branch memory, and KU metadata, it gives the runtime a concrete symbolic shell. That shell is enough to support fast plugin refusal, typed branching, explicit failure memory, and more efficient backtracking. At the same time, the architecture remains pluralistic because actual knowledge bodies are not forced into the same language.
