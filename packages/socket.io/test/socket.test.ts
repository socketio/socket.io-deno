import { assertEquals, describe, it } from "../../../test_deps.ts";
import { Server } from "../lib/server.ts";
import { enableLogs, runHandshake, testServeWithAsyncResults } from "./util.ts";

await enableLogs();

describe("socket", () => {
  it("should keep track of rooms", () => {
    const io = new Server();

    return testServeWithAsyncResults(
      io,
      2,
      async (port, partialDone) => {
        io.on("connection", (socket) => {
          assertEquals(socket.rooms.size, 1);
          assertEquals(socket.rooms.has(socket.id), true);

          socket.join("room1");

          assertEquals(socket.rooms.size, 2);
          assertEquals(socket.rooms.has("room1"), true);

          socket.leave("room1");

          assertEquals(socket.rooms.size, 1);
          assertEquals(socket.rooms.has("room1"), false);

          socket.join("room2");

          socket.on("disconnecting", () => {
            assertEquals(socket.rooms.has("room2"), true);

            partialDone();
          });

          socket.on("disconnect", () => {
            assertEquals(socket.rooms.size, 0);

            partialDone();
          });

          socket.disconnect();
        });

        await runHandshake(port);
      },
    );
  });
});
