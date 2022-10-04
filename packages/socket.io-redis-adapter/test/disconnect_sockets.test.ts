import { assertEquals, describe, it } from "../../../test_deps.ts";
import { eioPoll, enableLogs, sleep } from "../../util.test.ts";
import { setup } from "./setup.test.ts";

await enableLogs();

describe("disconnectSockets() method", () => {
  it("should make all socket instances disconnect", () => {
    return setup(
      4,
      async (servers, partialDone) => {
        const { io, port, sid, socket } = servers[0];

        socket.on("disconnect", partialDone);
        servers[1].socket.on("disconnect", partialDone);
        servers[2].socket.on("disconnect", partialDone);

        io.disconnectSockets();

        await sleep(100);

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[1].port, servers[1].sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        assertEquals(body1, "41");
        assertEquals(body2, "41");
        assertEquals(body3, "41");

        partialDone();
      },
    );
  });
});
