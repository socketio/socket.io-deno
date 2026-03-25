import { assertEquals, describe, it } from "../../../test_deps.ts";
import { createHandshakeBase } from "../lib/client.ts";

describe("client handshake metadata", () => {
  it("should derive secure and cross-domain flags from the request URL and origin", () => {
    const connInfo = {
      remoteAddr: {
        transport: "tcp",
        hostname: "127.0.0.1",
        port: 1234,
      },
    } as Deno.ServeHandlerInfo;

    const sameOriginHandshake = createHandshakeBase(
      new Request("https://example.com/socket.io/?EIO=4&transport=polling", {
        headers: {
          origin: "https://example.com",
        },
      }),
      connInfo,
    );

    assertEquals(sameOriginHandshake.secure, true);
    assertEquals(sameOriginHandshake.xdomain, false);

    const crossOriginHandshake = createHandshakeBase(
      new Request("https://example.com/socket.io/?EIO=4&transport=polling", {
        headers: {
          origin: "https://other.example.com",
        },
      }),
      connInfo,
    );

    assertEquals(crossOriginHandshake.secure, true);
    assertEquals(crossOriginHandshake.xdomain, true);
  });
});
