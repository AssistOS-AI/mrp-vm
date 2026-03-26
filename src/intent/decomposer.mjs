// DS011 — Intent Decomposition & Context Profiles
import { ACT_TO_ROLES } from '../lib/pragmatics.mjs';
import { isStopword } from '../lib/vendor/stopwords.mjs';

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
    const queryTerms = textParts.join(' ')
      .split(/\s+/)
      .map(w => w.replace(/[^\w-]/g, '').toLowerCase())
      .filter(w => w && !isStopword(w));
    return {
      intentGroupNumber: decomposed.groupNumber,
      neededRoles,
      queryTerms: [...new Set(queryTerms)],
      actBoost: decomposed.act,
      maxResults: 10
    };
  }
}
