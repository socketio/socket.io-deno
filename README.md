# Socket.IO server for Deno

An implementation of the Socket.IO protocol for Deno.

Table of content:

- [Usage](#usage)
  - [With oak](#with-oak)
- [Options](#options)
  - [`path`](#path)
  - [`connectTimeout`](#connecttimeout)
  - [`pingTimeout`](#pingtimeout)
  - [`pingInterval`](#pinginterval)
  - [`upgradeTimeout`](#upgradetimeout)
  - [`maxHttpBufferSize`](#maxhttpbuffersize)
  - [`allowRequest`](#allowrequest)
  - [`cors`](#cors)
  - [`editHandshakeHeaders`](#edithandshakeheaders)
  - [`editResponseHeaders`](#editresponseheaders)
- [Logs](#logs)
- [Adapters](#adapters)
  - [Redis adapter](#redis-adapter)

## Usage

```ts
import { serve } from "https://deno.land/std@0.220.1/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";

const io = new Server();

io.on("connection", (socket) => {
  console.log(`socket ${socket.id} connected`);

  socket.emit("hello", "world");

  socket.on("disconnect", (reason) => {
    console.log(`socket ${socket.id} disconnected due to ${reason}`);
  });
});

await serve(io.handler(), {
  port: 3000,
});
```

And then run with:

```
$ deno run --allow-net index.ts
```

Like the [Node.js server](https://socket.io/docs/v4/typescript/), you can also
provide types for the events sent between the server and the clients:

```ts
interface ServerToClientEvents {
  noArg: () => void;
  basicEmit: (a: number, b: string, c: Buffer) => void;
  withAck: (d: string, callback: (e: number) => void) => void;
}

interface ClientToServerEvents {
  hello: () => void;
}

interface InterServerEvents {
  ping: () => void;
}

interface SocketData {
  user_id: string;
}

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>();
```

### With oak

You need to use the [.handle()](https://github.com/oakserver/oak#handle-method)
method:

```ts
import { serve } from "https://deno.land/std@0.220.1/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";
import { Application } from "https://deno.land/x/oak@14.2.0/mod.ts";

const app = new Application();

app.use((ctx) => {
  ctx.response.body = "Hello World!";
});

const io = new Server();

io.on("connection", (socket) => {
  console.log(`socket ${socket.id} connected`);

  socket.emit("hello", "world");

  socket.on("disconnect", (reason) => {
    console.log(`socket ${socket.id} disconnected due to ${reason}`);
  });
});

const handler = io.handler(async (req) => {
  return await app.handle(req) || new Response(null, { status: 404 });
});

await serve(handler, {
  port: 3000,
});
```

## Options

### `path`

Default value: `/socket.io/`

It is the name of the path that is captured on the server side.

Caution! The server and the client values must match (unless you are using a
path-rewriting proxy in between).

Example:

```ts
const io = new Server(httpServer, {
  path: "/my-custom-path/",
});
```

### `connectTimeout`

Default value: `45000`

The number of ms before disconnecting a client that has not successfully joined
a namespace.

### `pingTimeout`

Default value: `20000`

This value is used in the heartbeat mechanism, which periodically checks if the
connection is still alive between the server and the client.

The server sends a ping, and if the client does not answer with a pong within
`pingTimeout` ms, the server considers that the connection is closed.

Similarly, if the client does not receive a ping from the server within
`pingInterval + pingTimeout` ms, the client also considers that the connection
is closed.

### `pingInterval`

Default value: `25000`

See [`pingTimeout`](#pingtimeout) for more explanation.

### `upgradeTimeout`

Default value: `10000`

This is the delay in milliseconds before an uncompleted transport upgrade is
cancelled.

### `maxHttpBufferSize`

Default value: `1e6` (1 MB)

This defines how many bytes a single message can be, before closing the socket.
You may increase or decrease this value depending on your needs.

### `allowRequest`

Default value: `-`

A function that receives a given handshake or upgrade request as its first
parameter, and can decide whether to continue or not.

Example:

```ts
const io = new Server({
  allowRequest: (req, connInfo) => {
    return Promise.reject("thou shall not pass");
  },
});
```

### `cors`

Default value: `-`

A set of options related to
[Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
(CORS).

Example:

```ts
const io = new Server({
  cors: {
    origin: ["https://example.com"],
    allowedHeaders: ["my-header"],
    credentials: true,
  },
});
```

### `editHandshakeHeaders`

Default value: `-`

A function that allows to edit the response headers of the handshake request.

Example:

```ts
const io = new Server({
  editHandshakeHeaders: (responseHeaders, req, connInfo) => {
    responseHeaders.set("set-cookie", "sid=1234");
  },
});
```

### `editResponseHeaders`

Default value: `-`

A function that allows to edit the response headers of all requests.

Example:

```ts
const io = new Server({
  editResponseHeaders: (responseHeaders, req, connInfo) => {
    responseHeaders.set("my-header", "abcd");
  },
});
```

## Logs

The library relies on the standard `log` module, so you can display the internal
logs of the Socket.IO server with:

```ts
import * as log from "https://deno.land/std@0.166.0/log/mod.ts";

await log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG"),
  },
  loggers: {
    "socket.io": {
      level: "DEBUG",
      handlers: ["console"],
    },
    "engine.io": {
      level: "DEBUG",
      handlers: ["console"],
    },
  },
});
```

## Adapters

Custom adapters can be used to broadcast packets between several Socket.IO
servers.

### Redis adapter

Documentation: https://socket.io/docs/v4/redis-adapter/

```js
import { serve } from "https://deno.land/std@0.220.1/http/server.ts";
import {
  createRedisAdapter,
  createRedisClient,
  Server,
} from "https://deno.land/x/socket_io@0.2.0/mod.ts";

const [pubClient, subClient] = await Promise.all([
  createRedisClient({
    hostname: "localhost",
  }),
  createRedisClient({
    hostname: "localhost",
  }),
]);

const io = new Server({
  adapter: createRedisAdapter(pubClient, subClient),
});

await serve(io.handler(), {
  port: 3000,
});
```

## License

[ISC](/LICENSE)
