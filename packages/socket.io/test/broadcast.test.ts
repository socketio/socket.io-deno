import { assertEquals, describe, it } from "../../../test_deps.ts";
import { Server } from "../lib/server.ts";
import {
  eioPoll,
  enableLogs,
  runHandshake,
  testServeWithAsyncResults,
} from "./util.ts";

await enableLogs();

describe("broadcast", () => {
  it("should emit to all sockets", () => {
    const io = new Server({
      pingInterval: 50,
    });

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        io.of("/custom");

        const [sid1] = await runHandshake(port);
        const [sid2] = await runHandshake(port);
        const [sid3] = await runHandshake(port, "/custom");

        io.of("/").emit("foo", "bar");

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid1),
          eioPoll(port, sid2),
          eioPoll(port, sid3),
        ]);

        assertEquals(body1, '42["foo","bar"]');
        assertEquals(body2, '42["foo","bar"]');
        assertEquals(body3, "2");

        // drain buffer
        await eioPoll(port, sid1);
        await eioPoll(port, sid2);

        done();
      },
    );
  });

  it("should emit to all sockets in a room", () => {
    const io = new Server({
      pingInterval: 50,
    });

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        io.of("/custom");

        io.once("connection", (socket) => {
          socket.join("room1");
        });

        const [sid1] = await runHandshake(port);
        const [sid2] = await runHandshake(port);
        const [sid3] = await runHandshake(port, "/custom");

        io.to("room1").emit("foo", "bar");

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid1),
          eioPoll(port, sid2),
          eioPoll(port, sid3),
        ]);

        assertEquals(body1, '42["foo","bar"]');
        assertEquals(body2, "2");
        assertEquals(body3, "2");

        // drain buffer
        await eioPoll(port, sid1);

        done();
      },
    );
  });
});
