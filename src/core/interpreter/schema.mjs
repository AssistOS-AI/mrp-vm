import {
  CONTEXT_PHASE_SCOPES,
  PRAGMATIC_ACTS,
  PRAGMATIC_ROLES,
  SYMBOLIC_RELATIONS,
  normalizePhaseScopes
} from '../../mrp-vm-sdk/knowledge/pragmatics.mjs';

export const PLUGIN_TYPES = [
  'sd-plugin',
  'kb-plugin',
  'gs-plugin',
  'val-plugin',
  'mrp-plan-plugin'
];

export const COMMAND_SIGNATURES = {
  intent: ['atom', 'string'],
  seed: ['ref', 'atom', 'atom', 'string'],
  subproblem: ['ref', 'string'],
  plugin: ['atom', 'atom'],
  ku: ['atom', 'string'],
  validate: ['atom'],
  branch: ['ref', 'ref', 'ref'],
  result_record: ['atom'],
  set: ['ref', 'atom', 'value'],
  constrain: ['ref', 'scalar'],
  allows: ['ref', 'atom'],
  needs: ['ref', 'ref'],
  uses: ['ref', 'ref'],
  supports: ['ref', 'ref'],
  describes: ['ref', 'ref'],
  parent: ['ref', 'ref'],
  derived_from: ['ref', 'ref'],
  split_from: ['ref', 'ref'],
  result: ['ref', 'ref'],
  status: ['ref', 'atom'],
  fail: ['ref', 'scalar'],
  deactivate: ['ref', 'scalar']
};

export const CONSTRUCTOR_COMMANDS = new Set([
  'intent',
  'seed',
  'subproblem',
  'plugin',
  'ku',
  'validate',
  'branch',
  'result_record'
]);

export const RELATION_COMMANDS = new Set([
  'constrain',
  'allows',
  'needs',
  'uses',
  'supports',
  'describes',
  'parent',
  'derived_from',
  'split_from',
  'result'
]);

export const STATUS_COMMANDS = new Set([
  'set',
  'status',
  'fail',
  'deactivate'
]);

export const FIELD_ALLOWLIST = {
  intent: new Set(['context', 'criterion', 'evidence', 'output', 'outputLabel']),
  seed: new Set(['domain', 'evidenceNeed', 'state', 'priority']),
  subproblem: new Set(['reason', 'successSignal']),
  plugin: new Set([
    'name',
    'description',
    'acceptsTasks',
    'acceptsModes',
    'acceptsKinds',
    'acceptsStatuses',
    'rejectsKinds',
    'rejectsRules',
    'outputs',
    'validates',
    'cost'
  ]),
  ku: new Set([
    'title',
    'role',
    'topic',
    'claim',
    'procedure',
    'condition',
    'sourceId',
    'chunkId',
    'utilityActs',
    'utilityNote',
    'phaseScopes',
    'symbolicSubject',
    'symbolicRelation',
    'symbolicObject',
    'confidence',
    'hash',
    'sourceName',
    'sourceType',
    'author',
    'ingestedAt',
    'knowledgeDate',
    'chunkIndex',
    'unitIndex',
    'unitType',
    'textBody',
    'charStart',
    'charEnd',
    'createdAt',
    'chunkType',
    'sectionTitle'
  ]),
  validate: new Set(['strength', 'partialAllowed', 'preserveConstraints']),
  branch: new Set(['status', 'failureReason']),
  result_record: new Set(['validationStatus', 'preservesConstraints', 'structuralComplete', 'body'])
};

export const LIST_FIELDS = new Set([
  'acceptsTasks',
  'acceptsModes',
  'acceptsKinds',
  'acceptsStatuses',
  'rejectsKinds',
  'rejectsRules',
  'outputs',
  'validates',
  'utilityActs',
  'phaseScopes'
]);

export const NUMERIC_FIELDS = new Set([
  'confidence',
  'chunkIndex',
  'unitIndex',
  'charStart',
  'charEnd'
]);

export const KU_REQUIRED_FIELDS = ['sourceId', 'chunkId', 'role', 'topic'];
export const VALIDATION_REQUIRED_FIELDS = ['strength', 'partialAllowed', 'preserveConstraints'];

export const ROLE_TO_UTILITY_ACTS = {
  Comparison: ['compare'],
  Explanation: ['explain'],
  Procedure: ['implement'],
  Definition: ['define'],
  Evaluation: ['evaluate'],
  Diagnostic: ['diagnose'],
  Constraint: ['verify'],
  Narrative: ['explain', 'describe'],
  Description: ['describe']
};

export function commandCreatesObject(command) {
  return CONSTRUCTOR_COMMANDS.has(command);
}

export function normalizeObjectKind(command) {
  return command === 'result_record' ? 'result_record' : command;
}

export function stripStatementSigil(value = '') {
  return String(value || '').replace(/^[@$]/, '');
}

export function isKnownField(fieldName = '') {
  for (const fields of Object.values(FIELD_ALLOWLIST)) {
    if (fields.has(fieldName)) return true;
  }
  return false;
}

export function expectsListField(fieldName = '') {
  return LIST_FIELDS.has(fieldName);
}

export function normalizeScalarValue(fieldName, value) {
  if (fieldName === 'phaseScopes') {
    return normalizePhaseScopes(Array.isArray(value) ? value : [value]);
  }
  if (fieldName === 'utilityActs') {
    return (Array.isArray(value) ? value : [value])
      .map(item => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }
  if (fieldName === 'role') return String(value || '').trim();
  if (fieldName === 'symbolicRelation') return String(value || '').trim();
  if (NUMERIC_FIELDS.has(fieldName)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

export function validateEnum(fieldName, value) {
  if (fieldName === 'role' && !PRAGMATIC_ROLES.includes(value)) return 'INVALID_ROLE_VALUE';
  if (fieldName === 'symbolicRelation' && !SYMBOLIC_RELATIONS.includes(value)) return 'INVALID_RELATION_VALUE';
  if (fieldName === 'phaseScopes') {
    const normalized = normalizePhaseScopes(Array.isArray(value) ? value : [value]);
    const raw = (Array.isArray(value) ? value : [value]).map(item => String(item || '').trim()).filter(Boolean);
    if (normalized.length !== raw.length) return 'INVALID_PHASE_SCOPE';
    if (normalized.some(item => !CONTEXT_PHASE_SCOPES.includes(item))) return 'INVALID_PHASE_SCOPE';
  }
  if (fieldName === 'utilityActs') {
    const acts = (Array.isArray(value) ? value : [value]).map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
    if (acts.some(act => !PRAGMATIC_ACTS.includes(act))) return 'INVALID_ACT_VALUE';
  }
  return null;
}

