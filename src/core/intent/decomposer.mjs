// DS011 — Intent Decomposition & Context Profiles
import { ACT_TO_ROLES } from '../../mrp-vm-sdk/knowledge/pragmatics.mjs';
import { isStopword } from '../../mrp-vm-sdk/vendor/stopwords.mjs';

const GENERIC_QUERY_TERMS = new Set([
  'single', 'one', 'word', 'whose', 'character', 'someone',
  'something', 'entirely', 'instead', 'become', 'becomes',
  'specific', 'made', 'would', 'could', 'should'
]);

export class IntentDecomposer {
  decompose(intentGroups) {
    return intentGroups.map(g => {
      if (!g.act) throw new Error(`Intent Group ${g.groupNumber} missing act`);
      // Extract target: remove first word (act verb) from intent
      const words = g.intent.split(/\s+/);
      const targetWords = words.slice(1);
      const target = targetWords.join(' ').replace(/[.?!]+$/, '');
      // Extract criteria
      const criteria = g.criterion ? g.criterion.split(/,\s*/).map(c => c.trim()).filter(Boolean) : [];
      const evidence = g.evidence ? g.evidence.split(/,\s*/).map(e => e.trim()).filter(Boolean) : [];
      return {
        groupNumber: g.groupNumber,
        act: g.act,
        intent: g.intent,
        target,
        criteria,
        evidence,
        explicitContext: g.context || null,
        outputType: g.output
      };
    });
  }

  deriveContextProfile(decomposed) {
    const neededRoles = ACT_TO_ROLES[decomposed.act] || [];
    // Extract query terms from target + criteria + explicit context
    const textParts = [decomposed.target, ...decomposed.criteria];
    if (decomposed.explicitContext) textParts.push(decomposed.explicitContext);
    const queryText = textParts.join(' ').trim();
    const queryTerms = this._deriveQueryTerms(decomposed, textParts);
    const focusPhrases = this._extractFocusPhrases(textParts.join(' '));
    const focusTerms = [...new Set(
      focusPhrases
        .flatMap(phrase => phrase.split(/\s+/))
        .map(term => term.trim().toLowerCase())
        .filter(Boolean)
    )];
    const constrainedOutput = /\b(one|single)\s+word\b|\byes\s*(?:\/|or)\s*no\b/.test(
      `${String(decomposed.outputType || '')} ${String(decomposed.intent || '')}`.toLowerCase()
    );
    const maxResults = decomposed.act === 'identify'
      ? 4
      : (constrainedOutput ? 5 : 10);
    return {
      intentGroupNumber: decomposed.groupNumber,
      neededRoles,
      queryText,
      queryTerms: [...new Set(queryTerms)],
      focusTerms,
      focusPhrases,
      actBoost: decomposed.act,
      maxResults
    };
  }

  _deriveQueryTerms(decomposed, textParts) {
    return textParts.join(' ')
      .split(/\s+/)
      .map(word => word.replace(/[^\w-]/g, '').toLowerCase())
      .filter(word => word && !isStopword(word) && !GENERIC_QUERY_TERMS.has(word));
  }

  _extractFocusPhrases(text) {
    const phrases = String(text || '')
      .match(/\b[A-Z][a-zA-Z0-9-]*(?:\s+[A-Z][a-zA-Z0-9-]*)*/g) || [];
    return [...new Set(
      phrases
        .map(phrase => phrase.trim().toLowerCase())
        .filter(phrase => phrase && phrase.length > 2 && !/^(what|why|how|who|which|one)$/i.test(phrase))
    )];
  }
}
