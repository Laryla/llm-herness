export function maskSecret(value: string): string {
  if (value.length <= 4) {
    return "•".repeat(value.length);
  }
  return `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

function redactText(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (text, secret) => (secret.length === 0 ? text : text.replaceAll(secret, "[REDACTED]")),
    value,
  );
}

export function sanitizeForLogging(
  value: unknown,
  secrets: readonly string[],
): unknown {
  const orderedSecrets = [...secrets].sort((left, right) => right.length - left.length);
  const seen = new WeakSet<object>();

  const sanitize = (current: unknown): unknown => {
    if (typeof current === "string") {
      return redactText(current, orderedSecrets);
    }
    if (current instanceof Error) {
      return {
        name: current.name,
        message: redactText(current.message, orderedSecrets),
        stack: current.stack
          ? redactText(current.stack, orderedSecrets)
          : undefined,
      };
    }
    if (Array.isArray(current)) {
      return current.map(sanitize);
    }
    if (current === null || typeof current !== "object") {
      return current;
    }
    if (seen.has(current)) {
      return "[Circular]";
    }
    seen.add(current);
    return Object.fromEntries(
      Object.entries(current).map(([key, nested]) => [key, sanitize(nested)]),
    );
  };

  return sanitize(value);
}
