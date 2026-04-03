import {
  COMMAND_SIGNATURES,
  CONSTRUCTOR_COMMANDS,
  FIELD_ALLOWLIST,
  KU_REQUIRED_FIELDS,
  PLUGIN_TYPES,
  VALIDATION_REQUIRED_FIELDS,
  expectsListField,
  isKnownField,
  normalizeObjectKind,
  stripStatementSigil,
  validateEnum
} from './schema.mjs';
import { PRAGMATIC_ACTS } from './pragmatics.mjs';
import { SOPParser } from './parser.mjs';

function makeError(code, statement, message, extra = {}) {
  return {
    code,
    line: statement?.line ?? extra.line ?? 1,
    column: statement?.column ?? extra.column ?? 1,
    field: extra.field ?? null,
    message
  };
}

function argKindMatches(arg, expectedKind) {
  if (expectedKind === 'value') return ['atom', 'string', 'ref', 'list'].includes(arg?.kind);
  if (expectedKind === 'scalar') return ['atom', 'string'].includes(arg?.kind);
  return arg?.kind === expectedKind;
}

function normalizeArgValue(arg) {
  if (!arg) return null;
  if (arg.kind === 'list') {
    return arg.items.map(item => item.kind === 'ref' ? stripStatementSigil(item.value) : item.value);
  }
  if (arg.kind === 'ref') return stripStatementSigil(arg.value);
  return arg.value;
}

function isExternalFrameRef(refId = '') {
  return /^f[\w-]+$/i.test(refId) || /^frame-[\w-]+$/i.test(refId);
}

function allowsExternalFrameRef(statement, argIndex) {
  return ['policy', 'objective', 'candidate', 'compare', 'challenge'].includes(statement?.command) && argIndex === 0;
}

export class SOPValidator {
  constructor(parser = new SOPParser()) {
    this.parser = parser;
  }

  validateDocument(sourceText = '', options = {}) {
    let statements;
    try {
      statements = this.parser.parseDocument(sourceText);
    } catch (error) {
      return {
        valid: false,
        errors: [{
          code: error.code || 'MALFORMED_LINE',
          line: error.line ?? error.details?.line ?? 1,
          column: error.column ?? error.details?.column ?? 1,
          message: error.message
        }]
      };
    }
    return this.validate(statements, options);
  }

  validate(statements = [], options = {}) {
    const documentKind = options.documentKind || 'mixed';
    const errors = [];
    const objects = new Map();
    const seenStatements = new Set();
      const state = {
        intents: [],
        kus: [],
        validations: [],
        policies: [],
        objectives: [],
        candidates: [],
        comparisons: [],
        challenges: [],
        branches: [],
        results: []
      };

    for (const statement of statements) {
      if (seenStatements.has(statement.id)) {
        errors.push(makeError(
          'DUPLICATE_STATEMENT_ID',
          statement,
          `Duplicate statement id '${statement.id}'`
        ));
        continue;
      }
      seenStatements.add(statement.id);

      const signature = COMMAND_SIGNATURES[statement.command];
      if (!signature) {
        errors.push(makeError(
          'UNKNOWN_COMMAND',
          statement,
          `Unsupported command '${statement.command}'`
        ));
        continue;
      }

      if (statement.args.length !== signature.length) {
        errors.push(makeError(
          'INVALID_ARGUMENT_COUNT',
          statement,
          `Command '${statement.command}' expects ${signature.length} argument(s), got ${statement.args.length}`
        ));
        continue;
      }

      let kind = null;
      if (CONSTRUCTOR_COMMANDS.has(statement.command)) {
        kind = normalizeObjectKind(statement.command);
      } else if (statement.command === 'set' || statement.command === 'status') {
        kind = this._resolveObjectKind(statement.args[0], objects);
      } else if (['fail', 'deactivate'].includes(statement.command)) {
        kind = statement.command === 'fail' ? 'branch' : 'seed';
      }

      for (let index = 0; index < signature.length; index += 1) {
        const expected = signature[index];
        const arg = statement.args[index];
        if (!argKindMatches(arg, expected)) {
          errors.push(makeError(
            'INVALID_ARGUMENT_KIND',
            statement,
            `Argument ${index + 1} of '${statement.command}' must be ${expected}`,
            {
              column: arg?.column ?? statement.column
            }
          ));
        }
      }
      if (errors.length > 0 && errors[errors.length - 1]?.line === statement.line) continue;

      if (CONSTRUCTOR_COMMANDS.has(statement.command)) {
        const objectId = stripStatementSigil(statement.id);
        if (objects.has(objectId)) {
          errors.push(makeError(
            'DUPLICATE_STATEMENT_ID',
            statement,
            `Duplicate constructor id '${statement.id}'`
          ));
          continue;
        }
        objects.set(objectId, {
          kind,
          statement,
          fields: new Map(),
          relations: {
            constraints: [],
            allows: [],
            needs: [],
            uses: [],
            supports: [],
            parents: [],
            derivedFrom: [],
            splitFrom: [],
            results: []
          },
          statuses: [],
          terminalStatus: null,
          failureReason: null
        });
        if (statement.command === 'intent') {
          const act = normalizeArgValue(statement.args[0]);
          if (!PRAGMATIC_ACTS.includes(String(act || '').toLowerCase())) {
            errors.push(makeError(
              'INVALID_ACT_VALUE',
              statement,
              `Invalid act '${act}'`
            ));
          }
          state.intents.push(objectId);
        }
        if (statement.command === 'plugin') {
          const pluginType = normalizeArgValue(statement.args[0]);
          if (!PLUGIN_TYPES.includes(pluginType)) {
            errors.push(makeError(
              'INVALID_ARGUMENT_KIND',
              statement,
              `Invalid plugin type '${pluginType}'`
            ));
          }
        }
        if (statement.command === 'ku') state.kus.push(objectId);
        if (statement.command === 'validate') state.validations.push(objectId);
        if (statement.command === 'policy') state.policies.push(objectId);
        if (statement.command === 'objective') state.objectives.push(objectId);
        if (statement.command === 'candidate') state.candidates.push(objectId);
        if (statement.command === 'compare') state.comparisons.push(objectId);
        if (statement.command === 'challenge') state.challenges.push(objectId);
        if (statement.command === 'branch') state.branches.push(objectId);
        if (statement.command === 'result_record') state.results.push(objectId);
        continue;
      }

      const refArg = statement.args[0];
      const objectId = stripStatementSigil(refArg.value);
      const object = objects.get(objectId);
      if (!object) {
        if (!allowsExternalFrameRef(statement, 0) || !isExternalFrameRef(objectId)) {
          errors.push(makeError(
            'UNRESOLVED_REFERENCE',
            statement,
            `Reference '${refArg.value}' does not resolve to a prior constructor`
          ));
        }
        continue;
      }

      if (statement.command === 'set') {
        const fieldName = normalizeArgValue(statement.args[1]);
        const valueArg = statement.args[2];
        if (!FIELD_ALLOWLIST[object.kind]?.has(fieldName)) {
          errors.push(makeError(
            isKnownField(fieldName) ? 'INVALID_FIELD_FOR_OBJECT' : 'UNKNOWN_FIELD',
            statement,
            `Field '${fieldName}' is not allowed for ${object.kind}`,
            { field: fieldName }
          ));
          continue;
        }
        if (expectsListField(fieldName) && valueArg.kind !== 'list') {
          errors.push(makeError(
            'INVALID_ARGUMENT_KIND',
            statement,
            `Field '${fieldName}' expects a list value`,
            { field: fieldName }
          ));
          continue;
        }
        if (!expectsListField(fieldName) && valueArg.kind === 'list') {
          errors.push(makeError(
            'INVALID_ARGUMENT_KIND',
            statement,
            `Field '${fieldName}' does not accept a list value`,
            { field: fieldName }
          ));
          continue;
        }

        const value = normalizeArgValue(valueArg);
        const enumError = validateEnum(fieldName, value);
        if (enumError) {
          errors.push(makeError(
            enumError,
            statement,
            `Invalid value for field '${fieldName}'`,
            { field: fieldName }
          ));
          continue;
        }
        object.fields.set(fieldName, value);
      } else if (statement.command === 'constrain') {
        object.relations.constraints.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'allows') {
        object.relations.allows.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'needs') {
        object.relations.needs.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'uses') {
        object.relations.uses.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'supports') {
        object.relations.supports.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'describes') {
        object.relations.describes = object.relations.describes || [];
        object.relations.describes.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'parent') {
        object.relations.parents.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'derived_from') {
        object.relations.derivedFrom.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'split_from') {
        object.relations.splitFrom.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'result') {
        object.relations.results.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'status') {
        object.statuses.push(normalizeArgValue(statement.args[1]));
      } else if (statement.command === 'fail') {
        object.terminalStatus = 'failed';
        object.failureReason = normalizeArgValue(statement.args[1]);
      } else if (statement.command === 'deactivate') {
        object.terminalStatus = 'deactivated';
      }

      for (let index = 1; index < statement.args.length; index += 1) {
        const arg = statement.args[index];
        if (arg.kind !== 'ref') continue;
        const targetId = stripStatementSigil(arg.value);
        if (!objects.has(targetId)) {
          if (!allowsExternalFrameRef(statement, index) || !isExternalFrameRef(targetId)) {
            errors.push(makeError(
              'UNRESOLVED_REFERENCE',
              statement,
              `Reference '${arg.value}' does not resolve to a prior constructor`
            ));
          }
        }
      }
    }

    if (documentKind === 'intent' && state.intents.length === 0) {
      errors.push(makeError(
        'MISSING_REQUIRED_FIELD',
        statements[0],
        'Intent document must declare at least one intent'
      ));
    }
    if (documentKind === 'context' && state.kus.length === 0 && statements.length > 0) {
      errors.push(makeError(
        'MISSING_REQUIRED_FIELD',
        statements[0],
        'Context document must declare at least one ku'
      ));
    }

    for (const intentId of state.intents) {
      const object = objects.get(intentId);
      if (!object.fields.has('output')) {
        errors.push(makeError(
          'MISSING_REQUIRED_FIELD',
          object.statement,
          `Intent '${object.statement.id}' is missing required field 'output'`,
          { field: 'output' }
        ));
      }
    }

    for (const kuId of state.kus) {
      const object = objects.get(kuId);
      for (const fieldName of KU_REQUIRED_FIELDS) {
        if (!object.fields.has(fieldName)) {
          errors.push(makeError(
            'MISSING_REQUIRED_FIELD',
            object.statement,
            `KU '${object.statement.id}' is missing required field '${fieldName}'`,
            { field: fieldName }
          ));
        }
      }
      const hasClaim = object.fields.has('claim');
      const hasProcedure = object.fields.has('procedure');
      if (hasClaim && hasProcedure) {
        errors.push(makeError(
          'CLAIM_AND_PROCEDURE_CONFLICT',
          object.statement,
          `KU '${object.statement.id}' cannot define both claim and procedure`
        ));
      }
      if (!hasClaim && !hasProcedure) {
        errors.push(makeError(
          'MISSING_REQUIRED_FIELD',
          object.statement,
          `KU '${object.statement.id}' must define exactly one of claim or procedure`
        ));
      }
      const role = object.fields.get('role');
      if (role === 'Procedure' && !hasProcedure) {
        errors.push(makeError(
          'MISSING_REQUIRED_FIELD',
          object.statement,
          `Procedure KU '${object.statement.id}' must define procedure`,
          { field: 'procedure' }
        ));
      }
      if (role && role !== 'Procedure' && !hasClaim) {
        errors.push(makeError(
          'MISSING_REQUIRED_FIELD',
          object.statement,
          `KU '${object.statement.id}' must define claim`,
          { field: 'claim' }
        ));
      }
      const symbolicFields = [
        object.fields.get('symbolicSubject'),
        object.fields.get('symbolicRelation'),
        object.fields.get('symbolicObject')
      ].filter(value => value != null);
      const hasConfidence = object.fields.has('confidence');
      if (symbolicFields.length > 0 && symbolicFields.length !== 3) {
        errors.push(makeError(
          'INCOMPLETE_SYMBOLIC_FACT',
          object.statement,
          `KU '${object.statement.id}' must define the full symbolic triple`
        ));
      }
      if (hasConfidence && symbolicFields.length !== 3) {
        errors.push(makeError(
          'INVALID_CONFIDENCE_VALUE',
          object.statement,
          `confidence requires symbolicSubject, symbolicRelation, and symbolicObject`
        ));
      }
      if (hasConfidence) {
        const confidence = Number(object.fields.get('confidence'));
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
          errors.push(makeError(
            'INVALID_CONFIDENCE_VALUE',
            object.statement,
            `Invalid confidence '${object.fields.get('confidence')}'`
          ));
        }
      }
    }

    for (const validationId of state.validations) {
      const object = objects.get(validationId);
      for (const fieldName of VALIDATION_REQUIRED_FIELDS) {
        if (!object.fields.has(fieldName)) {
          errors.push(makeError(
            'MISSING_REQUIRED_FIELD',
            object.statement,
            `Validation '${object.statement.id}' is missing required field '${fieldName}'`,
            { field: fieldName }
          ));
        }
      }
    }

    for (const branchId of state.branches) {
      const object = objects.get(branchId);
      const statuses = new Set(object.statuses);
      if (object.terminalStatus === 'failed' && statuses.has('succeeded')) {
        errors.push(makeError(
          'INVALID_STATUS_TRANSITION',
          object.statement,
          `Branch '${object.statement.id}' cannot both succeed and fail`
        ));
      }
    }

    for (const candidateId of state.candidates) {
      const object = objects.get(candidateId);
      const branchRef = stripStatementSigil(object.statement.args[1]?.value || '');
      const resultRef = stripStatementSigil(object.statement.args[2]?.value || '');
      if (!objects.has(branchRef)) {
        errors.push(makeError(
          'UNRESOLVED_REFERENCE',
          object.statement,
          `Candidate '${object.statement.id}' references unknown branch '${object.statement.args[1]?.value || ''}'`
        ));
      }
      if (!objects.has(resultRef)) {
        errors.push(makeError(
          'UNRESOLVED_REFERENCE',
          object.statement,
          `Candidate '${object.statement.id}' references unknown result '${object.statement.args[2]?.value || ''}'`
        ));
      }
    }

    for (const comparisonId of state.comparisons) {
      const object = objects.get(comparisonId);
      const candidates = normalizeArgValue(object.statement.args[1]);
      for (const candidateRef of candidates || []) {
        if (!objects.has(candidateRef)) {
          errors.push(makeError(
            'UNRESOLVED_REFERENCE',
            object.statement,
            `Comparison '${object.statement.id}' references unknown candidate '${candidateRef}'`
          ));
        }
      }
    }

    for (const challengeId of state.challenges) {
      const object = objects.get(challengeId);
      const targetRef = stripStatementSigil(object.statement.args[1]?.value || '');
      if (!objects.has(targetRef)) {
        errors.push(makeError(
          'UNRESOLVED_REFERENCE',
          object.statement,
          `Challenge '${object.statement.id}' references unknown target '${object.statement.args[1]?.value || ''}'`
        ));
      }
    }

    for (const resultId of state.results) {
      const object = objects.get(resultId);
      const linked = state.branches.some(branchId => {
        const branch = objects.get(branchId);
        return (branch.relations.results || []).includes(resultId);
      });
      if (!linked) {
        errors.push(makeError(
          'MISSING_REQUIRED_FIELD',
          object.statement,
          `Result '${object.statement.id}' must be linked from a branch through result`
        ));
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  _resolveObjectKind(refArg, objects) {
    const refId = stripStatementSigil(refArg?.value || '');
    return objects.get(refId)?.kind || null;
  }
}
