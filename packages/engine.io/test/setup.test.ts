import { Server } from "../lib/server.ts";
import { createPartialDone } from "../../util.test.ts";

export function setup(
  engine: Server,
  count: number,
  callback: (port: number, partialDone: () => void) => Promise<void> | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortController = new AbortController();

    Deno.serve({
      handler: engine.handler(),
      onListen: ({ port }) => {
        const partialDone = createPartialDone(count, () => {
          // close the server
          abortController.abort();
          engine.close();
          setTimeout(resolve, 10);
        }, reject);

        return callback(port, partialDone);
      },
      signal: abortController.signal,
    });
  });
}
