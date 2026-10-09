import { z } from 'zod';

/**
 * Characters that must never appear in seller/admin texts that reach the customer-signed checkout
 * proof (one field per line): C0 controls U+0000-U+001F (incl. LF, CR, TAB), DEL U+007F,
 * C1 controls U+0080-U+009F (incl. NEL U+0085) and the Unicode line/paragraph separators
 * U+2028/U+2029. Any of them could start a new visual line and inject a fake field.
 */
// eslint-disable-next-line no-control-regex
const SIGNED_TEXT_FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const SIGNED_TEXT_CONTROL_CHARACTER_MESSAGE =
  'Text must not contain control characters or line/paragraph separators';

export function containsSignedTextControlCharacter(value: string): boolean {
  return SIGNED_TEXT_FORBIDDEN_CHARACTERS.test(value);
}

/** Shared zod refinement for every rule/product/tier text write path. */
export function signedTextSafe<T extends z.ZodString>(schema: T) {
  return schema.refine(
    (value) => !containsSignedTextControlCharacter(value),
    SIGNED_TEXT_CONTROL_CHARACTER_MESSAGE
  );
}
