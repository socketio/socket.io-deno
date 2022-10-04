import {
  assertArrayIncludes,
  assertEquals,
  describe,
  it,
} from "../../../test_deps.ts";
import { eioPoll, eioPush, enableLogs, sleep } from "../../util.test.ts";
import { setup } from "./setup.test.ts";

await enableLogs();

describe("broadcast", () => {
  it("should emit to all sockets", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, port, sid } = servers[0];

        io.emit("foo", "bar");

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[1].port, servers[1].sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        assertEquals(body1, '42["foo","bar"]');
        assertEquals(body2, '42["foo","bar"]');
        assertEquals(body3, '42["foo","bar"]');

        done();
      },
    );
  });

  it("should emit to all sockets in a room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, port, sid } = servers[0];

        servers[1].socket.join("room1");

        io.to("room1").emit("foo", "bar");

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[1].port, servers[1].sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        assertEquals(body1, "2");
        assertEquals(body2, '42["foo","bar"]');
        assertEquals(body3, "2");

        // drain buffer
        await eioPoll(servers[1].port, servers[1].sid);

        done();
      },
    );
  });

  it("should emit to all sockets in a room (number) ", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, port, sid } = servers[0];

        servers[1].socket.join(123);

        io.to(123).emit("foo", "bar");

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[1].port, servers[1].sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        assertEquals(body1, "2");
        assertEquals(body2, '42["foo","bar"]');
        assertEquals(body3, "2");

        // drain buffer
        await eioPoll(servers[1].port, servers[1].sid);

        done();
      },
    );
  });

  it("should emit to all sockets except those in a room", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io, port, sid } = servers[0];

        servers[1].socket.join("room1");

        io.except("room1").emit("foo", "bar");

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[1].port, servers[1].sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        assertEquals(body1, '42["foo","bar"]');
        assertEquals(body2, "2");
        assertEquals(body3, '42["foo","bar"]');

        // drain buffer
        await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        done();
      },
    );
  });

  it("should emit binary to all sockets", () => {
    return setup(
      1,
      async (servers, done) => {
        const { io } = servers[0];

        io.emit("foo", Uint8Array.from([1, 2, 3, 4]));

        for (const { port, sid } of servers) {
          const body = await eioPoll(port, sid);
          if (body.includes("\x1e")) {
            assertEquals(
              body,
              '451-["foo",{"_placeholder":true,"num":0}]\x1ebAQIDBA==',
            );
          } else {
            const body2 = await eioPoll(port, sid);
            assertEquals(body, '451-["foo",{"_placeholder":true,"num":0}]');
            assertEquals(body2, "bAQIDBA==");
          }
        }

        done();
      },
    );
  });

  it("should emit to all sockets with multiple acknowledgements", () => {
    return setup(
      2,
      async (servers, partialDone) => {
        const { io, port, sid } = servers[0];

        io.timeout(100).emit(
          "foo",
          "bar",
          (err: Error, responses: unknown[]) => {
            assertEquals(err, null);
            assertArrayIncludes(responses, [1, 2, 3]);

            partialDone();
          },
        );

        const [body1, body2, body3] = await Promise.all([
          eioPoll(port, sid),
          eioPoll(servers[1].port, servers[1].sid),
          eioPoll(servers[2].port, servers[2].sid),
        ]);

        assertEquals(body1, '420["foo","bar"]');
        assertEquals(body2, '420["foo","bar"]');
        assertEquals(body3, '420["foo","bar"]');

        await Promise.all([
          eioPush(port, sid, "430[1]"),
          eioPush(servers[1].port, servers[1].sid, "430[2]"),
          eioPush(servers[2].port, servers[2].sid, "430[3]"),
        ]);

        // wait for ackRequest delayed removal
        await sleep(100);

        partialDone();
      },
    );
  });
});
