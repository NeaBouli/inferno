/**
 * External audit IFRUNIT 2026-10-11 (IFR-DEV-13): Wiki text placed into the system prompt must not be
 * able to close the data block it sits in. Every section marker this server writes ("--- ... ---")
 * uses a run of three dashes, so runs of three or more dash, equals or underscore characters in
 * untrusted text are collapsed to one en dash; page text then cannot imitate
 * "--- END LIVE WIKI SNAPSHOT ---" or "--- END WIKI ---" and continue as fake instructions.
 * Ordinary prose is left unchanged.
 */
export function neutralizePromptDelimiters(text: string): string {
  return text.replace(/[-=_\u2010-\u2015\u2212]{3,}/g, "\u2013");
}
