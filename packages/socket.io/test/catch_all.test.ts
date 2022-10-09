import { assertEquals, describe, fail, it } from "../../../test_deps.ts";
import { Server } from "../lib/server.ts";
import { testServeWithAsyncResults } from "./util.ts";
import { Socket } from "../lib/socket.ts";
import {
  eioPoll,
  eioPush,
  enableLogs,
  runHandshake,
  waitFor,
} from "../../util.test.ts";

await enableLogs();

describe("catch-all listeners", () => {
  it("should catch all incoming packets", () => {
    const io = new Server();

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        const [[sid], socket] = await Promise.all([
          runHandshake(port),
          waitFor<Socket>(io, "connection"),
        ]);

        socket.onAnyIncoming((...args) => {
          assertEquals(args[0], "random");
          assertEquals(args[1], 1);
          assertEquals(args[2], "2");
          assertEquals(args[3], [3]);

          done();
        });

        await eioPush(port, sid, '42["random",1,"2",[3]]');
      },
    );
  });

  it("should remove the incoming catch-all listener", () => {
    const io = new Server();

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        const [[sid], socket] = await Promise.all([
          runHandshake(port),
          waitFor<Socket>(io, "connection"),
        ]);

        const listener = () => {
          fail("should not happen");
        };

        socket.onAnyIncoming(listener);
        socket.onAnyIncoming(done);

        socket.offAnyIncoming(listener);

        await eioPush(port, sid, '42["random",1,"2",[3]]');
      },
    );
  });

  it("should catch all outgoing packets", () => {
    const io = new Server();

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        const [[sid], socket] = await Promise.all([
          runHandshake(port),
          waitFor<Socket>(io, "connection"),
        ]);

        socket.onAnyOutgoing((...args) => {
          assertEquals(args[0], "random");
          assertEquals(args[1], 1);
          assertEquals(args[2], "2");
          assertEquals(args[3], [3]);

          done();
        });

        socket.emit("random", 1, "2", [3]);

        await eioPoll(port, sid);
      },
    );
  });

  it("should catch all outgoing packets (broadcast)", () => {
    const io = new Server();

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        const [[sid], socket] = await Promise.all([
          runHandshake(port),
          waitFor<Socket>(io, "connection"),
        ]);

        socket.onAnyOutgoing((...args) => {
          assertEquals(args[0], "random");
          assertEquals(args[1], 1);
          assertEquals(args[2], "2");
          assertEquals(args[3], [3]);

          done();
        });

        io.emit("random", 1, "2", [3]);

        await eioPoll(port, sid);
      },
    );
  });

  it("should catch all outgoing packets (broadcast with binary)", () => {
    const io = new Server();

    return testServeWithAsyncResults(
      io,
      1,
      async (port, done) => {
        const [[sid], socket] = await Promise.all([
          runHandshake(port),
          waitFor<Socket>(io, "connection"),
        ]);

        socket.onAnyOutgoing((...args) => {
          assertEquals(args[0], "random");
          assertEquals(args[1], Uint8Array.from([1, 2, 3]));

          done();
        });

        io.emit("random", Uint8Array.from([1, 2, 3]));

        await eioPoll(port, sid);
      },
    );
  });
});
