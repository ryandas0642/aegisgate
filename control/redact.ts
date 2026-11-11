const sensitiveKey =
  /^(?:authorization|password|secret|apiKey|api_key|credentials|accessToken|refreshToken|sessionToken)$/i;
export function redact(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED]')
      .replace(
        /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g,
        '[REDACTED]',
      )
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        '[REDACTED]',
      );
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : redact(child),
      ]),
    );
  return value;
}
