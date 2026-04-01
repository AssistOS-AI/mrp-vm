// DS004 canonical enums and mappings
import { SYMBOLIC_RELATIONS } from './symbolic-facts.mjs';

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

export const CONTEXT_PHASE_SCOPES = [
  'sd-plugin',
  'mrp-plan-plugin',
  'kb-plugin',
  'gs-plugin',
  'frame',
  'val-plugin'
];

const PHASE_SCOPE_ALIASES = {
  seed: 'sd-plugin',
  'seed-detector': 'sd-plugin',
  'sd-plugin': 'sd-plugin',
  planner: 'mrp-plan-plugin',
  'mrp-plan-plugin': 'mrp-plan-plugin',
  kb: 'kb-plugin',
  retrieval: 'kb-plugin',
  'kb-plugin': 'kb-plugin',
  output: 'gs-plugin',
  answer: 'gs-plugin',
  'goal-solver': 'gs-plugin',
  'gs-plugin': 'gs-plugin',
  decomposition: 'frame',
  frame: 'frame',
  validation: 'val-plugin',
  validator: 'val-plugin',
  'val-plugin': 'val-plugin'
};

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
  'SourceId', 'ChunkId', 'KUType', 'Title', 'Role', 'Topic', 'Claim',
  'Condition', 'Procedure', 'UtilityActs', 'UtilityNote',
  'PhaseScopes',
  'Hash', 'Subject', 'Relation', 'Object', 'Confidence',
  'SourceName', 'SourceType', 'Author', 'IngestedAt', 'KnowledgeDate',
  'ChunkIndex', 'UnitIndex', 'UnitType',
  'TextBody', 'ParentUnitIds', 'ChildUnitIds',
  'DerivedFromUnitIds', 'CharStart', 'CharEnd',
  'CreatedAt', 'ChunkType', 'SectionTitle'
];

export { SYMBOLIC_RELATIONS };

export function normalizePhaseScopes(values = []) {
  const normalized = [];
  for (const value of values) {
    const key = String(value || '').trim().toLowerCase();
    const mapped = PHASE_SCOPE_ALIASES[key];
    if (!mapped) continue;
    if (!normalized.includes(mapped)) normalized.push(mapped);
  }
  return normalized;
}

function textMentions(text, pattern) {
  return pattern.test(String(text || '').toLowerCase());
}

export function inferPhaseScopes(unit = {}) {
  const explicit = normalizePhaseScopes(unit.phaseScopes || []);
  const scopes = new Set(explicit);
  const text = [
    unit.title || '',
    unit.topic || '',
    unit.claim || '',
    unit.procedure || '',
    unit.utilityNote || '',
    (unit.utilityActs || []).join(' ')
  ].join(' ').toLowerCase();
  const role = String(unit.role || '').toLowerCase();
  const acts = new Set((unit.utilityActs || []).map(act => String(act).toLowerCase()));
  const hasSymbolicFact = !!(unit.subject && unit.relation && unit.object);

  const outputGuidance =
    textMentions(text, /\b(answer|respond|response|output|format|json|yaml|xml|markdown|bullet|table|schema|template|brief|concise|short|detailed|step-by-step)\b/);
  const planningGuidance =
    textMentions(text, /\b(plan|planner|plugin|solver|strategy|method|choose|prefer|use kb|thinkingdb|balanced|cheap|fast|deep|llm|symbolic)\b/) ||
    role === 'evaluation';
  const decompositionGuidance =
    textMentions(text, /\b(decompose|split|subtask|frame|loop|first\b.*\bthen|iterate|break down)\b/) ||
    role === 'procedure';
  const validationGuidance =
    textMentions(text, /\b(validate|validation|grounded|grounding|evidence-only|verify before answering|accept|reject|check consistency)\b/);
  const seedGuidance =
    textMentions(text, /\b(seed|intent|classify|normalize|extract context|seed-detector|detect seeds)\b/);
  const retrievalEvidence =
    hasSymbolicFact ||
    ['comparison', 'explanation', 'definition', 'diagnostic', 'narrative', 'description', 'procedure'].includes(role) ||
    acts.has('compare') || acts.has('explain') || acts.has('define') ||
    acts.has('identify') || acts.has('describe') || acts.has('diagnose');

  if (retrievalEvidence || scopes.size === 0) scopes.add('kb-plugin');
  if (outputGuidance || acts.has('recommend') || acts.has('describe')) scopes.add('gs-plugin');
  if (planningGuidance || role === 'constraint' || acts.has('evaluate') || acts.has('recommend')) {
    scopes.add('mrp-plan-plugin');
  }
  if (decompositionGuidance) scopes.add('frame');
  if (validationGuidance || acts.has('verify')) scopes.add('val-plugin');
  if (seedGuidance) scopes.add('sd-plugin');

  return [...scopes];
}

export function hasPhaseScope(unit, scope) {
  return inferPhaseScopes(unit).includes(scope);
}
