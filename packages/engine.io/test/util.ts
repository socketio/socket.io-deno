import { Server } from "../lib/server.ts";
import * as log from "../../../test_deps.ts";
import { serve } from "../../../test_deps.ts";

export function testServe(
  engine: Server,
  callback: (port: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve) => {
    const abortController = new AbortController();

    serve(engine.handler(), {
      onListen: async ({ port }) => {
        await callback(port);

        // close the server
        abortController.abort();
        engine.close();
        setTimeout(resolve, 5);
      },
      signal: abortController.signal,
    });
  });
}

function createPartialDone(
  count: number,
  resolve: () => void,
  reject: (reason: string) => void,
) {
  let i = 0;
  return () => {
    if (++i === count) {
      resolve();
    } else if (i > count) {
      reject(`called too many times: ${i} > ${count}`);
    }
  };
}

export function testServeWithAsyncResults(
  engine: Server,
  count: number,
  callback: (port: number, partialDone: () => void) => Promise<void> | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortController = new AbortController();

    serve(engine.handler(), {
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

export function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export async function parseSessionID(response: Response): Promise<string> {
  const body = await response.text();
  return JSON.parse(body.substring(1)).sid;
}

export function enableLogs() {
  return log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("DEBUG"),
    },
    loggers: {
      "engine.io": {
        level: "ERROR", // set to "DEBUG" to display the logs
        handlers: ["console"],
      },
    },
  });
}
