// DS022 — Symbolic-Only Strategy
import { createHash } from 'node:crypto';
import { LanguageProcessingStrategy } from './registry.mjs';
import { extractSymbolicFact } from '../knowledge/symbolic-facts.mjs';
import { buildResponseDocument } from '../synthesis/response-document.mjs';
import { inferPhaseScopes } from '../knowledge/pragmatics.mjs';

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

export class SymbolicOnlyStrategy extends LanguageProcessingStrategy {
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
    const act = detectAct(rawNL);
    const sentences = rawNL.length < 200 ? [this._normalizeFieldText(rawNL)] : this._splitIntoSentences(rawNL);
    return sentences.map((s, i) => {
      const a = i === 0 ? act : detectAct(s);
      return `## Intent Group ${i + 1}\nAct: ${a}\nIntent: ${s}\nOutput: Structured response.`;
    }).join('\n\n');
  }

  _buildSessionContextCNL(rawNL) {
    const sentences = this._splitIntoSentences(rawNL);
    const contextSentences = sentences.filter(s => this._shouldKeepContextSentence(s));
    if (contextSentences.length === 0) return '';

    const groups = this._groupRelatedSentences(contextSentences);
    const units = [];
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
      let md = `## Context Unit session::turn::unit-${String(unitIdx).padStart(3, '0')}\nSourceId: session\nChunkId: session::turn\nKUType: ${kuType}\nSourceType: chat-turn\nRole: ${role}\nTopic: ${topic}\n`;
      if (role === 'Procedure') md += `Procedure: ${combinedText}\n`;
      else md += `Claim: ${combinedText}\n`;
      if (fact && role !== 'Procedure') {
        md += `Subject: ${fact.subject}\nRelation: ${fact.relation}\nObject: ${fact.object}\nConfidence: ${fact.confidence}\n`;
      }
      md += `UtilityActs: ${act}\nPhaseScopes: ${phaseScopes.join(', ')}\nHash: ${hash}`;
      units.push(md);
      unitIdx++;
    }
    return units.join('\n\n');
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

    const units = [];
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
      let md = `## Context Unit ${unitId}\nSourceId: ${provenance.sourceId}\nChunkId: ${provenance.chunkId}\nKUType: ${kuType}\nTitle: ${topic}\nRole: ${role}\nTopic: ${topic}\n`;
      if (provenance.sourceName) md += `SourceName: ${provenance.sourceName}\n`;
      if (provenance.createdAt) md += `IngestedAt: ${provenance.createdAt}\n`;
      if (role === 'Procedure') {
        md += `Procedure: ${combinedText}\n`;
      } else {
        md += `Claim: ${combinedText}\n`;
        if (entry.fact) {
          md += `Subject: ${entry.fact.subject}\nRelation: ${entry.fact.relation}\nObject: ${entry.fact.object}\nConfidence: ${entry.fact.confidence}\n`;
        }
      }
      md += `UtilityActs: ${acts.join(', ')}\nPhaseScopes: ${phaseScopes.join(', ')}\nHash: ${hash}`;
      units.push(md);
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
      let md = `## Context Unit ${unitId}\nSourceId: ${provenance.sourceId}\nChunkId: ${provenance.chunkId}\nKUType: atomic\nTitle: ${topic}\nRole: ${role}\nTopic: ${topic}\n`;
      if (provenance.sourceName) md += `SourceName: ${provenance.sourceName}\n`;
      if (provenance.createdAt) md += `IngestedAt: ${provenance.createdAt}\n`;
      md += `Claim: ${combinedText}\n`;
      md += `UtilityActs: ${acts.join(', ')}\nPhaseScopes: ${phaseScopes.join(', ')}\nHash: ${hash}`;
      units.push(md);
    }

    return { contextCNL: units.join('\n\n') };
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
      return { evidenceText: text, questionGuidance: null };
    }
    const evidenceText = lines.slice(0, headerIndex).join('\n').trim();
    const appendixLines = lines
      .slice(headerIndex)
      .map(line => line.trim())
      .filter(Boolean);
    return {
      evidenceText,
      questionGuidance: appendixLines[0] || null
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
    const guidanceProfile = this._buildGuidanceProfile(guidanceUnits);
    for (const ri of resolvedIntents) {
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      const hasEvidence = ri.sessionUnits.length > 0 || ri.kbUnits.length > 0 || ri.currentTurnContextUnits.length > 0;
      const status = po?.status === 'error' ? 'plugin-error' : hasEvidence ? 'answered' : 'no-context';
      let effectiveStatus = status;
      md += `## Intent Group ${ri.intentRef}\nAct: ${ri.decomposed.act}\nIntent: ${ri.decomposed.intent}\nStatus: ${status}\n\n`;
      if (ri.currentTurnContextUnits.length > 0) {
        md += `### Current-Turn Context\n`;
        for (const u of ri.currentTurnContextUnits) md += `#### ${u.id}\nRole: ${u.role}\nClaim: ${u.claim || u.procedure || ''}\n\n`;
      }
      if (ri.sessionUnits.length > 0) {
        md += `### Session Context\n`;
        for (const s of ri.sessionUnits) md += `#### ${s.unitId} (score: ${s.score.toFixed(2)})\nRole: ${s.unit?.role || ''}\nClaim: ${s.unit?.claim || s.unit?.procedure || ''}\n\n`;
      }
      if (ri.kbUnits.length > 0) {
        md += `### Persistent KB Context\n`;
        for (const s of ri.kbUnits) md += `#### ${s.unitId} (score: ${s.score.toFixed(2)})\nRole: ${s.unit?.role || ''}\nSource: ${s.unit?.sourceId || ''}\nClaim: ${s.unit?.claim || s.unit?.procedure || ''}\n\n`;
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

  _buildGuidanceProfile(guidanceUnits = []) {
    const text = guidanceUnits
      .map(entry => entry?.unit?.claim || entry?.unit?.procedure || '')
      .join(' ')
      .toLowerCase();
    return {
      json: /\bjson\b/.test(text),
      bullets: /\b(bullet|list)\b/.test(text),
      brief: /\b(brief|concise|short)\b/.test(text),
      stepByStep: /\b(step-by-step|step by step)\b/.test(text),
      singleWord: /\b(single word|one word)\b/.test(text),
      yesNo: /\b(yes\/no|yes or no)\b/.test(text)
    };
  }

  _renderGuidedAnswer(claims, guidanceProfile, resolvedIntent = null) {
    const intentText = [
      resolvedIntent?.decomposed?.intent || '',
      resolvedIntent?.decomposed?.outputType || ''
    ].join(' ').toLowerCase();
    const wantsSingleWord = guidanceProfile.singleWord || /\b(single word|one word)\b/.test(intentText);
    const wantsYesNo = guidanceProfile.yesNo || /\b(yes or no|yes\/no)\b/.test(intentText);
    const act = resolvedIntent?.decomposed?.act || '';

    // Handle identify questions first - these want a name, not Yes/No
    if (act === 'identify' && wantsSingleWord) {
      const answer = this._inferSingleWordIdentity(claims, resolvedIntent);
      if (answer) return { answer, status: 'answered' };
      return { answer: 'Insufficient context to determine the answer.', status: 'no-context' };
    }

    // For constrained answer formats, fail fast when symbolic confidence is low.
    if (wantsYesNo || wantsSingleWord) {
      return { answer: 'Insufficient context to determine the answer.', status: 'no-context' };
    }

    const selectedClaims = guidanceProfile.brief ? claims.slice(0, 3) : claims;
    const normalizedClaims = guidanceProfile.stepByStep
      ? selectedClaims.map((claim, index) => `Step ${index + 1}: ${claim}`)
      : selectedClaims;
    if (guidanceProfile.json) {
      return { answer: `\`\`\`json\n${JSON.stringify({
        status: 'answered',
        answer: normalizedClaims,
        format: guidanceProfile.stepByStep ? 'step-by-step' : guidanceProfile.bullets ? 'bullets' : 'plain'
      }, null, 2)}\n\`\`\``, status: 'answered' };
    }
    if (guidanceProfile.bullets || guidanceProfile.stepByStep || normalizedClaims.length > 1) {
      return { answer: `Based on the available evidence:\n${normalizedClaims.map(claim => `- ${claim}`).join('\n')}\n`, status: 'answered' };
    }
    return { answer: normalizedClaims[0] || 'Based on the available evidence.', status: 'answered' };
  }

  _inferSingleWordIdentity(claims, resolvedIntent) {
    const queryTerms = new Set(
      String(resolvedIntent?.decomposed?.intent || '')
        .toLowerCase()
        .split(/\s+/)
        .map(term => term.replace(/[^\w-]/g, ''))
        .filter(term => term && !['name', 'single', 'one', 'word', 'whose', 'would', 'could', 'should', 'character'].includes(term))
    );
    // Block common nouns that aren't character names - these are generic place/thing/concept words
    const blockedWords = new Set([
      // Geographic/location terms
      'desert', 'abyss', 'city', 'ocean', 'mountain', 'valley', 'forest', 'river',
      'planet', 'galaxy', 'world', 'region', 'area', 'zone', 'sector',
      // Common object/thing words
      'core', 'artifact', 'device', 'machine', 'system', 'network', 'shield',
      // Organization/group words
      'syndicate', 'guild', 'order', 'council', 'alliance', 'empire', 'federation',
      // Generic descriptors that might get capitalized
      'the', 'a', 'an', 'this', 'that'
    ]);
    const candidates = new Map();

    for (const claim of claims) {
      const claimText = String(claim || '');
      const claimLower = claimText.toLowerCase();
      const overlap = [...queryTerms].filter(term => claimLower.includes(term)).length;
      const matches = claimText.match(/\b(?:Commander|Dr\.?|Doctor)?\s*[A-Z][a-zA-Z0-9-]*(?:\s+[A-Z][a-zA-Z0-9-]*)*/g) || [];
      for (const raw of matches) {
        const phrase = raw.trim().replace(/\s+/g, ' ');
        if (!phrase) continue;
        if (String(resolvedIntent?.decomposed?.intent || '').includes(phrase)) continue;
        const parts = phrase.split(/\s+/).filter(Boolean);
        const answer = parts[parts.length - 1];
        const answerLower = answer.toLowerCase();
        if (!answer || blockedWords.has(answerLower)) continue;
        const score = overlap + (/\b(Commander|Dr\.?|Doctor)\b/.test(phrase) ? 1 : 0);
        const current = candidates.get(answer) || 0;
        candidates.set(answer, current + Math.max(1, score));
      }
    }

    return [...candidates.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([answer]) => answer)[0] || null;
  }
}
