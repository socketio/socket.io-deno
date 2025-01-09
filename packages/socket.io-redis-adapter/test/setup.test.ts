import { Server, Socket } from "../../socket.io/mod.ts";
import { createPartialDone, runHandshake, waitFor } from "../../util.test.ts";
import { connect } from "../../../vendor/deno.land/x/redis@v0.27.1/mod.ts";
import { createAdapter } from "../mod.ts";

function createRedisClient() {
  return connect({
    hostname: "localhost",
  });
}

interface TestServer {
  io: Server;
  port: number;
  socket: Socket;
  sid: string;
  cleanup: () => void;
}

function createServer(port: number): Promise<TestServer> {
  return new Promise((resolve) => {
    Promise.all([createRedisClient(), createRedisClient()]).then(
      ([pubClient, subClient]) => {
        const io = new Server({
          pingInterval: 200,
          adapter: createAdapter(pubClient, subClient),
        });

        const abortController = new AbortController();

        return Deno.serve({
          handler: io.handler(),
          port,
          signal: abortController.signal,
          onListen: async () => {
            const [
              [sid],
              socket,
            ] = await Promise.all([
              runHandshake(port),
              waitFor<Socket>(io, "connection"),
            ]);

            resolve({
              io,
              port,
              sid,
              socket,
              cleanup() {
                abortController.abort();
                io.close();
                pubClient.close();
                subClient.close();
              },
            });
          },
        });
      },
    );
  });
}

export function setup(
  count: number,
  callback: (
    servers: Array<TestServer>,
    done: () => void,
  ) => Promise<void> | void,
): Promise<void> {
  return Promise.all([
    createServer(8000),
    createServer(8001),
    createServer(8002),
  ]).then((servers) => {
    return new Promise((resolve, reject) => {
      const partialDone = createPartialDone(count, () => {
        setTimeout(() => servers.forEach((server) => server.cleanup()), 10);
        setTimeout(resolve, 30);
      }, reject);

      callback(servers, partialDone);
    });
  });
}
