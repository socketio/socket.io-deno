import { assertEquals, describe, it } from "../../../test_deps.ts";
import { enableLogs, sleep } from "../../util.test.ts";
import { setup } from "./setup.test.ts";

await enableLogs();

describe("socketsLeave() method", () => {
  it("should make all socket instances leave the specified room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, socket } = servers[0];

        socket.join("room1");
        servers[2].socket.join("room1");

        io.socketsLeave("room1");

        await sleep(100);

        assertEquals(socket.rooms.has("room1"), false);
        assertEquals(servers[1].socket.rooms.has("room1"), false);
        assertEquals(servers[2].socket.rooms.has("room1"), false);

        done();
      },
    );
  });

  it("should make the matching socket instances leave the specified room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, socket } = servers[0];

        socket.join(["room1", "room2"]);
        servers[1].socket.join(["room1", "room2"]);
        servers[2].socket.join("room2");

        io.in("room1").socketsLeave("room2");

        await sleep(100);

        assertEquals(socket.rooms.has("room2"), false);
        assertEquals(servers[1].socket.rooms.has("room2"), false);
        assertEquals(servers[2].socket.rooms.has("room2"), true);

        done();
      },
    );
  });
});
