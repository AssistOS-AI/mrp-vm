// Legacy compatibility bundle for rule-based SOP helper logic.
// Active built-in plugin wiring consumes explicit helper adapters from
// seed-detection/, context-normalization/, and response-rendering/.
import { createHash } from 'node:crypto';
import { LanguageProcessingMode } from './registry.mjs';
import { extractSymbolicFact } from '../nlp-util/symbolic-facts.mjs';
import { buildResponseDocument } from '../synthesis/response-document.mjs';
import { inferPhaseScopes } from '../knowledge/pragmatics.mjs';
import { ruleBasedSOPAnswerRenderingMethods } from './rule-based-sop/answer-rendering.mjs';
import {
  createSOPBuilder,
  renderSOPValue,
  sopRef
} from '../slc/sop.mjs';

// Simple rule-based NL→CNL for common patterns
const ACT_VERBS = {
  compare: ['compare', 'contrast', 'difference', 'versus', 'vs'],
  explain: ['explain', 'why', 'how', 'cause', 'reason'],
  recommend: ['recommend', 'suggest', 'advise', 'best'],
  diagnose: ['diagnose', 'problem', 'issue', 'debug', 'troubleshoot'],
  implement: ['implement', 'build', 'create', 'setup', 'configure', 'install'],
  verify: ['verify', 'check', 'validate', 'prove', 'confirm'],
  define: ['define', 'what is', 'meaning', 'definition'],
  evaluate: ['evaluate', 'assess', 'measure', 'rate', 'review'],
  identify: ['identify', 'who is', 'which one', 'where is', 'name the'],
  describe: ['describe', 'characterize', 'properties of', 'traits of', 'looks like']
};

function detectAct(text) {
  const lower = text.toLowerCase();
  for (const [act, verbs] of Object.entries(ACT_VERBS)) {
    for (const v of verbs) {
      if (lower.includes(v)) return act;
    }
  }
  return 'explain'; // default fallback
}

export class RuleBasedSOPMode extends LanguageProcessingMode {
  getId() { return 'symbolic-only'; }
  usesLLM() { return false; }
  supportsModelOverride() { return false; }
  getCapabilities() {
    return ['detect-seeds', 'normalize-persistent-context', 'synthesize-response'];
  }

  async detectSeedBundle({ rawNL }) {
    return {
      intentCNL: this._buildIntentCNL(rawNL),
      currentTurnContextCNL: this._buildSessionContextCNL(rawNL)
    };
  }

  async normalizeIntent({ rawNL }) {
    return { intentCNL: this._buildIntentCNL(rawNL) };
  }

  async extractSessionContext({ rawNL }) {
    return { contextCNL: this._buildSessionContextCNL(rawNL) };
  }

  _buildIntentCNL(rawNL) {
    const { questionText } = this._extractQuestionAppendix(rawNL);
    const sentences = this._segmentIntentPrompts(questionText || rawNL);
    const builder = createSOPBuilder();
    for (let i = 0; i < sentences.length; i += 1) {
      const sentence = this._normalizeFieldText(sentences[i]);
      if (!sentence) continue;
      const intentText = this._normalizeIntentPrompt(sentence) || sentence;
      const sentenceAct = detectAct(intentText);
      const outputType = this._deriveOutputType(sentence);
      const intentId = builder.nextId('i');
      builder.push(intentId, 'intent', sentenceAct, renderSOPValue(intentText, { forceQuoted: true }));
      builder.push(builder.nextId('is'), 'set', sopRef(intentId), 'output', renderSOPValue(outputType, { forceQuoted: true }));

      const seedId = builder.nextId('s');
      builder.push(seedId, 'seed', sopRef(intentId), 'direct', sentenceAct, renderSOPValue(intentText, { forceQuoted: true }));
      builder.push(builder.nextId('ss'), 'set', sopRef(seedId), 'domain', renderSOPValue('chat_turn'));
      builder.push(builder.nextId('ss'), 'set', sopRef(seedId), 'evidenceNeed', renderSOPValue('general'));
      builder.push(builder.nextId('ss'), 'set', sopRef(seedId), 'state', renderSOPValue('active'));
    }
    return builder.toString();
  }

  _buildSessionContextCNL(rawNL) {
    const { evidenceText, questionGuidance, questionText } = this._extractQuestionAppendix(rawNL);
    const contextSource = questionText ? evidenceText : rawNL;
    const sentences = this._splitIntoSentences(contextSource);
    const contextSentences = questionText
      ? sentences.filter(sentence => this._normalizeFieldText(sentence))
      : sentences.filter(s => this._shouldKeepContextSentence(s));
    if (contextSentences.length === 0) return '';

    const groups = this._groupRelatedSentences(contextSentences);
    const builder = createSOPBuilder();
    let unitIdx = 0;

    for (const group of groups) {
      const combinedText = this._normalizeFieldText(group.sentences.join('. ').replace(/\.\./g, '.'));
      const role = this._inferRole(combinedText);
      const act = detectAct(combinedText);
      const topic = this._normalizeFieldText(
        group.topic || combinedText.split(/\s+/).slice(0, 8).join(' ').replace(/[^\w\s-]/g, '')
      );
      const hash = createHash('sha256').update(`${combinedText}|${role}|${topic}`).digest('hex');
      const fact = extractSymbolicFact(group.sentences[0]);
      const kuType = group.sentences.length === 1 ? 'atomic' : 'composite';
      const phaseScopes = inferPhaseScopes({
        role,
        topic,
        claim: role === 'Procedure' ? null : combinedText,
        procedure: role === 'Procedure' ? combinedText : null,
        utilityActs: [act]
      });
      const unitId = `session::turn::unit-${String(unitIdx).padStart(3, '0')}`;
      const kuId = builder.nextId('k');
      builder.push(kuId, 'ku', kuType, renderSOPValue(unitId, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceId', renderSOPValue('session'));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkId', renderSOPValue('session::turn'));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceType', renderSOPValue('chat-turn'));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'role', renderSOPValue(role));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'topic', renderSOPValue(topic, { forceQuoted: true }));
      if (role === 'Procedure') {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'procedure', renderSOPValue(combinedText, { forceQuoted: true }));
      } else {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'claim', renderSOPValue(combinedText, { forceQuoted: true }));
      }
      if (fact && role !== 'Procedure') {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicSubject', renderSOPValue(fact.subject));
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicRelation', renderSOPValue(fact.relation));
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicObject', renderSOPValue(fact.object));
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'confidence', renderSOPValue(fact.confidence));
      }
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'utilityActs', renderSOPValue([act]));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'phaseScopes', renderSOPValue(phaseScopes));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'hash', renderSOPValue(hash));
      unitIdx++;
    }
    if (questionGuidance) {
      const combinedText = this._normalizeFieldText(questionGuidance);
      const role = 'Constraint';
      const act = 'recommend';
      const topic = this._normalizeFieldText(combinedText.substring(0, 60));
      const hash = createHash('sha256').update(`${combinedText}|${role}|${topic}`).digest('hex');
      const unitId = `session::turn::unit-${String(unitIdx).padStart(3, '0')}`;
      const kuId = builder.nextId('k');
      builder.push(kuId, 'ku', 'atomic', renderSOPValue(unitId, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceId', renderSOPValue('session'));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkId', renderSOPValue('session::turn'));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceType', renderSOPValue('chat-turn'));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'role', renderSOPValue(role));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'topic', renderSOPValue(topic, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'claim', renderSOPValue(combinedText, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'utilityActs', renderSOPValue([act]));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'phaseScopes', renderSOPValue(this._phaseScopesForQuestionGuidance(combinedText)));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'hash', renderSOPValue(hash));
    }

    return builder.toString();
  }

  async normalizePersistentContext({ chunkText, provenance }) {
    const { evidenceText, questionGuidance } = this._extractQuestionAppendix(chunkText);
    const sentences = this._splitIntoSentences(evidenceText);
    if (sentences.length === 0 && !questionGuidance) return { contextCNL: '' };

    // Separate fact-bearing sentences from non-fact sentences
    const tagged = sentences.map(s => ({ text: s, fact: extractSymbolicFact(s) }));

    // Build units: fact-bearing sentences become individual atomic KUs;
    // non-fact sentences are grouped by semantic coherence.
    const nonFactBuffer = [];
    const emitQueue = []; // { sentences, fact? }

    for (const t of tagged) {
      if (t.fact) {
        // Flush any buffered non-fact sentences as a group first
        if (nonFactBuffer.length > 0) {
          const groups = this._groupRelatedSentences([...nonFactBuffer]);
          for (const g of groups) emitQueue.push({ sentences: g.sentences, topic: g.topic, fact: null });
          nonFactBuffer.length = 0;
        }
        emitQueue.push({ sentences: [t.text], topic: t.text.substring(0, 60), fact: t.fact });
      } else {
        nonFactBuffer.push(t.text);
      }
    }
    if (nonFactBuffer.length > 0) {
      const groups = this._groupRelatedSentences([...nonFactBuffer]);
      for (const g of groups) emitQueue.push({ sentences: g.sentences, topic: g.topic, fact: null });
    }

    const builder = createSOPBuilder();
    let unitIdx = 0;
    for (const entry of emitQueue) {
      const unitId = `${provenance.sourceId}::${provenance.chunkId.split('::').pop()}::unit-${String(unitIdx).padStart(3, '0')}`;
      const combinedText = this._normalizeFieldText(entry.sentences.join('. ').replace(/\.\./g, '.'));
      const role = this._inferRole(combinedText);
      const acts = [detectAct(combinedText)];
      const topic = this._normalizeFieldText(entry.topic || combinedText.substring(0, 60));
      const hash = createHash('sha256').update(`${combinedText}|${role}|${topic}`).digest('hex');
      const kuType = entry.sentences.length === 1 ? 'atomic' : 'composite';
      const phaseScopes = inferPhaseScopes({
        role,
        topic,
        claim: role === 'Procedure' ? null : combinedText,
        procedure: role === 'Procedure' ? combinedText : null,
        utilityActs: acts
      });
      const kuId = builder.nextId('k');
      builder.push(kuId, 'ku', kuType, renderSOPValue(unitId, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceId', renderSOPValue(provenance.sourceId));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkId', renderSOPValue(provenance.chunkId));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'title', renderSOPValue(topic, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'role', renderSOPValue(role));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'topic', renderSOPValue(topic, { forceQuoted: true }));
      if (provenance.sourceName) {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceName', renderSOPValue(provenance.sourceName, { forceQuoted: true }));
      }
      if (provenance.createdAt) {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'ingestedAt', renderSOPValue(provenance.createdAt));
      }
      if (role === 'Procedure') {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'procedure', renderSOPValue(combinedText, { forceQuoted: true }));
      } else {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'claim', renderSOPValue(combinedText, { forceQuoted: true }));
        if (entry.fact) {
          builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicSubject', renderSOPValue(entry.fact.subject));
          builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicRelation', renderSOPValue(entry.fact.relation));
          builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicObject', renderSOPValue(entry.fact.object));
          builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'confidence', renderSOPValue(entry.fact.confidence));
        }
      }
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'utilityActs', renderSOPValue(acts));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'phaseScopes', renderSOPValue(phaseScopes));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'hash', renderSOPValue(hash));
      unitIdx++;
    }

    if (questionGuidance) {
      const combinedText = this._normalizeFieldText(questionGuidance);
      const role = 'Constraint';
      const acts = ['recommend'];
      const topic = this._normalizeFieldText(combinedText.substring(0, 60));
      const hash = createHash('sha256').update(`${combinedText}|${role}|${topic}`).digest('hex');
      const unitId = `${provenance.sourceId}::${provenance.chunkId.split('::').pop()}::unit-${String(unitIdx).padStart(3, '0')}`;
      const phaseScopes = this._phaseScopesForQuestionGuidance(combinedText);
      const kuId = builder.nextId('k');
      builder.push(kuId, 'ku', 'atomic', renderSOPValue(unitId, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceId', renderSOPValue(provenance.sourceId));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkId', renderSOPValue(provenance.chunkId));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'title', renderSOPValue(topic, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'role', renderSOPValue(role));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'topic', renderSOPValue(topic, { forceQuoted: true }));
      if (provenance.sourceName) {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceName', renderSOPValue(provenance.sourceName, { forceQuoted: true }));
      }
      if (provenance.createdAt) {
        builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'ingestedAt', renderSOPValue(provenance.createdAt));
      }
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'claim', renderSOPValue(combinedText, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'utilityActs', renderSOPValue(acts));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'phaseScopes', renderSOPValue(phaseScopes));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'hash', renderSOPValue(hash));
    }

    return { contextCNL: builder.toString() };
  }

  _inferRole(text) {
    if (/\b(answer|respond|output|format|json|yaml|xml|markdown|bullet|table|concise|brief)\b/i.test(text)) return 'Constraint';
    if (/\b(plan|planner|strategy|solver|plugin|method|choose|prefer)\b/i.test(text)) return 'Evaluation';
    if (/\bstep|procedure|install|configure|build|deploy\b/i.test(text)) return 'Procedure';
    if (/\bdefin|mean|is a\b/i.test(text)) return 'Definition';
    if (/\bcompar|versus|vs\b/i.test(text)) return 'Comparison';
    if (/\bcharacter|trait|appearance|personality|described as\b/i.test(text)) return 'Description';
    if (/\bstory|scene|event|happened|discovered|fled|began|triggered\b/i.test(text)) return 'Narrative';
    return 'Explanation';
  }

  _shouldKeepContextSentence(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return false;
    if (this._isTaskRequest(normalized)) return this._isGuidanceSentence(normalized);
    if (extractSymbolicFact(normalized)) return true;
    return /\b(is|are|use|have|has|deploy|run|prefer|need|require|want|live|exist|situated|located|must|should|answer|respond|format|json|yaml|xml|bullet|table|markdown|planner|plugin|solver|strategy|decompose|split|subtask|loop|validate|grounded)\b/i.test(normalized);
  }

  _isTaskRequest(text) {
    return /^\s*(explain|describe|compare|analyze|trace|construct|summarize|list|identify|name|recommend|suggest|verify|check|define|what|why|how|who|which|if|was|were|would|could|should)\b/i.test(text);
  }

  _isGuidanceSentence(text) {
    return /\b(answer|respond|output|format|json|yaml|xml|bullet|table|markdown|brief|concise|single word|yes\/no|planner|plugin|solver|strategy|decompose|split|subtask|loop|validate|grounded)\b/i.test(text);
  }

  _normalizeFieldText(text) {
    return String(text || '')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _stripQuestionEnumerator(text) {
    return String(text || '')
      .replace(/^\s*(?:q\s*\d+\s*[:.)-]\s*|\d+\s*[:.)-]\s*)/i, '')
      .trim();
  }

  _isOutputInstructionSentence(text) {
    return /\b(answer|respond|reply|return|format|output|json|yaml|xml|bullet|list|table|markdown|single word|one word|yes\/no|yes or no|step-by-step|step by step)\b/i.test(text);
  }

  _isSharedOutputInstruction(text) {
    return /\b(each|every|all|per question|for every question)\b/i.test(text)
      || /^\s*questions\b/i.test(text);
  }

  _normalizeIntentPrompt(text) {
    let normalized = this._stripQuestionEnumerator(this._normalizeFieldText(text));
    const instructionPatterns = [
      /(?:[.?!]\s*|^)(?:answer|respond|reply|return)\b[\s\S]*$/i,
      /\b(?:one|single)\s+word(?:\s+only)?[.!?]*$/i,
      /\byes\s*(?:\/|or)\s*no[.!?]*$/i,
      /\b(?:in|as)\s+(?:json|yaml|xml|markdown|a table|bullet(?:ed)? list)[.!?]*$/i
    ];
    for (const pattern of instructionPatterns) {
      if (!pattern.test(normalized)) continue;
      const stripped = normalized.replace(pattern, '').trim();
      if (stripped) normalized = stripped;
    }
    return normalized.trim();
  }

  _deriveOutputType(text) {
    const normalized = String(text || '').toLowerCase();
    const hints = [];
    if (/\b(single word|one word)\b/.test(normalized)) hints.push('one word');
    else if (/\byes\s*(?:\/|or)\s*no\b/.test(normalized)) hints.push('yes or no');
    if (/\bjson\b/.test(normalized)) hints.push('json');
    else if (/\btable\b/.test(normalized)) hints.push('table');
    else if (/\b(bullet|list)\b/.test(normalized)) hints.push('bullet list');
    if (/\b(step-by-step|step by step|trace every intermediate step)\b/.test(normalized)) hints.push('step-by-step');
    if (/\bbrief|concise|short\b/.test(normalized)) hints.push('brief');
    return hints.length > 0 ? hints.join(', ') : 'structured response';
  }

  _extractEnumeratedIntentPrompts(text) {
    const lines = String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (!lines.some(line => /^(?:q\s*\d+|\d+[.)])\s*[:.)-]?\s*/i.test(line))) return [];

    const prompts = [];
    const sharedGuidance = [];
    let current = '';
    for (const line of lines) {
      if (/^(?:q\s*\d+|\d+[.)])\s*[:.)-]?\s*/i.test(line)) {
        if (current) prompts.push(current.trim());
        current = line;
        continue;
      }
      if (!current && this._isOutputInstructionSentence(line)) {
        sharedGuidance.push(line);
        continue;
      }
      if (!current && /^\s*questions\b/i.test(line)) {
        if (this._isOutputInstructionSentence(line)) sharedGuidance.push(line);
        continue;
      }
      current = [current, line].filter(Boolean).join(' ');
    }
    if (current) prompts.push(current.trim());
    if (sharedGuidance.length > 0) {
      const sharedText = sharedGuidance.join(' ');
      return prompts.map(prompt => `${prompt} ${sharedText}`.trim());
    }
    return prompts;
  }

  _segmentIntentPrompts(text) {
    const enumerated = this._extractEnumeratedIntentPrompts(text);
    if (enumerated.length > 0) return enumerated;

    const sentences = this._splitIntoSentences(text);
    if (sentences.length <= 1) {
      const normalized = this._normalizeFieldText(text);
      return normalized ? [normalized] : [];
    }

    if (!this._shouldSplitSentencePrompts(sentences)) {
      const normalized = this._normalizeFieldText(text);
      return normalized ? [normalized] : [];
    }

    const prompts = [];
    const sharedGuidance = [];
    for (const sentence of sentences) {
      const normalized = this._normalizeFieldText(sentence);
      if (!normalized) continue;
      if (this._isOutputInstructionSentence(normalized)) {
        if (!prompts.length) continue;
        if (this._isSharedOutputInstruction(normalized)) {
          sharedGuidance.push(normalized);
        } else {
          prompts[prompts.length - 1] = `${prompts[prompts.length - 1]} ${normalized}`.trim();
        }
        continue;
      }
      prompts.push(this._stripQuestionEnumerator(normalized));
    }
    if (!prompts.length) {
      const normalized = this._normalizeFieldText(text);
      return normalized ? [normalized] : [];
    }
    if (sharedGuidance.length > 0) {
      const sharedText = sharedGuidance.join(' ');
      return prompts.map(prompt => `${prompt} ${sharedText}`.trim());
    }
    return prompts;
  }

  _shouldSplitSentencePrompts(sentences) {
    const normalizedSentences = (sentences || [])
      .map(sentence => this._normalizeFieldText(sentence))
      .filter(Boolean);
    const semanticSentences = normalizedSentences.filter(
      sentence => !this._isOutputInstructionSentence(sentence)
    );
    if (semanticSentences.length <= 1) return false;
    return semanticSentences.every(sentence => this._isStandaloneQuestionSentence(sentence));
  }

  _isStandaloneQuestionSentence(text) {
    return /[?]\s*$/.test(text)
      || /^(?:who|what|why|how|when|where|which|is|are|am|was|were|do|does|did|can|could|would|should|will|have|has|had|may|might)\b/i.test(text);
  }

  _splitIntoSentences(text) {
    const normalized = String(text || '')
      .replace(/\r/g, '')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];
    const protectedText = normalized
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs)\./g, '$1__DOT__');
    return protectedText
      .split(/(?<=[.!?])\s+(?=(?:["'(\[]?[A-Z0-9]|$))/)
      .map(sentence => sentence.replace(/__DOT__/g, '.').trim())
      .filter(Boolean);
  }

  _extractQuestionAppendix(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const headerIndex = lines.findIndex(line => /^\s*Questions\b/i.test(line));
    if (headerIndex < 0) {
      return { evidenceText: text, questionText: null, questionGuidance: null };
    }
    const evidenceText = lines.slice(0, headerIndex).join('\n').trim();
    const appendixLines = lines
      .slice(headerIndex)
      .map(line => line.trim())
      .filter(Boolean);
    const guidanceLines = appendixLines.filter(
      line => !/^(?:q\s*\d+|\d+[.)])\s*[:.)-]?\s*/i.test(line)
    );
    return {
      evidenceText,
      questionText: appendixLines.join('\n'),
      questionGuidance: guidanceLines.join(' ').trim() || appendixLines[0] || null
    };
  }

  _phaseScopesForQuestionGuidance(text) {
    const scopes = new Set(['gs-plugin']);
    if (/\b(grounded|evidence|verify|validate|validation)\b/i.test(text)) scopes.add('val-plugin');
    if (/\b(step|trace|intermediate|first\b.*\bthen)\b/i.test(text)) scopes.add('frame');
    return [...scopes];
  }

  _groupRelatedSentences(sentences) {
    if (sentences.length <= 2) {
      return [{ sentences, topic: sentences[0]?.substring(0, 60) || '' }];
    }
    // Extract key subjects from each sentence
    const tagged = sentences.map(s => ({
      text: s,
      subjects: this._extractSubjects(s),
      topic: s.split(/\s+/).slice(0, 6).join(' ')
    }));

    const groups = [];
    let current = { sentences: [tagged[0].text], subjects: new Set(tagged[0].subjects), topic: tagged[0].topic };

    for (let i = 1; i < tagged.length; i++) {
      const t = tagged[i];
      // Check if this sentence shares subjects with current group
      const shared = t.subjects.some(s => current.subjects.has(s));
      // Also check if consecutive sentences are about the same scene/event
      const sameContext = this._sameNarrativeContext(current.sentences[current.sentences.length - 1], t.text);

      if (shared || sameContext) {
        current.sentences.push(t.text);
        t.subjects.forEach(s => current.subjects.add(s));
      } else {
        groups.push({ sentences: current.sentences, topic: current.topic });
        current = { sentences: [t.text], subjects: new Set(t.subjects), topic: t.topic };
      }
    }
    groups.push({ sentences: current.sentences, topic: current.topic });
    return groups;
  }

  _extractSubjects(sentence) {
    // Extract capitalized proper nouns and key noun phrases
    const subjects = [];
    const properNouns = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    for (const pn of properNouns) {
      if (!/^(The|This|That|These|Those|Here|There|When|Where|What|How|Why|Who|But|And|Or|If|So|Yet|For|Not|No|Yes|Please|Can|Could|Would|Should|May|Might|Must|Will|Shall|Do|Does|Did|Has|Have|Had|Is|Are|Was|Were|Be|Been|Being|A|An|In|On|At|To|Of|By|With|From|Into|About|After|Before|During|Without|Between|Through|Against|Upon|Along|Across|Behind|Beyond|Under|Over|Above|Below|Near|Far|Away|Back|Out|Up|Down)$/.test(pn)) {
        subjects.push(pn.toLowerCase());
      }
    }
    // Also extract subjects from "X uses Y", "X depends on Y" patterns
    const fact = extractSymbolicFact(sentence);
    if (fact) {
      subjects.push(fact.subject.toLowerCase());
      subjects.push(fact.object.toLowerCase());
    }
    return [...new Set(subjects)];
  }

  _sameNarrativeContext(prev, current) {
    // Pronouns or continuation markers suggest same context
    if (/^(He|She|It|They|This|The|His|Her|Its|Their)\b/.test(current)) return true;
    if (/^(Meanwhile|However|Furthermore|Moreover|Also|Then|Next|After|Before|During)\b/.test(current)) return true;
    return false;
  }

  async synthesizeResponse({ sessionId, resolvedIntents, pluginOutputs, guidanceUnits = [] }) {
    let md = `# MRP Response\nSession: ${sessionId}\n\n`;
    const answersByIntentRef = {};
    const statusByIntentRef = {};
    const sharedGuidanceProfile = this._buildGuidanceProfile(guidanceUnits);
    for (const ri of resolvedIntents) {
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      const hasEvidence = ri.sessionUnits.length > 0 || ri.kbUnits.length > 0 || ri.currentTurnContextUnits.length > 0;
      const status = po?.status === 'error' ? 'plugin-error' : hasEvidence ? 'answered' : 'no-context';
      let effectiveStatus = status;
      const localGuidanceProfile = this._buildGuidanceProfile(
        this._filterGuidanceUnitsForIntent(ri.guidanceUnits?.goalSolver || [], ri)
      );
      const guidanceProfile = this._mergeGuidanceProfiles(sharedGuidanceProfile, localGuidanceProfile);
      md += `## Intent Group ${ri.intentRef}\nAct: ${ri.decomposed.act}\nIntent: ${ri.decomposed.intent}\nStatus: ${status}\n\n`;
      if (ri.currentTurnContextUnits.length > 0) {
        md += `### Current-Turn Context\n`;
        for (const u of ri.currentTurnContextUnits) md += `#### ${u.id}\nRole: ${u.role}\nClaim: ${u.claim || u.procedure || ''}\n\n`;
      }
      if (ri.sessionUnits.length > 0) {
        md += `### Session Context\n`;
        for (const s of ri.sessionUnits) {
          md += `#### ${s.unitId} (score: ${this._formatSourceScore(s.score)})\nRole: ${s.unit?.role || ''}\nClaim: ${s.unit?.claim || s.unit?.procedure || ''}\n\n`;
        }
      }
      if (ri.kbUnits.length > 0) {
        md += `### Persistent KB Context\n`;
        for (const s of ri.kbUnits) {
          md += `#### ${s.unitId} (score: ${this._formatSourceScore(s.score)})\nRole: ${s.unit?.role || ''}\nSource: ${s.unit?.sourceId || ''}\nClaim: ${s.unit?.claim || s.unit?.procedure || ''}\n\n`;
        }
      }
      if (po?.status === 'success') {
        md += `### Plugin Evidence\nPlugin: ${po.pluginName}\nConfidence: ${po.confidence}\nResult: ${po.resultCNL}\n\n`;
      }
      // Build per-group answer block
      let groupAnswer = '';
      if (status === 'answered') {
        const allClaimsRaw = [
          ...ri.currentTurnContextUnits.map(u => u.claim || u.procedure),
          ...ri.sessionUnits.map(s => s.unit?.claim || s.unit?.procedure),
          ...ri.kbUnits.map(s => s.unit?.claim || s.unit?.procedure)
        ].filter(Boolean);
        // Deduplicate claims to avoid repeated content in answers
        const allClaims = [...new Set(allClaimsRaw)];
        const rendered = this._renderGuidedAnswer(allClaims, guidanceProfile, ri);
        groupAnswer = rendered.answer;
        effectiveStatus = rendered.status || effectiveStatus;
      } else if (status === 'no-context') {
        groupAnswer = guidanceProfile.json
          ? `\`\`\`json\n${JSON.stringify({ status: 'no-context', answer: 'The session context and persistent KB do not contain enough evidence to answer this intent.' }, null, 2)}\n\`\`\``
          : 'The session context and persistent KB do not contain enough evidence to answer this intent.';
      } else if (status === 'plugin-error') {
        groupAnswer = `Plugin execution failed: ${po?.error?.message || 'unknown error'}`;
      }
      answersByIntentRef[ri.intentRef] = groupAnswer;
      statusByIntentRef[ri.intentRef] = effectiveStatus;
      md += `### Answer\n${groupAnswer}\n\n`;
      md += `### Sources Used\n`;
      for (const u of ri.currentTurnContextUnits) md += `- ${u.id}\n`;
      for (const s of ri.sessionUnits) md += `- ${s.unitId}\n`;
      for (const s of ri.kbUnits) md += `- ${s.unitId}\n`;
      md += '\n';
    }
    return {
      responseDocument: buildResponseDocument(
        sessionId,
        resolvedIntents,
        pluginOutputs,
        answersByIntentRef,
        statusByIntentRef
      ),
      responseMarkdown: md
    };
  }

}

Object.assign(RuleBasedSOPMode.prototype, ruleBasedSOPAnswerRenderingMethods);

export { RuleBasedSOPMode as RuleBasedSOPStrategy };
export { RuleBasedSOPMode as SymbolicOnlyStrategy };
