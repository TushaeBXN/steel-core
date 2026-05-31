export function validateSpecInput(input: unknown): string {
  if (typeof input === 'string') {
    if (input.length > 5_000_000) throw new Error('Input too large (max 5 MB)');
    return input;
  }
  if (input && typeof input === 'object') {
    const serialized = JSON.stringify(input);
    if (serialized.length > 5_000_000) throw new Error('Input too large (max 5 MB)');
    return serialized;
  }
  throw new Error('Invalid input: must be a string or object');
}

export function validateLanguage(lang: unknown): 'python' | 'typescript' {
  if (lang === 'python' || lang === 'typescript') return lang;
  throw new Error(`Unsupported language: ${String(lang)}. Must be "python" or "typescript".`);
}

export function sanitizeOutputPath(outputPath: unknown): string {
  if (typeof outputPath !== 'string') throw new Error('outputPath must be a string');
  // Reject path traversal attempts
  if (outputPath.includes('..') || outputPath.startsWith('/')) {
    throw new Error('Invalid output path: must be a relative path without ".."');
  }
  return outputPath;
}
