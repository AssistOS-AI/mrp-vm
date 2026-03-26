// DS007 — CNL Validator & Parser (fully symbolic)
import {
  PRAGMATIC_ACTS, PRAGMATIC_ROLES,
  INTENT_REQUIRED_FIELDS, INTENT_ALLOWED_FIELDS,
  CONTEXT_REQUIRED_FIELDS, CONTEXT_ALLOWED_FIELDS
} from '../lib/pragmatics.mjs';

// ── Shared parsing helpers ──

function parseBlocks(markdown, headingRe) {
  const lines = markdown.split('\n');
  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      if (current) blocks.push(current);
      current = { heading: lines[i], headingMatch: m, lineStart: i + 1, fields: {}, fieldOrder: [], rawLines: [] };
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
    if (text.trim() === '') { lastField = null; continue; }
    // Continuation line: 2+ leading spaces
    if (/^ {2,}/.test(text) && lastField) {
      fields[lastField].value += ' ' + text.trim();
      continue;
    }
    // ## at start of value → malformed
    if (/^##/.test(text.trim())) {
      fields['__MALFORMED__'] = fields['__MALFORMED__'] || [];
      fields['__MALFORMED__'].push({ lineNum, text });
      continue;
    }
    const colonIdx = text.indexOf(':');
    if (colonIdx === -1) {
      // Not a field line, treat as continuation if possible
      if (lastField) { fields[lastField].value += ' ' + text.trim(); continue; }
      continue;
    }
    const name = text.substring(0, colonIdx).trim();
    const value = text.substring(colonIdx + 1).trim();
    fields[name] = { value, lineNum };
    fieldOrder.push(name);
    lastField = name;
  }
  block.fields = fields;
  block.fieldOrder = fieldOrder;
  return block;
}

// ── Intent CNL Validator ──

export class CNLValidator {
  validateIntentCNL(markdown) {
    const errors = [];
    const blocks = parseBlocks(markdown, /^## Intent Group (\d+)$/);
    if (blocks.length === 0) {
      errors.push({ code: 'INVALID_HEADING_FORMAT', line: 1, column: 1, field: null, message: 'No Intent Group headings found' });
      return { valid: false, errors };
    }
    let expectedNum = 1;
    for (const block of blocks) {
      const num = parseInt(block.headingMatch[1], 10);
      if (num !== expectedNum) {
        errors.push({ code: 'INVALID_GROUP_NUMBER', line: block.lineStart, column: 1, field: null,
          message: `Expected Intent Group ${expectedNum}, got ${num}` });
      }
      expectedNum = num + 1;
      parseFields(block);
      if (block.fields['__MALFORMED__']) {
        for (const m of block.fields['__MALFORMED__']) {
          errors.push({ code: 'MALFORMED_LINE', line: m.lineNum, column: 1, field: null, message: `Malformed line: ${m.text}` });
        }
      }
      // Check required fields
      for (const f of INTENT_REQUIRED_FIELDS) {
        if (!block.fields[f]) {
          errors.push({ code: 'MISSING_REQUIRED_FIELD', line: block.lineStart, column: 1, field: f,
            message: `Required field '${f}' is missing in Intent Group ${num}` });
        }
      }
      // Check unknown fields
      for (const f of block.fieldOrder) {
        if (!INTENT_ALLOWED_FIELDS.includes(f)) {
          errors.push({ code: 'UNKNOWN_FIELD', line: block.fields[f].lineNum, column: 1, field: f,
            message: `Unknown field '${f}' in Intent Group ${num}` });
        }
      }
      // Check Act enum
      if (block.fields['Act']) {
        const actVal = block.fields['Act'].value.trim().toLowerCase();
        if (!actVal) {
          errors.push({ code: 'INVALID_ACT_VALUE', line: block.fields['Act'].lineNum, column: 1, field: 'Act',
            message: `Empty Act value in Intent Group ${num}` });
        } else if (!PRAGMATIC_ACTS.includes(actVal)) {
          errors.push({ code: 'INVALID_ACT_VALUE', line: block.fields['Act'].lineNum, column: 1, field: 'Act',
            message: `Invalid Act '${actVal}' in Intent Group ${num}` });
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
      if (block.fields['__MALFORMED__']) {
        for (const m of block.fields['__MALFORMED__']) {
          errors.push({ code: 'MALFORMED_LINE', line: m.lineNum, column: 1, field: null, message: `Malformed line: ${m.text}` });
        }
      }
      // Required fields
      for (const f of CONTEXT_REQUIRED_FIELDS) {
        if (!block.fields[f]) {
          errors.push({ code: 'MISSING_REQUIRED_FIELD', line: block.lineStart, column: 1, field: f,
            message: `Required field '${f}' is missing in Context Unit ${unitId}` });
        }
      }
      // Unknown fields
      for (const f of block.fieldOrder) {
        if (!CONTEXT_ALLOWED_FIELDS.includes(f)) {
          errors.push({ code: 'UNKNOWN_FIELD', line: block.fields[f].lineNum, column: 1, field: f,
            message: `Unknown field '${f}' in Context Unit ${unitId}` });
        }
      }
      // Role enum
      if (block.fields['Role']) {
        const roleVal = block.fields['Role'].value.trim();
        if (!PRAGMATIC_ROLES.includes(roleVal)) {
          errors.push({ code: 'INVALID_ROLE_VALUE', line: block.fields['Role'].lineNum, column: 1, field: 'Role',
            message: `Invalid Role '${roleVal}' in Context Unit ${unitId}` });
        }
      }
      // UtilityActs enum check
      if (block.fields['UtilityActs']) {
        const acts = block.fields['UtilityActs'].value.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
        for (const a of acts) {
          if (!PRAGMATIC_ACTS.includes(a)) {
            errors.push({ code: 'INVALID_ACT_VALUE', line: block.fields['UtilityActs'].lineNum, column: 1, field: 'UtilityActs',
              message: `Invalid UtilityAct '${a}' in Context Unit ${unitId}` });
          }
        }
      }
      // Claim/Procedure mutual exclusion
      const role = block.fields['Role']?.value.trim();
      const hasClaim = !!block.fields['Claim'];
      const hasProcedure = !!block.fields['Procedure'];
      if (hasClaim && hasProcedure) {
        errors.push({ code: 'CLAIM_AND_PROCEDURE_CONFLICT', line: block.lineStart, column: 1, field: null,
          message: `Context Unit ${unitId} has both Claim and Procedure` });
      }
      if (role === 'Procedure' && !hasProcedure) {
        errors.push({ code: 'MISSING_PROCEDURE_FOR_ROLE', line: block.lineStart, column: 1, field: 'Procedure',
          message: `Context Unit ${unitId} has Role=Procedure but no Procedure field` });
      }
      if (role && role !== 'Procedure' && !hasClaim) {
        errors.push({ code: 'MISSING_CLAIM_FOR_ROLE', line: block.lineStart, column: 1, field: 'Claim',
          message: `Context Unit ${unitId} has Role=${role} but no Claim field` });
      }
    }
    return { valid: errors.length === 0, errors };
  }
}

// ── Intent CNL Parser ──

export class CNLParser {
  parseIntentCNL(markdown) {
    const blocks = parseBlocks(markdown, /^## Intent Group (\d+)$/);
    return blocks.map(block => {
      parseFields(block);
      const num = parseInt(block.headingMatch[1], 10);
      const act = block.fields['Act']?.value.trim().toLowerCase();
      if (!act) throw new Error(`Intent Group ${num} missing Act field`);
      return {
        groupNumber: num,
        act,
        intent: block.fields['Intent']?.value.trim() || '',
        context: block.fields['Context']?.value.trim() || null,
        criterion: block.fields['Criterion']?.value.trim() || null,
        evidence: block.fields['Evidence']?.value.trim() || null,
        output: block.fields['Output']?.value.trim() || ''
      };
    });
  }

  parseContextCNL(markdown) {
    const blocks = parseBlocks(markdown, /^## Context Unit (.+)$/);
    return blocks.map(block => {
      parseFields(block);
      const id = block.headingMatch[1].trim();
      const utilityActsRaw = block.fields['UtilityActs']?.value || '';
      return {
        id,
        sourceId: block.fields['SourceId']?.value.trim() || '',
        chunkId: block.fields['ChunkId']?.value.trim() || '',
        role: block.fields['Role']?.value.trim() || '',
        topic: block.fields['Topic']?.value.trim() || '',
        claim: block.fields['Claim']?.value.trim() || null,
        condition: block.fields['Condition']?.value.trim() || null,
        procedure: block.fields['Procedure']?.value.trim() || null,
        utilityActs: utilityActsRaw.split(',').map(a => a.trim().toLowerCase()).filter(Boolean),
        utilityNote: block.fields['UtilityNote']?.value.trim() || null
      };
    });
  }
}
