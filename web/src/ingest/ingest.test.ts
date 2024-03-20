import '@vitest/web-worker';

import { newIngestWorker } from './ingest';

describe('ingestWorker', () => {
  it('should work', async () => {
    const script = "print(string.format('input: %s', input))";
    const input = "hello world";
    await new Promise((result) => {
      const onmessage = (event) => {
        expect(event.data).toStrictEqual(1);
        result();
      };
      const worker = newIngestWorker(script, input, onmessage);
    });
  }, 100); // 100ms timeout
});
