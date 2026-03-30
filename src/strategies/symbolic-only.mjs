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
    // Extract factual statements
    const sentences = rawNL.split(/[.!]+/).map(s => s.trim()).filter(Boolean);
    const facts = sentences.filter(s => !s.endsWith('?') && !s.startsWith('Please') && !s.startsWith('Can you')
      && /\b(is|are|use|have|has|deploy|run|prefer|need|require|want|live|exist|situated|located)\b/i.test(s));
    if (facts.length === 0) return { contextCNL: '' };
    const units = facts.map((f, i) => {
      const role = /\b(prefer|want|like)\b/i.test(f) ? 'Evaluation' :
                   /\b(deploy|run|environment|server|only|must|should)\b/i.test(f) ? 'Constraint' : 'Explanation';
      const act = detectAct(f);
      const acts = [act];
      // Improved topic: take more significant words
      const topic = f.split(/\s+/).slice(0, 8).join(' ').replace(/[^\w\s-]/g, '');
      const hash = createHash('sha256').update(`${f}|${role}|${topic}`).digest('hex');
      const fact = extractSymbolicFact(f);
      let md = `## Context Unit session::turn::unit-${String(i).padStart(3, '0')}\nSourceId: session\nChunkId: session::turn\nRole: ${role}\nTopic: ${topic}\nClaim: ${f}\n`;
      if (fact) {
        md += `Subject: ${fact.subject}\nRelation: ${fact.relation}\nObject: ${fact.object}\nConfidence: ${fact.confidence}\n`;
      }
      md += `UtilityActs: ${acts.join(', ')}\nHash: ${hash}`;
      return md;
    }).join('\n\n');
    return { contextCNL: units };
  }

  async normalizePersistentContext({ chunkText, provenance }) {
    const sentences = chunkText.split(/[.!]+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length === 0) return { contextCNL: '' };
    const units = sentences.map((s, i) => {
      const role = /\bstep|procedure|install|configure\b/i.test(s) ? 'Procedure' :
                   /\bdefin|mean|is a\b/i.test(s) ? 'Definition' :
                   /\bcompar|versus|vs\b/i.test(s) ? 'Comparison' : 'Explanation';
      const acts = [detectAct(s)];
      const unitId = `${provenance.sourceId}::${provenance.chunkId.split('::').pop()}::unit-${String(i).padStart(3, '0')}`;
      const topic = s.substring(0, 50);
      const hash = createHash('sha256').update(`${s}|${role}|${topic}`).digest('hex');
      let md = `## Context Unit ${unitId}\nSourceId: ${provenance.sourceId}\nChunkId: ${provenance.chunkId}\nRole: ${role}\nTopic: ${topic}\n`;
      if (role === 'Procedure') {
        md += `Procedure: ${s}\n`;
      } else {
        md += `Claim: ${s}\n`;
        const fact = extractSymbolicFact(s);
        if (fact) {
          md += `Subject: ${fact.subject}\nRelation: ${fact.relation}\nObject: ${fact.object}\nConfidence: ${fact.confidence}\n`;
        }
      }
      md += `UtilityActs: ${acts.join(', ')}\nHash: ${hash}`;
      return md;
    }).join('\n\n');
    return { contextCNL: units };
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
