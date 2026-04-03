import { SOPParser } from './parser.mjs';
import { SOPValidator } from './validator.mjs';
import {
  KU_REQUIRED_FIELDS,
  ROLE_TO_UTILITY_ACTS,
  VALIDATION_REQUIRED_FIELDS,
  normalizeScalarValue,
  stripStatementSigil
} from './schema.mjs';
import { SOPValidationError } from './errors.mjs';

function makeObject(kind, id, statement) {
  return {
    id,
    statementId: statement.id,
    kind,
    line: statement.line,
    column: statement.column,
    fields: {},
    constraints: [],
    allows: [],
    uses: [],
    supports: [],
    parentIds: [],
    derivedFromIds: [],
    splitFromIds: [],
    status: null,
    locations: {
      constructor: {
        line: statement.line,
        column: statement.column
      },
      fields: {}
    }
  };
}

function assignField(object, fieldName, value, statement) {
  object.fields[fieldName] = normalizeScalarValue(fieldName, value);
  object.locations.fields[fieldName] = {
    line: statement.line,
    column: statement.column
  };
}

function normalizeArgValue(arg) {
  if (!arg) return null;
  if (arg.kind === 'list') {
    return arg.items.map(item => item.kind === 'ref' ? stripStatementSigil(item.value) : item.value);
  }
  if (arg.kind === 'ref') return stripStatementSigil(arg.value);
  return arg.value;
}

function mapWithIndex(values, mapper) {
  const output = [];
  let index = 0;
  for (const value of values.values()) {
    output.push(mapper(value, index));
    index += 1;
  }
  return output;
}

export class SOPInterpreter {
  constructor(parser = new SOPParser(), validator = new SOPValidator(parser)) {
    this.parser = parser;
    this.validator = validator;
  }

  interpretDocument(sourceText = '', options = {}) {
    const parsedStatements = this.parser.parseDocument(sourceText);
    const validation = this.validator.validate(parsedStatements, options);
    if (!validation.valid) {
      throw new SOPValidationError('Invalid SOP control document', validation.errors);
    }

    const doc = {
      documentKind: options.documentKind || 'mixed',
      statements: parsedStatements,
      intents: new Map(),
      seeds: new Map(),
      subproblems: new Map(),
      plugins: new Map(),
      kus: new Map(),
      validations: new Map(),
      policies: new Map(),
      objectives: new Map(),
      candidates: new Map(),
      comparisons: new Map(),
      challenges: new Map(),
      branches: new Map(),
      results: new Map(),
      relationEdges: [],
      statusEvents: [],
      objectsById: new Map(),
      constructorOrder: []
    };

    const objectLookup = doc.objectsById;

    for (const statement of parsedStatements) {
      const objectId = stripStatementSigil(statement.id);
      const command = statement.command;

      if (command === 'intent') {
        const intent = makeObject('intent', objectId, statement);
        intent.act = normalizeArgValue(statement.args[0]);
        intent.target = normalizeArgValue(statement.args[1]);
        doc.intents.set(objectId, intent);
        objectLookup.set(objectId, intent);
        doc.constructorOrder.push(objectId);
        continue;
      }
      if (command === 'seed') {
        const seed = makeObject('seed', objectId, statement);
        seed.intentId = normalizeArgValue(statement.args[0]);
        seed.mode = normalizeArgValue(statement.args[1]);
        seed.action = normalizeArgValue(statement.args[2]);
        seed.focus = normalizeArgValue(statement.args[3]);
        doc.seeds.set(objectId, seed);
        objectLookup.set(objectId, seed);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: seed.intentId,
          to: objectId
        });
        continue;
      }
      if (command === 'subproblem') {
        const subproblem = makeObject('subproblem', objectId, statement);
        subproblem.intentId = normalizeArgValue(statement.args[0]);
        subproblem.goal = normalizeArgValue(statement.args[1]);
        doc.subproblems.set(objectId, subproblem);
        objectLookup.set(objectId, subproblem);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: subproblem.intentId,
          to: objectId
        });
        continue;
      }
      if (command === 'plugin') {
        const plugin = makeObject('plugin', objectId, statement);
        plugin.pluginType = normalizeArgValue(statement.args[0]);
        plugin.pluginId = normalizeArgValue(statement.args[1]);
        doc.plugins.set(objectId, plugin);
        objectLookup.set(objectId, plugin);
        doc.constructorOrder.push(objectId);
        continue;
      }
      if (command === 'ku') {
        const ku = makeObject('ku', objectId, statement);
        ku.kuType = normalizeArgValue(statement.args[0]);
        ku.kuId = normalizeArgValue(statement.args[1]);
        doc.kus.set(objectId, ku);
        objectLookup.set(objectId, ku);
        doc.constructorOrder.push(objectId);
        continue;
      }
      if (command === 'validate') {
        const validationTarget = makeObject('validate', objectId, statement);
        validationTarget.mode = normalizeArgValue(statement.args[0]);
        doc.validations.set(objectId, validationTarget);
        objectLookup.set(objectId, validationTarget);
        doc.constructorOrder.push(objectId);
        continue;
      }
      if (command === 'policy') {
        const policy = makeObject('policy', objectId, statement);
        policy.frameId = normalizeArgValue(statement.args[0]);
        policy.level = Number(normalizeArgValue(statement.args[1]));
        policy.closureMode = normalizeArgValue(statement.args[2]);
        policy.maxFrontier = Number(normalizeArgValue(statement.args[3]));
        policy.minFamilies = Number(normalizeArgValue(statement.args[4]));
        policy.maxComparisons = Number(normalizeArgValue(statement.args[5]));
        policy.validationFloor = normalizeArgValue(statement.args[6]);
        doc.policies.set(objectId, policy);
        objectLookup.set(objectId, policy);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: policy.frameId,
          to: objectId
        });
        continue;
      }
      if (command === 'objective') {
        const objective = makeObject('objective', objectId, statement);
        objective.frameId = normalizeArgValue(statement.args[0]);
        objective.targetIds = normalizeArgValue(statement.args[1]);
        doc.objectives.set(objectId, objective);
        objectLookup.set(objectId, objective);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: objective.frameId,
          to: objectId
        });
        continue;
      }
      if (command === 'candidate') {
        const candidate = makeObject('candidate', objectId, statement);
        candidate.frameId = normalizeArgValue(statement.args[0]);
        candidate.branchId = normalizeArgValue(statement.args[1]);
        candidate.resultId = normalizeArgValue(statement.args[2]);
        candidate.strength = normalizeArgValue(statement.args[3]);
        doc.candidates.set(objectId, candidate);
        objectLookup.set(objectId, candidate);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: candidate.frameId,
          to: objectId
        });
        doc.relationEdges.push({
          type: 'derived_from',
          from: objectId,
          to: candidate.resultId
        });
        continue;
      }
      if (command === 'compare') {
        const comparison = makeObject('compare', objectId, statement);
        comparison.frameId = normalizeArgValue(statement.args[0]);
        comparison.candidateIds = normalizeArgValue(statement.args[1]);
        comparison.summary = normalizeArgValue(statement.args[2]);
        doc.comparisons.set(objectId, comparison);
        objectLookup.set(objectId, comparison);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: comparison.frameId,
          to: objectId
        });
        for (const candidateId of comparison.candidateIds || []) {
          doc.relationEdges.push({
            type: 'compares',
            from: objectId,
            to: candidateId
          });
        }
        continue;
      }
      if (command === 'challenge') {
        const challenge = makeObject('challenge', objectId, statement);
        challenge.frameId = normalizeArgValue(statement.args[0]);
        challenge.targetId = normalizeArgValue(statement.args[1]);
        challenge.prompt = normalizeArgValue(statement.args[2]);
        challenge.severity = normalizeArgValue(statement.args[3]);
        doc.challenges.set(objectId, challenge);
        objectLookup.set(objectId, challenge);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: challenge.frameId,
          to: objectId
        });
        doc.relationEdges.push({
          type: 'challenges',
          from: objectId,
          to: challenge.targetId
        });
        continue;
      }
      if (command === 'branch') {
        const branch = makeObject('branch', objectId, statement);
        branch.intentId = normalizeArgValue(statement.args[0]);
        branch.seedId = normalizeArgValue(statement.args[1]);
        branch.pluginId = normalizeArgValue(statement.args[2]);
        branch.status = 'queued';
        doc.branches.set(objectId, branch);
        objectLookup.set(objectId, branch);
        doc.constructorOrder.push(objectId);
        doc.relationEdges.push({
          type: 'contains',
          from: branch.seedId,
          to: objectId
        });
        continue;
      }
      if (command === 'result_record') {
        const result = makeObject('result_record', objectId, statement);
        result.resultKind = normalizeArgValue(statement.args[0]);
        doc.results.set(objectId, result);
        objectLookup.set(objectId, result);
        doc.constructorOrder.push(objectId);
        continue;
      }

      const targetId = stripStatementSigil(statement.args[0].value);
      const target = objectLookup.get(targetId);
      if (!target) continue;

      if (command === 'set') {
        const fieldName = normalizeArgValue(statement.args[1]);
        const value = normalizeArgValue(statement.args[2]);
        assignField(target, fieldName, value, statement);
        if (target.kind === 'branch' && fieldName === 'status') {
          target.status = value;
        }
        continue;
      }

      if (command === 'constrain') {
        target.constraints.push(normalizeArgValue(statement.args[1]));
        continue;
      }
      if (command === 'allows') {
        target.allows.push(normalizeArgValue(statement.args[1]));
        continue;
      }
      if (command === 'needs') {
        target.validationId = normalizeArgValue(statement.args[1]);
        doc.relationEdges.push({
          type: 'needs',
          from: targetId,
          to: target.validationId
        });
        continue;
      }
      if (command === 'uses') {
        const kuId = normalizeArgValue(statement.args[1]);
        target.uses.push(kuId);
        doc.relationEdges.push({
          type: 'uses',
          from: targetId,
          to: kuId
        });
        continue;
      }
      if (command === 'supports') {
        const kuId = normalizeArgValue(statement.args[1]);
        target.supports.push(kuId);
        doc.relationEdges.push({
          type: 'supports',
          from: targetId,
          to: kuId
        });
        continue;
      }
      if (command === 'describes') {
        const pluginId = normalizeArgValue(statement.args[1]);
        target.describesPluginId = pluginId;
        doc.relationEdges.push({
          type: 'describes',
          from: targetId,
          to: pluginId
        });
        continue;
      }
      if (command === 'parent') {
        const parentId = normalizeArgValue(statement.args[1]);
        target.parentIds.push(parentId);
        doc.relationEdges.push({
          type: 'parent',
          from: targetId,
          to: parentId
        });
        continue;
      }
      if (command === 'derived_from') {
        const parentId = normalizeArgValue(statement.args[1]);
        target.derivedFromIds.push(parentId);
        doc.relationEdges.push({
          type: 'derived_from',
          from: targetId,
          to: parentId
        });
        continue;
      }
      if (command === 'split_from') {
        const parentSeedId = normalizeArgValue(statement.args[1]);
        target.splitFromIds.push(parentSeedId);
        doc.relationEdges.push({
          type: 'split_from',
          from: targetId,
          to: parentSeedId
        });
        continue;
      }
      if (command === 'result') {
        const resultId = normalizeArgValue(statement.args[1]);
        target.resultId = resultId;
        doc.relationEdges.push({
          type: 'result',
          from: targetId,
          to: resultId
        });
        continue;
      }
      if (command === 'status') {
        const status = normalizeArgValue(statement.args[1]);
        target.status = status;
        doc.statusEvents.push({
          type: 'status',
          objectId: targetId,
          status,
          line: statement.line,
          column: statement.column
        });
        continue;
      }
      if (command === 'fail') {
        const failureReason = normalizeArgValue(statement.args[1]);
        target.status = 'failed';
        target.failureReason = failureReason;
        doc.statusEvents.push({
          type: 'fail',
          objectId: targetId,
          status: 'failed',
          reason: failureReason,
          line: statement.line,
          column: statement.column
        });
        continue;
      }
      if (command === 'deactivate') {
        const reason = normalizeArgValue(statement.args[1]);
        target.status = 'deactivated';
        target.deactivatedReason = reason;
        doc.statusEvents.push({
          type: 'deactivate',
          objectId: targetId,
          status: 'deactivated',
          reason,
          line: statement.line,
          column: statement.column
        });
      }
    }

    for (const intent of doc.intents.values()) {
      intent.output = intent.fields.output || null;
      intent.context = intent.fields.context || null;
      intent.criterion = intent.fields.criterion || null;
      intent.evidence = intent.fields.evidence || null;
      intent.outputLabel = intent.fields.outputLabel || null;
    }

    for (const seed of doc.seeds.values()) {
      seed.domain = seed.fields.domain || null;
      seed.evidenceNeed = seed.fields.evidenceNeed || null;
      seed.priority = seed.fields.priority || null;
      seed.state = seed.fields.state || 'active';
      if (seed.status == null) seed.status = seed.state;
      if (seed.splitFromIds.length > 0) seed.splitFrom = seed.splitFromIds[0];
    }

    for (const subproblem of doc.subproblems.values()) {
      subproblem.reason = subproblem.fields.reason || null;
      subproblem.successSignal = subproblem.fields.successSignal || null;
    }

    for (const plugin of doc.plugins.values()) {
      Object.assign(plugin, plugin.fields);
    }

    for (const ku of doc.kus.values()) {
      for (const fieldName of KU_REQUIRED_FIELDS) {
        ku[fieldName] = ku.fields[fieldName] ?? null;
      }
      ku.title = ku.fields.title || null;
      ku.role = ku.fields.role || null;
      ku.topic = ku.fields.topic || null;
      ku.claim = ku.fields.claim || null;
      ku.procedure = ku.fields.procedure || null;
      ku.condition = ku.fields.condition || null;
      ku.utilityActs = ku.fields.utilityActs || ROLE_TO_UTILITY_ACTS[ku.role] || ['explain'];
      ku.utilityNote = ku.fields.utilityNote || null;
      ku.phaseScopes = ku.fields.phaseScopes || ['kb-plugin'];
      ku.symbolicSubject = ku.fields.symbolicSubject || null;
      ku.symbolicRelation = ku.fields.symbolicRelation || null;
      ku.symbolicObject = ku.fields.symbolicObject || null;
      ku.confidence = ku.fields.confidence ?? null;
      ku.hash = ku.fields.hash || null;
      ku.sourceName = ku.fields.sourceName || null;
      ku.sourceType = ku.fields.sourceType || null;
      ku.author = ku.fields.author || null;
      ku.ingestedAt = ku.fields.ingestedAt || null;
      ku.knowledgeDate = ku.fields.knowledgeDate || null;
      ku.chunkIndex = ku.fields.chunkIndex ?? null;
      ku.unitIndex = ku.fields.unitIndex ?? null;
      ku.unitType = ku.fields.unitType || null;
      ku.textBody = ku.fields.textBody || null;
      ku.charStart = ku.fields.charStart ?? null;
      ku.charEnd = ku.fields.charEnd ?? null;
      ku.createdAt = ku.fields.createdAt || null;
      ku.chunkType = ku.fields.chunkType || null;
      ku.sectionTitle = ku.fields.sectionTitle || null;
      ku.parentUnitIds = [...ku.parentIds];
      ku.childUnitIds = [];
      ku.derivedFromUnitIds = [...ku.derivedFromIds];
    }

    for (const ku of doc.kus.values()) {
      for (const parentId of ku.parentUnitIds) {
        const parent = doc.kus.get(parentId);
        if (parent && !parent.childUnitIds.includes(ku.id)) {
          parent.childUnitIds.push(ku.id);
        }
      }
    }

    for (const validationTarget of doc.validations.values()) {
      validationTarget.mode = validationTarget.mode || validationTarget.fields.mode || validationTarget.mode;
      for (const fieldName of VALIDATION_REQUIRED_FIELDS) {
        validationTarget[fieldName] = validationTarget.fields[fieldName] ?? null;
      }
    }

    for (const policy of doc.policies.values()) {
      policy.validationFloor = policy.validationFloor || policy.fields.validationFloor || null;
    }

    for (const objective of doc.objectives.values()) {
      objective.targetIds = [...(objective.targetIds || [])];
    }

    for (const candidate of doc.candidates.values()) {
      candidate.score = candidate.fields.score ?? null;
      candidate.selected = candidate.fields.selected ?? null;
    }

    for (const comparison of doc.comparisons.values()) {
      comparison.status = comparison.fields.status || null;
      comparison.criterion = comparison.fields.criterion || null;
      comparison.summary = comparison.fields.summary || comparison.summary || null;
    }

    for (const challenge of doc.challenges.values()) {
      challenge.status = challenge.fields.status || null;
      challenge.resolution = challenge.fields.resolution || null;
      challenge.severity = challenge.fields.severity || challenge.severity || null;
    }

    for (const branch of doc.branches.values()) {
      branch.validationId = branch.validationId || null;
      branch.status = branch.status || branch.fields.status || 'queued';
      branch.failureReason = branch.failureReason || branch.fields.failureReason || null;
    }

    for (const result of doc.results.values()) {
      result.validationStatus = result.fields.validationStatus || null;
      result.preservesConstraints = result.fields.preservesConstraints || null;
      result.structuralComplete = result.fields.structuralComplete || null;
      result.body = result.fields.body || null;
    }

    return doc;
  }

  toLegacyIntentGroups(document) {
    return mapWithIndex(document.intents, (intent, index) => ({
      intentId: intent.id,
      groupNumber: index + 1,
      act: String(intent.act || '').toLowerCase(),
      intent: intent.target,
      context: intent.context || null,
      criterion: intent.criterion || null,
      evidence: intent.evidence || null,
      output: intent.output || '',
      outputLabel: intent.outputLabel || null
    }));
  }

  toLegacyContextUnits(document) {
    return mapWithIndex(document.kus, ku => ({
      id: ku.kuId || ku.id,
      kuType: ku.kuType || null,
      title: ku.title || null,
      sourceId: ku.sourceId || '',
      sourceName: ku.sourceName || null,
      sourceType: ku.sourceType || null,
      author: ku.author || null,
      ingestedAt: ku.ingestedAt || null,
      knowledgeDate: ku.knowledgeDate || null,
      chunkId: ku.chunkId || '',
      chunkIndex: ku.chunkIndex ?? null,
      unitIndex: ku.unitIndex ?? null,
      unitType: ku.unitType || null,
      textBody: ku.textBody || null,
      role: ku.role || '',
      topic: ku.topic || '',
      claim: ku.claim || null,
      condition: ku.condition || null,
      procedure: ku.procedure || null,
      utilityActs: [...(ku.utilityActs || [])],
      utilityNote: ku.utilityNote || null,
      hash: ku.hash || null,
      subject: ku.symbolicSubject || null,
      relation: ku.symbolicRelation || null,
      object: ku.symbolicObject || null,
      confidence: ku.confidence ?? null,
      parentUnitIds: [...(ku.parentUnitIds || [])],
      childUnitIds: [...(ku.childUnitIds || [])],
      derivedFromUnitIds: [...(ku.derivedFromUnitIds || [])],
      charStart: ku.charStart ?? null,
      charEnd: ku.charEnd ?? null,
      createdAt: ku.createdAt || null,
      chunkType: ku.chunkType || null,
      sectionTitle: ku.sectionTitle || null,
      phaseScopes: [...(ku.phaseScopes || [])]
    }));
  }
}
