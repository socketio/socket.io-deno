import { assertEquals, describe, it } from "../../../test_deps.ts";
import { enableLogs, sleep } from "../../util.test.ts";
import { setup } from "./setup.test.ts";

await enableLogs();

describe("socketsJoin() method", () => {
  it("should make all socket instances join the specified room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, socket } = servers[0];

        io.socketsJoin("room1");

        await sleep(100);

        assertEquals(socket.rooms.has("room1"), true);
        assertEquals(servers[1].socket.rooms.has("room1"), true);
        assertEquals(servers[2].socket.rooms.has("room1"), true);

        done();
      },
    );
  });

  it("should make the matching socket instances join the specified room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, socket } = servers[0];

        socket.join("room1");
        servers[2].socket.join("room1");

        io.in("room1").socketsJoin("room2");

        await sleep(100);

        assertEquals(socket.rooms.has("room2"), true);
        assertEquals(servers[1].socket.rooms.has("room2"), false);
        assertEquals(servers[2].socket.rooms.has("room2"), true);
        assertEquals(servers[2].socket.rooms.has("room1"), true);

        done();
      },
    );
  });
});
