// DS007 — CNL validator/parser compatibility facade
import {
  PRAGMATIC_ACTS, PRAGMATIC_ROLES,
  SYMBOLIC_RELATIONS, CONTEXT_PHASE_SCOPES,
  INTENT_REQUIRED_FIELDS, INTENT_ALLOWED_FIELDS,
  CONTEXT_REQUIRED_FIELDS, CONTEXT_ALLOWED_FIELDS,
  normalizePhaseScopes, inferPhaseScopes
} from '../../mrp-vm-sdk/knowledge/pragmatics.mjs';
import { SOPValidator } from '../interpreter/validator.mjs';
import { SOPInterpreter } from '../interpreter/interpreter.mjs';

export function looksLikeSOPDocument(text = '') {
  return /^\s*@/.test(String(text || ''));
}

function isBlank(text = '') {
  return String(text || '').trim() === '';
}

function parseBlocks(markdown, headingRe) {
  const lines = String(markdown || '').split('\n');
  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(headingRe);
    if (match) {
      if (current) blocks.push(current);
      current = {
        heading: lines[i],
        headingMatch: match,
        lineStart: i + 1,
        fields: {},
        fieldOrder: [],
        rawLines: []
      };
      continue;
    }
    if (current) current.rawLines.push({ text: lines[i], lineNum: i + 1 });
  }
  if (current) blocks.push(current);
  return blocks;
}

function parseFields(block) {
  const fields = {};
  const fieldOrder = [];
  let lastField = null;
  for (const { text, lineNum } of block.rawLines) {
    if (text.trim() === '') {
      lastField = null;
      continue;
    }
    if (/^ {2,}/.test(text) && lastField) {
      fields[lastField].value += ` ${text.trim()}`;
      continue;
    }
    if (/^##/.test(text.trim())) {
      fields.__MALFORMED__ = fields.__MALFORMED__ || [];
      fields.__MALFORMED__.push({ lineNum, text });
      continue;
    }
    const colonIdx = text.indexOf(':');
    if (colonIdx === -1) {
      if (lastField) {
        fields[lastField].value += ` ${text.trim()}`;
      }
      continue;
    }
    const name = text.slice(0, colonIdx).trim();
    const value = text.slice(colonIdx + 1).trim();
    fields[name] = { value, lineNum };
    fieldOrder.push(name);
    lastField = name;
  }
  block.fields = fields;
  block.fieldOrder = fieldOrder;
  return block;
}

class LegacyCNLValidator {
  validateIntentCNL(markdown) {
    const errors = [];
    const blocks = parseBlocks(markdown, /^## Intent Group (\d+)$/);
    if (blocks.length === 0) {
      errors.push({ code: 'INVALID_HEADING_FORMAT', line: 1, column: 1, field: null, message: 'No Intent Group headings found' });
      return { valid: false, errors };
    }
    let expectedNum = 1;
    for (const block of blocks) {
      const num = Number.parseInt(block.headingMatch[1], 10);
      if (num !== expectedNum) {
        errors.push({
          code: 'INVALID_GROUP_NUMBER',
          line: block.lineStart,
          column: 1,
          field: null,
          message: `Expected Intent Group ${expectedNum}, got ${num}`
        });
      }
      expectedNum = num + 1;
      parseFields(block);
      if (block.fields.__MALFORMED__) {
        for (const malformed of block.fields.__MALFORMED__) {
          errors.push({
            code: 'MALFORMED_LINE',
            line: malformed.lineNum,
            column: 1,
            field: null,
            message: `Malformed line: ${malformed.text}`
          });
        }
      }
      for (const field of INTENT_REQUIRED_FIELDS) {
        if (!block.fields[field]) {
          errors.push({
            code: 'MISSING_REQUIRED_FIELD',
            line: block.lineStart,
            column: 1,
            field,
            message: `Required field '${field}' is missing in Intent Group ${num}`
          });
        }
      }
      for (const field of block.fieldOrder) {
        if (!INTENT_ALLOWED_FIELDS.includes(field)) {
          errors.push({
            code: 'UNKNOWN_FIELD',
            line: block.fields[field].lineNum,
            column: 1,
            field,
            message: `Unknown field '${field}' in Intent Group ${num}`
          });
        }
      }
      if (block.fields.Act) {
        const actVal = block.fields.Act.value.trim().toLowerCase();
        if (!actVal) {
          errors.push({
            code: 'INVALID_ACT_VALUE',
            line: block.fields.Act.lineNum,
            column: 1,
            field: 'Act',
            message: `Empty Act value in Intent Group ${num}`
          });
        } else if (!PRAGMATIC_ACTS.includes(actVal)) {
          errors.push({
            code: 'INVALID_ACT_VALUE',
            line: block.fields.Act.lineNum,
            column: 1,
            field: 'Act',
            message: `Invalid Act '${actVal}' in Intent Group ${num}`
          });
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  validateContextCNL(markdown) {
    const errors = [];
    const blocks = parseBlocks(markdown, /^## Context Unit (.+)$/);
    if (blocks.length === 0) {
      errors.push({ code: 'INVALID_HEADING_FORMAT', line: 1, column: 1, field: null, message: 'No Context Unit headings found' });
      return { valid: false, errors };
    }
    for (const block of blocks) {
      const unitId = block.headingMatch[1].trim();
      parseFields(block);
      if (block.fields.__MALFORMED__) {
        for (const malformed of block.fields.__MALFORMED__) {
          errors.push({
            code: 'MALFORMED_LINE',
            line: malformed.lineNum,
            column: 1,
            field: null,
            message: `Malformed line: ${malformed.text}`
          });
        }
      }
      for (const field of CONTEXT_REQUIRED_FIELDS) {
        if (!block.fields[field]) {
          errors.push({
            code: 'MISSING_REQUIRED_FIELD',
            line: block.lineStart,
            column: 1,
            field,
            message: `Required field '${field}' is missing in Context Unit ${unitId}`
          });
        }
      }
      for (const field of block.fieldOrder) {
        if (!CONTEXT_ALLOWED_FIELDS.includes(field)) {
          errors.push({
            code: 'UNKNOWN_FIELD',
            line: block.fields[field].lineNum,
            column: 1,
            field,
            message: `Unknown field '${field}' in Context Unit ${unitId}`
          });
        }
      }
      if (block.fields.Role) {
        const roleVal = block.fields.Role.value.trim();
        if (!PRAGMATIC_ROLES.includes(roleVal)) {
          errors.push({
            code: 'INVALID_ROLE_VALUE',
            line: block.fields.Role.lineNum,
            column: 1,
            field: 'Role',
            message: `Invalid Role '${roleVal}' in Context Unit ${unitId}`
          });
        }
      }
      if (block.fields.UtilityActs) {
        const acts = block.fields.UtilityActs.value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
        for (const act of acts) {
          if (!PRAGMATIC_ACTS.includes(act)) {
            errors.push({
              code: 'INVALID_ACT_VALUE',
              line: block.fields.UtilityActs.lineNum,
              column: 1,
              field: 'UtilityActs',
              message: `Invalid UtilityAct '${act}' in Context Unit ${unitId}`
            });
          }
        }
      }
      if (block.fields.PhaseScopes) {
        const scopes = normalizePhaseScopes(block.fields.PhaseScopes.value.split(','));
        const rawScopes = block.fields.PhaseScopes.value.split(',').map(item => item.trim()).filter(Boolean);
        if (scopes.length !== rawScopes.length) {
          errors.push({
            code: 'INVALID_PHASE_SCOPE',
            line: block.fields.PhaseScopes.lineNum,
            column: 1,
            field: 'PhaseScopes',
            message: `Invalid PhaseScopes value in Context Unit ${unitId}`
          });
        }
        for (const scope of scopes) {
          if (!CONTEXT_PHASE_SCOPES.includes(scope)) {
            errors.push({
              code: 'INVALID_PHASE_SCOPE',
              line: block.fields.PhaseScopes.lineNum,
              column: 1,
              field: 'PhaseScopes',
              message: `Invalid PhaseScope '${scope}' in Context Unit ${unitId}`
            });
          }
        }
      }
      const hasSubject = !!block.fields.Subject;
      const hasRelation = !!block.fields.Relation;
      const hasObject = !!block.fields.Object;
      const hasConfidence = !!block.fields.Confidence;
      if (hasSubject || hasRelation || hasObject || hasConfidence) {
        if (!(hasSubject && hasRelation && hasObject)) {
          errors.push({
            code: 'INCOMPLETE_SYMBOLIC_FACT',
            line: block.lineStart,
            column: 1,
            field: null,
            message: `Context Unit ${unitId} must provide Subject, Relation, and Object together`
          });
        }
        if (hasRelation) {
          const relationVal = block.fields.Relation.value.trim();
          if (!SYMBOLIC_RELATIONS.includes(relationVal)) {
            errors.push({
              code: 'INVALID_RELATION_VALUE',
              line: block.fields.Relation.lineNum,
              column: 1,
              field: 'Relation',
              message: `Invalid Relation '${relationVal}' in Context Unit ${unitId}`
            });
          }
        }
        if (hasConfidence) {
          const raw = block.fields.Confidence.value.trim();
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
            errors.push({
              code: 'INVALID_CONFIDENCE_VALUE',
              line: block.fields.Confidence.lineNum,
              column: 1,
              field: 'Confidence',
              message: `Invalid Confidence '${raw}' in Context Unit ${unitId}`
            });
          }
        }
      }
      const role = block.fields.Role?.value.trim();
      const hasClaim = !!block.fields.Claim;
      const hasProcedure = !!block.fields.Procedure;
      if (hasClaim && hasProcedure) {
        errors.push({
          code: 'CLAIM_AND_PROCEDURE_CONFLICT',
          line: block.lineStart,
          column: 1,
          field: null,
          message: `Context Unit ${unitId} has both Claim and Procedure`
        });
      }
      if (role === 'Procedure' && !hasProcedure) {
        errors.push({
          code: 'MISSING_PROCEDURE_FOR_ROLE',
          line: block.lineStart,
          column: 1,
          field: 'Procedure',
          message: `Context Unit ${unitId} has Role=Procedure but no Procedure field`
        });
      }
      if (role && role !== 'Procedure' && !hasClaim) {
        errors.push({
          code: 'MISSING_CLAIM_FOR_ROLE',
          line: block.lineStart,
          column: 1,
          field: 'Claim',
          message: `Context Unit ${unitId} has Role=${role} but no Claim field`
        });
      }
    }
    return { valid: errors.length === 0, errors };
  }
}

class LegacyCNLParser {
  parseIntentCNL(markdown) {
    const blocks = parseBlocks(markdown, /^## Intent Group (\d+)$/);
    return blocks.map(block => {
      parseFields(block);
      const num = Number.parseInt(block.headingMatch[1], 10);
      const act = block.fields.Act?.value.trim().toLowerCase();
      if (!act) throw new Error(`Intent Group ${num} missing Act field`);
      return {
        groupNumber: num,
        act,
        intent: block.fields.Intent?.value.trim() || '',
        context: block.fields.Context?.value.trim() || null,
        criterion: block.fields.Criterion?.value.trim() || null,
        evidence: block.fields.Evidence?.value.trim() || null,
        output: block.fields.Output?.value.trim() || ''
      };
    });
  }

  parseContextCNL(markdown) {
    const blocks = parseBlocks(markdown, /^## Context Unit (.+)$/);
    return blocks.map(block => {
      parseFields(block);
      const id = block.headingMatch[1].trim();
      const role = block.fields.Role?.value.trim() || '';
      const utilityActsRaw = block.fields.UtilityActs?.value || '';
      let utilityActs = utilityActsRaw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
      if (!utilityActs.length && role) {
        const roleActs = {
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
        utilityActs = roleActs[role] || ['explain'];
      }
      const parseCsv = fieldName =>
        (block.fields[fieldName]?.value || '')
          .split(',')
          .map(item => item.trim())
          .filter(Boolean);
      const parseInteger = fieldName => {
        const raw = block.fields[fieldName]?.value?.trim();
        if (!raw) return null;
        const parsed = Number(raw);
        return Number.isInteger(parsed) ? parsed : null;
      };
      return {
        phaseScopes: inferPhaseScopes({
          role,
          topic: block.fields.Topic?.value.trim() || '',
          claim: block.fields.Claim?.value.trim() || null,
          procedure: block.fields.Procedure?.value.trim() || null,
          utilityActs,
          utilityNote: block.fields.UtilityNote?.value.trim() || null,
          title: block.fields.Title?.value.trim() || null,
          phaseScopes: normalizePhaseScopes(parseCsv('PhaseScopes'))
        }),
        id,
        kuType: block.fields.KUType?.value.trim() || null,
        title: block.fields.Title?.value.trim() || null,
        sourceId: block.fields.SourceId?.value.trim() || '',
        sourceName: block.fields.SourceName?.value.trim() || null,
        sourceType: block.fields.SourceType?.value.trim() || null,
        author: block.fields.Author?.value.trim() || null,
        ingestedAt: block.fields.IngestedAt?.value.trim() || null,
        knowledgeDate: block.fields.KnowledgeDate?.value.trim() || null,
        chunkId: block.fields.ChunkId?.value.trim() || '',
        chunkIndex: parseInteger('ChunkIndex'),
        unitIndex: parseInteger('UnitIndex'),
        unitType: block.fields.UnitType?.value.trim() || null,
        textBody: block.fields.TextBody?.value.trim() || null,
        role,
        topic: block.fields.Topic?.value.trim() || '',
        claim: block.fields.Claim?.value.trim() || null,
        condition: block.fields.Condition?.value.trim() || null,
        procedure: block.fields.Procedure?.value.trim() || null,
        utilityActs,
        utilityNote: block.fields.UtilityNote?.value.trim() || null,
        hash: block.fields.Hash?.value.trim() || null,
        subject: block.fields.Subject?.value.trim() || null,
        relation: block.fields.Relation?.value.trim() || null,
        object: block.fields.Object?.value.trim() || null,
        confidence: block.fields.Confidence ? Number(block.fields.Confidence.value.trim()) : null,
        parentUnitIds: parseCsv('ParentUnitIds'),
        childUnitIds: parseCsv('ChildUnitIds'),
        derivedFromUnitIds: parseCsv('DerivedFromUnitIds'),
        charStart: parseInteger('CharStart'),
        charEnd: parseInteger('CharEnd'),
        createdAt: block.fields.CreatedAt?.value.trim() || null,
        chunkType: block.fields.ChunkType?.value.trim() || null,
        sectionTitle: block.fields.SectionTitle?.value.trim() || null
      };
    });
  }
}

export class CNLValidator {
  constructor() {
    this.legacy = new LegacyCNLValidator();
    this.sopValidator = new SOPValidator();
  }

  validateIntentCNL(text) {
    return looksLikeSOPDocument(text)
      ? this.sopValidator.validateDocument(text, { documentKind: 'intent' })
      : this.legacy.validateIntentCNL(text);
  }

  validateContextCNL(text) {
    return looksLikeSOPDocument(text)
      ? this.sopValidator.validateDocument(text, { documentKind: 'context' })
      : this.legacy.validateContextCNL(text);
  }
}

export class CNLParser {
  constructor() {
    this.legacy = new LegacyCNLParser();
    this.sopInterpreter = new SOPInterpreter();
  }

  interpretDocument(text, options = {}) {
    if (!looksLikeSOPDocument(text)) {
      throw new Error('Legacy Markdown CNL cannot be interpreted as SOP directly');
    }
    return this.sopInterpreter.interpretDocument(text, options);
  }

  parseIntentCNL(text) {
    if (isBlank(text)) return [];
    if (looksLikeSOPDocument(text)) {
      const document = this.sopInterpreter.interpretDocument(text, { documentKind: 'intent' });
      return this.sopInterpreter.toLegacyIntentGroups(document);
    }
    return this.legacy.parseIntentCNL(text);
  }

  parseContextCNL(text) {
    if (isBlank(text)) return [];
    if (looksLikeSOPDocument(text)) {
      const document = this.sopInterpreter.interpretDocument(text, { documentKind: 'context' });
      return this.sopInterpreter.toLegacyContextUnits(document);
    }
    return this.legacy.parseContextCNL(text);
  }
}
