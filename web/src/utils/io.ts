import { isLeft } from 'fp-ts/lib/Either';
import * as io from 'io-ts';
import { PathReporter } from 'io-ts/PathReporter';

export function isOptional(x: io.Mixed): io.Mixed | io.NullC | io.UndefinedC {
  return io.union([x, io.null, io.undefined]);
}

export function decode<T>(type: io.Mixed, data: unknown): T {
  const result = type.decode(data);
  if (isLeft(result))
    throw new Error(`Could not decode data: ${PathReporter.report(result).join('\n')}`);
  return result.right;
}

export function encode<T>(type: io.Mixed, data: unknown): T {
  return type.encode(data);
}
