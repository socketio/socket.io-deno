import { assertEquals, describe, it } from "../../../test_deps.ts";
import { enableLogs } from "../../util.test.ts";
import { setup } from "./setup.test.ts";

await enableLogs();

describe("fetchSockets() method", () => {
  it("should return all socket instances", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io } = servers[0];

        const sockets = await io.fetchSockets();

        assertEquals(sockets.length, 3);

        done();
      },
    );
  });

  it("should return all socket instances in a room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io } = servers[0];

        servers[2].socket.join("room1");

        const sockets = await io.in("room1").fetchSockets();

        assertEquals(sockets.length, 1);

        done();
      },
    );
  });
});
