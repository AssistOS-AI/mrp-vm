// DS004 canonical enums and mappings

export const PRAGMATIC_ACTS = [
  'compare', 'explain', 'recommend', 'diagnose',
  'implement', 'verify', 'define', 'evaluate',
  'identify', 'describe'
];

export const PRAGMATIC_ROLES = [
  'Comparison', 'Explanation', 'Procedure', 'Definition',
  'Evaluation', 'Diagnostic', 'Constraint',
  'Narrative', 'Description'
];

// DS004: Act → Preferred Context Roles
export const ACT_TO_ROLES = {
  compare:   ['Comparison', 'Evaluation'],
  explain:   ['Explanation', 'Diagnostic', 'Narrative'],
  recommend: ['Comparison', 'Evaluation', 'Procedure'],
  diagnose:  ['Diagnostic', 'Explanation'],
  implement: ['Procedure', 'Constraint'],
  verify:    ['Constraint', 'Definition'],
  define:    ['Definition', 'Explanation'],
  evaluate:  ['Evaluation', 'Comparison', 'Narrative'],
  identify:  ['Narrative', 'Description', 'Definition'],
  describe:  ['Description', 'Narrative', 'Explanation']
};

// Intent CNL fields
export const INTENT_REQUIRED_FIELDS = ['Act', 'Intent', 'Output'];
export const INTENT_ALLOWED_FIELDS = ['Act', 'Intent', 'Context', 'Criterion', 'Evidence', 'Output'];

// Context CNL fields
export const CONTEXT_REQUIRED_FIELDS = ['SourceId', 'ChunkId', 'Role', 'Topic'];
export const CONTEXT_ALLOWED_FIELDS = [
  'SourceId', 'ChunkId', 'Role', 'Topic', 'Claim',
  'Condition', 'Procedure', 'UtilityActs', 'UtilityNote'
];
