import { SOPLexicalError } from './errors.mjs';

function unescapeQuotedText(raw) {
  return raw.replace(/\\(.)/g, (_match, escaped) => {
    if (escaped === 'n') return '\n';
    if (escaped === 't') return '\t';
    return escaped;
  });
}

export class SOPTokenizer {
  tokenize(sourceText = '') {
    const lines = String(sourceText || '').replace(/\r/g, '').split('\n');
    const tokens = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const lineNumber = lineIndex + 1;
      const line = lines[lineIndex];
      let cursor = 0;

      while (cursor < line.length) {
        const char = line[cursor];
        if (/\s/.test(char)) {
          cursor += 1;
          continue;
        }

        const column = cursor + 1;

        if (char === '[' || char === ']') {
          tokens.push({
            type: char === '[' ? 'list-open' : 'list-close',
            value: char,
            line: lineNumber,
            column,
            endColumn: column
          });
          cursor += 1;
          continue;
        }

        if (char === '"') {
          let raw = '';
          let escaped = false;
          cursor += 1;
          while (cursor < line.length) {
            const current = line[cursor];
            if (!escaped && current === '"') break;
            if (!escaped && current === '\\') {
              escaped = true;
              raw += current;
              cursor += 1;
              continue;
            }
            escaped = false;
            raw += current;
            cursor += 1;
          }
          if (cursor >= line.length || line[cursor] !== '"') {
            throw new SOPLexicalError('Unterminated quoted string', {
              line: lineNumber,
              column
            });
          }
          tokens.push({
            type: 'string',
            value: unescapeQuotedText(raw),
            rawValue: raw,
            line: lineNumber,
            column,
            endColumn: cursor + 1
          });
          cursor += 1;
          continue;
        }

        let value = '';
        while (cursor < line.length) {
          const current = line[cursor];
          if (/\s/.test(current) || current === '[' || current === ']') break;
          value += current;
          cursor += 1;
        }

        const type = value.startsWith('@')
          ? 'statement-id'
          : value.startsWith('$')
            ? 'reference'
            : 'atom';

        tokens.push({
          type,
          value,
          line: lineNumber,
          column,
          endColumn: cursor
        });
      }

      tokens.push({
        type: 'newline',
        value: '\n',
        line: lineNumber,
        column: line.length + 1,
        endColumn: line.length + 1
      });
    }

    return tokens;
  }
}

