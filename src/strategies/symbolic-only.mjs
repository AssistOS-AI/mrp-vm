// DS022 — Symbolic-Only Strategy
import { createHash } from 'node:crypto';
import { LanguageProcessingStrategy } from './registry.mjs';
import { extractSymbolicFact } from '../lib/symbolic-facts.mjs';
import { buildResponseDocument } from '../synthesis/response-document.mjs';

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
    return ['normalize-intent', 'extract-session-context', 'normalize-persistent-context', 'synthesize-response'];
  }

  async normalizeIntent({ rawNL }) {
    const act = detectAct(rawNL);
    const sentences = rawNL.length < 200 ? [rawNL] : rawNL.split(/[.?!]+/).map(s => s.trim()).filter(Boolean);
    const intentCNL = sentences.map((s, i) => {
      const a = i === 0 ? act : detectAct(s);
      return `## Intent Group ${i + 1}\nAct: ${a}\nIntent: ${s}\nOutput: Structured response.`;
    }).join('\n\n');
    return { intentCNL };
  }

  async extractSessionContext({ rawNL }) {
    const sentences = rawNL.split(/[.!]+/).map(s => s.trim()).filter(Boolean);
    const facts = sentences.filter(s => !s.endsWith('?') && !s.startsWith('Please') && !s.startsWith('Can you')
      && /\b(is|are|use|have|has|deploy|run|prefer|need|require|want|live|exist|situated|located)\b/i.test(s));
    if (facts.length === 0) return { contextCNL: '' };

    const groups = this._groupRelatedSentences(facts);
    const units = [];
    let unitIdx = 0;

    for (const group of groups) {
      const combinedText = group.sentences.join('. ').replace(/\.\./g, '.');
      const role = /\b(prefer|want|like)\b/i.test(combinedText) ? 'Evaluation' :
                   /\b(deploy|run|environment|server|only|must|should)\b/i.test(combinedText) ? 'Constraint' : 'Explanation';
      const act = detectAct(combinedText);
      const topic = group.topic || combinedText.split(/\s+/).slice(0, 8).join(' ').replace(/[^\w\s-]/g, '');
      const hash = createHash('sha256').update(`${combinedText}|${role}|${topic}`).digest('hex');
      const fact = extractSymbolicFact(group.sentences[0]);
      let md = `## Context Unit session::turn::unit-${String(unitIdx).padStart(3, '0')}\nSourceId: session\nChunkId: session::turn\nRole: ${role}\nTopic: ${topic}\nClaim: ${combinedText}\n`;
      if (fact) {
        md += `Subject: ${fact.subject}\nRelation: ${fact.relation}\nObject: ${fact.object}\nConfidence: ${fact.confidence}\n`;
      }
      md += `UtilityActs: ${act}\nHash: ${hash}`;
      units.push(md);
      unitIdx++;
    }
    return { contextCNL: units.join('\n\n') };
  }

  async normalizePersistentContext({ chunkText, provenance }) {
    const sentences = chunkText.split(/[.!]+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length === 0) return { contextCNL: '' };

    // Group related sentences by shared subjects/topics
    const groups = this._groupRelatedSentences(sentences);
    const units = [];
    let unitIdx = 0;

    for (const group of groups) {
      const unitId = `${provenance.sourceId}::${provenance.chunkId.split('::').pop()}::unit-${String(unitIdx).padStart(3, '0')}`;
      const combinedText = group.sentences.join('. ').replace(/\.\./g, '.');
      const role = this._inferRole(combinedText);
      const acts = [detectAct(combinedText)];
      const topic = group.topic || combinedText.substring(0, 60);
      const hash = createHash('sha256').update(`${combinedText}|${role}|${topic}`).digest('hex');
      let md = `## Context Unit ${unitId}\nSourceId: ${provenance.sourceId}\nChunkId: ${provenance.chunkId}\nRole: ${role}\nTopic: ${topic}\n`;
      if (role === 'Procedure') {
        md += `Procedure: ${combinedText}\n`;
      } else {
        md += `Claim: ${combinedText}\n`;
        const fact = extractSymbolicFact(group.sentences[0]);
        if (fact) {
          md += `Subject: ${fact.subject}\nRelation: ${fact.relation}\nObject: ${fact.object}\nConfidence: ${fact.confidence}\n`;
        }
      }
      md += `UtilityActs: ${acts.join(', ')}\nHash: ${hash}`;
      units.push(md);
      unitIdx++;
    }
    return { contextCNL: units.join('\n\n') };
  }

  _inferRole(text) {
    if (/\bstep|procedure|install|configure|build|deploy\b/i.test(text)) return 'Procedure';
    if (/\bdefin|mean|is a\b/i.test(text)) return 'Definition';
    if (/\bcompar|versus|vs\b/i.test(text)) return 'Comparison';
    if (/\bcharacter|trait|appearance|personality|described as\b/i.test(text)) return 'Description';
    if (/\bstory|scene|event|happened|discovered|fled|began|triggered\b/i.test(text)) return 'Narrative';
    return 'Explanation';
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

  async synthesizeResponse({ sessionId, resolvedIntents, pluginOutputs }) {
    let md = `# MRP Response\nSession: ${sessionId}\n\n`;
    const answersByIntentRef = {};
    for (const ri of resolvedIntents) {
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      const hasEvidence = ri.sessionUnits.length > 0 || ri.kbUnits.length > 0 || ri.currentTurnContextUnits.length > 0;
      const status = po?.status === 'error' ? 'plugin-error' : hasEvidence ? 'answered' : 'no-context';
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
        groupAnswer = 'Based on the available evidence:\n';
        const allClaims = [
          ...ri.currentTurnContextUnits.map(u => u.claim || u.procedure),
          ...ri.sessionUnits.map(s => s.unit?.claim || s.unit?.procedure),
          ...ri.kbUnits.map(s => s.unit?.claim || s.unit?.procedure)
        ].filter(Boolean);
        for (const c of allClaims) groupAnswer += `- ${c}\n`;
      } else if (status === 'no-context') {
        groupAnswer = 'The session context and persistent KB do not contain enough evidence to answer this intent.';
      } else if (status === 'plugin-error') {
        groupAnswer = `Plugin execution failed: ${po?.error?.message || 'unknown error'}`;
      }
      answersByIntentRef[ri.intentRef] = groupAnswer;
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
        answersByIntentRef
      ),
      responseMarkdown: md
    };
  }
}
