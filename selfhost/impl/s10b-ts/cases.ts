import { readFiles } from './reader.ts';
import { parseFiles } from './parser.ts';

export function generateCases(input) {
  try {
    const { files, entry } = readFiles(input);

    const parsed = parseFiles(files, entry);

    if (parsed.diagnostics.some(d => d.level === 'error')) {
      const errorCount = parsed.diagnostics.filter(d => d.level === 'error').length;
      return {
        cases: [],
        errors: errorCount,
      };
    }

    return {
      cases: [],
      errors: 0,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('bad_request:')) {
      throw err;
    }
    throw err;
  }
}
