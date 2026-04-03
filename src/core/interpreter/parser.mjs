import { SOPTokenizer } from './tokenizer.mjs';
import { SOPParseError } from './errors.mjs';

const STATEMENT_ID_RE = /^@[A-Za-z0-9_:-]+$/;

function groupTokensByLine(tokens = []) {
  const lines = [];
  let current = [];
  for (const token of tokens) {
    if (token.type === 'newline') {
      lines.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export class SOPParser {
  constructor(tokenizer = new SOPTokenizer()) {
    this.tokenizer = tokenizer;
  }

  parseDocument(sourceText = '') {
    const tokens = this.tokenizer.tokenize(sourceText);
    const lines = groupTokensByLine(tokens);
    const statements = [];

    for (const lineTokens of lines) {
      if (lineTokens.length === 0) continue;
      statements.push(this._parseStatement(lineTokens));
    }

    return statements;
  }

  _parseStatement(lineTokens) {
    const [statementToken, commandToken, ...rest] = lineTokens;

    if (!statementToken || statementToken.type !== 'statement-id' || !STATEMENT_ID_RE.test(statementToken.value)) {
      throw new SOPParseError(
        'INVALID_STATEMENT_ID',
        'Statement must start with a valid @id token',
        statementToken || lineTokens[0] || { line: 1, column: 1 }
      );
    }

    if (!commandToken || commandToken.type !== 'atom') {
      throw new SOPParseError(
        'UNKNOWN_COMMAND',
        `Statement ${statementToken.value} is missing a command`,
        commandToken || statementToken
      );
    }

    const args = [];
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token.type === 'list-close') {
        throw new SOPParseError(
          'MALFORMED_LINE',
          `Unexpected ']' in statement ${statementToken.value}`,
          token
        );
      }
      if (token.type === 'list-open') {
        const items = [];
        let endToken = null;
        index += 1;
        while (index < rest.length) {
          const item = rest[index];
          if (item.type === 'list-close') {
            endToken = item;
            break;
          }
          if (!['atom', 'reference'].includes(item.type)) {
            throw new SOPParseError(
              'INVALID_ARGUMENT_KIND',
              'Lists may contain only atoms or references',
              item
            );
          }
          items.push({
            kind: item.type === 'reference' ? 'ref' : 'atom',
            value: item.value
          });
          index += 1;
        }
        if (!endToken) {
          throw new SOPParseError(
            'MALFORMED_LINE',
            `Unterminated list in statement ${statementToken.value}`,
            token
          );
        }
        args.push({
          kind: 'list',
          items,
          line: token.line,
          column: token.column,
          endColumn: endToken.endColumn
        });
        continue;
      }
      args.push({
        kind: token.type === 'reference' ? 'ref' : token.type,
        value: token.value,
        line: token.line,
        column: token.column,
        endColumn: token.endColumn
      });
    }

    return {
      id: statementToken.value,
      command: commandToken.value,
      args,
      line: statementToken.line,
      column: statementToken.column
    };
  }
}

