export function isNumber(data: unknown): data is number {
  return typeof data === 'number';
}

export function isString(data: unknown): data is string {
  return typeof data === 'string';
}

export function percentString(value: number, precision = 0): string {
  return (value * 100).toFixed(precision) + '%';
}
