export const SYMBOLIC_RELATIONS = [
  'uses',
  'provides',
  'has_capability',
  'depends_on',
  'part_of',
  'instance_of',
  'relevant_for',
  'supports',
  'mentions',
  'about',
  'causes'
];

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

export const INTENT_REQUIRED_FIELDS = ['Act', 'Intent', 'Output'];
export const INTENT_ALLOWED_FIELDS = ['Act', 'Intent', 'Context', 'Criterion', 'Evidence', 'Output'];

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

export function inferPhaseScopes(unit = {}) {
  const explicit = normalizePhaseScopes(unit.phaseScopes || []);
  const scopes = new Set(explicit);
  if (scopes.size === 0) scopes.add('kb-plugin');
  return [...scopes];
}
