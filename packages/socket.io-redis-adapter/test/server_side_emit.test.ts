import {
  assertArrayIncludes,
  assertEquals,
  assertIsError,
  describe,
  fail,
  it,
} from "../../../test_deps.ts";
import { eioPoll, enableLogs } from "../../util.test.ts";
import { setup } from "./setup.test.ts";

await enableLogs();

describe("serverSideEmit() method", () => {
  it("should send an event to other server instances", () => {
    return setup(
      2,
      (servers, partialDone) => {
        const { io } = servers[0];

        io.on("hello", () => {
          fail("should not happen");
        });

        servers[1].io.on("hello", (arg1, arg2, arg3) => {
          assertEquals(arg1, "world");
          assertEquals(arg2, 1);
          assertEquals(arg3, "2");

          partialDone();
        });

        servers[2].io.on("hello", (arg1, arg2, arg3) => {
          assertEquals(arg1, "world");
          assertEquals(arg2, 1);
          assertEquals(arg3, "2");

          partialDone();
        });

        io.serverSideEmit("hello", "world", 1, "2");
      },
    );
  });

  it("should send an event and receive a response from the other server instances", () => {
    return setup(
      1,
      (servers, done) => {
        const { io } = servers[0];

        io.on("hello", () => {
          fail("should not happen");
        });

        servers[1].io.on("hello", (cb) => {
          cb(2);
        });

        servers[2].io.on("hello", (cb) => {
          cb("3");
        });

        io.serverSideEmit("hello", (err: Error, responses: unknown[]) => {
          assertEquals(err, null);
          assertArrayIncludes(responses, [2, "3"]);

          done();
        });
      },
    );
  });

  it("should send an event but timeout if one server does not responds", () => {
    return setup(
      1,
      (servers, done) => {
        const { io } = servers[0];

        io.on("hello", () => {
          fail("should not happen");
        });

        servers[1].io.on("hello", (cb) => {
          cb(2);
        });

        servers[2].io.on("hello", () => {
          // do nothing
        });

        io.serverSideEmit("hello", async (err: Error, responses: unknown[]) => {
          assertIsError(err);
          assertArrayIncludes(responses, [2]);

          // drain buffer
          await Promise.all([
            eioPoll(servers[0].port, servers[0].sid),
            eioPoll(servers[1].port, servers[1].sid),
            eioPoll(servers[2].port, servers[2].sid),
          ]);

          done();
        });
      },
    );
  });
});
