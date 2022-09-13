import { assertEquals, describe, it } from "../../../test_deps.ts";
import { Server } from "../lib/server.ts";
import {
  enableLogs,
  parseSessionID,
  testServe,
  testServeWithAsyncResults,
} from "./util.ts";

await enableLogs();

describe("response headers", () => {
  it("should send custom response headers", () => {
    const engine = new Server({
      editHandshakeHeaders: (responseHeaders) => {
        responseHeaders.set("abc", "123");
      },
      editResponseHeaders: (responseHeaders) => {
        responseHeaders.set("def", "456");
      },
    });

    return testServe(engine, async (port) => {
      const response = await fetch(
        `http://localhost:${port}/engine.io/?EIO=4&transport=polling`,
        {
          method: "get",
        },
      );

      assertEquals(response.headers.get("abc"), "123");
      assertEquals(response.headers.get("def"), "456");

      const sid = await parseSessionID(response);

      const dataResponse = await fetch(
        `http://localhost:${port}/engine.io/?EIO=4&transport=polling&sid=${sid}`,
        {
          method: "post",
          body: "4hello",
        },
      );

      assertEquals(dataResponse.headers.has("abc"), false);
      assertEquals(dataResponse.headers.get("def"), "456");

      // consume the response body
      await dataResponse.body?.cancel();
    });
  });

  it("should not crash when using WebSocket (noop)", () => {
    const engine = new Server({
      editHandshakeHeaders: (responseHeaders) => {
        responseHeaders.set("abc", "123");
      },
      editResponseHeaders: (responseHeaders) => {
        responseHeaders.set("def", "456");
      },
    });

    return testServeWithAsyncResults(engine, 1, (port, done) => {
      const socket = new WebSocket(
        `ws://localhost:${port}/engine.io/?EIO=4&transport=websocket`,
      );

      socket.onopen = done;
    });
  });
});
