import { ACT_TO_ROLES } from '../knowledge/pragmatics.mjs';
import { isStopword } from './stopwords.mjs';

const GENERIC_QUERY_TERMS = new Set([
  'single', 'one', 'word', 'whose', 'character', 'someone',
  'something', 'entirely', 'instead', 'become', 'becomes',
  'specific', 'made', 'would', 'could', 'should'
]);

export class IntentDecomposer {
  decompose(intentGroups) {
    return intentGroups.map(group => {
      if (!group.act) throw new Error(`Intent Group ${group.groupNumber} missing act`);
      const words = group.intent.split(/\s+/);
      const targetWords = words.slice(1);
      const target = targetWords.join(' ').replace(/[.?!]+$/, '');
      const criteria = group.criterion ? group.criterion.split(/,\s*/).map(item => item.trim()).filter(Boolean) : [];
      const evidence = group.evidence ? group.evidence.split(/,\s*/).map(item => item.trim()).filter(Boolean) : [];
      return {
        groupNumber: group.groupNumber,
        act: group.act,
        intent: group.intent,
        target,
        criteria,
        evidence,
        explicitContext: group.context || null,
        outputType: group.output
      };
    });
  }

  deriveContextProfile(decomposed) {
    const neededRoles = ACT_TO_ROLES[decomposed.act] || [];
    const textParts = [decomposed.target, ...decomposed.criteria];
    if (decomposed.explicitContext) textParts.push(decomposed.explicitContext);
    const queryText = textParts.join(' ').trim();
    const queryTerms = this._deriveQueryTerms(textParts);
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

  _deriveQueryTerms(textParts) {
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
