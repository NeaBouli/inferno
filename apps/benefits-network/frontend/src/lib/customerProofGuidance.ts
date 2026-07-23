export function formatRetryGuidance(
  reason: string | null | undefined,
  attemptsRemaining: number | null | undefined
) {
  const message = reason || 'This wallet does not meet the current IFR requirements.';
  if (!attemptsRemaining) return message;

  return `${message} ${attemptsRemaining} verification attempt${attemptsRemaining === 1 ? '' : 's'} left.`;
}
