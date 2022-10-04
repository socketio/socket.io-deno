import {
  Server as Engine,
  ServerOptions as EngineOptions,
} from "../../engine.io/mod.ts";
import {
  DefaultEventsMap,
  EventEmitter,
  EventNames,
  EventParams,
  EventsMap,
} from "../../event-emitter/mod.ts";
import { getLogger, type Handler } from "../../../deps.ts";
import { Client } from "./client.ts";
import { Decoder, Encoder } from "../../socket.io-parser/mod.ts";
import { Namespace, NamespaceReservedEvents } from "./namespace.ts";
import { ParentNamespace } from "./parent-namespace.ts";
import { Socket } from "./socket.ts";
import { Adapter, InMemoryAdapter, Room } from "./adapter.ts";
import { BroadcastOperator, RemoteSocket } from "./broadcast-operator.ts";

export interface ServerOptions {
  /**
   * Name of the request path to handle
   * @default "/socket.io/"
   */
  path: string;
  /**
   * Duration in milliseconds before a client without namespace is closed
   * @default 45000
   */
  connectTimeout: number;
  /**
   * The parser to use to encode and decode packets
   */
  parser: {
    createEncoder(): Encoder;
    createDecoder(): Decoder;
  };
  /**
   * The adapter to use to forward packets between several Socket.IO servers
   */
  adapter: (
    nsp: Namespace,
  ) => Adapter;
}

export interface ServerReservedEvents<
  ListenEvents,
  EmitEvents,
  ServerSideEvents,
  SocketData,
> extends
  NamespaceReservedEvents<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  > {
  new_namespace: (
    namespace: Namespace<
      ListenEvents,
      EmitEvents,
      ServerSideEvents,
      SocketData
    >,
  ) => void;
}

type ParentNspNameMatchFn = (
  name: string,
  auth: Record<string, unknown>,
) => Promise<void>;

export class Server<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = unknown,
> extends EventEmitter<
  ListenEvents,
  EmitEvents,
  ServerReservedEvents<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >
> {
  public readonly engine: Engine;
  public readonly mainNamespace: Namespace<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >;
  public readonly opts: ServerOptions;

  /* private */ readonly _encoder: Encoder;

  /* private */ _nsps: Map<
    string,
    Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
  > = new Map();

  private parentNsps: Map<
    ParentNspNameMatchFn,
    ParentNamespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
  > = new Map();

  constructor(opts: Partial<ServerOptions & EngineOptions> = {}) {
    super();

    this.opts = Object.assign({
      path: "/socket.io/",
      connectTimeout: 45_000,
      parser: {
        createEncoder() {
          return new Encoder();
        },
        createDecoder() {
          return new Decoder();
        },
      },
      adapter: (
        nsp: Namespace,
      ) => new InMemoryAdapter(nsp),
    }, opts);

    this.engine = new Engine(this.opts);

    this.engine.on("connection", (conn, req, connInfo) => {
      getLogger("socket.io").debug(
        `[server] incoming connection with id ${conn.id}`,
      );
      new Client(this, this.opts.parser.createDecoder(), conn, req, connInfo);
    });

    this._encoder = this.opts.parser.createEncoder();

    const mainNamespace = this.of("/");

    ["on", "once", "off", "emit", "listeners"].forEach((method) => {
      // @ts-ignore FIXME proper typing
      this[method] = function () {
        // @ts-ignore FIXME proper typing
        return mainNamespace[method].apply(mainNamespace, arguments);
      };
    });

    this.mainNamespace = mainNamespace;
  }

  /**
   * Returns a request handler.
   *
   * @param additionalHandler - another handler which will receive the request if the path does not match
   */
  public handler(additionalHandler?: Handler) {
    return this.engine.handler(additionalHandler);
  }

  /**
   * Executes the middleware for an incoming namespace not already created on the server.
   *
   * @param name - name of incoming namespace
   * @param auth - the auth parameters
   * @param fn - callback
   *
   * @private
   */
  /* private */ async _checkNamespace(
    name: string,
    auth: Record<string, unknown>,
  ): Promise<void> {
    if (this.parentNsps.size === 0) return Promise.reject();

    for (const [isValid, parentNsp] of this.parentNsps) {
      try {
        await isValid(name, auth);
      } catch (_) {
        continue;
      }

      if (this._nsps.has(name)) {
        // the namespace was created in the meantime
        getLogger("socket.io").debug(
          `[server] dynamic namespace ${name} already exists`,
        );
      } else {
        const namespace = parentNsp._createChild(name);
        getLogger("socket.io").debug(
          `[server] dynamic namespace ${name} was created`,
        );
        this.emitReserved("new_namespace", namespace);
      }

      return Promise.resolve();
    }

    return Promise.reject();
  }

  /**
   * Looks up a namespace.
   *
   * @param name - nsp name
   */
  public of(
    name: string | RegExp | ParentNspNameMatchFn,
  ): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
    if (typeof name === "function" || name instanceof RegExp) {
      const parentNsp = new ParentNamespace(this);
      getLogger("socket.io").debug(
        `[server] initializing parent namespace ${parentNsp.name}`,
      );
      if (typeof name === "function") {
        this.parentNsps.set(name, parentNsp);
      } else {
        this.parentNsps.set(
          (nsp: string) =>
            (name as RegExp).test(nsp) ? Promise.resolve() : Promise.reject(),
          parentNsp,
        );
      }

      return parentNsp;
    }

    if (String(name)[0] !== "/") name = "/" + name;

    let nsp = this._nsps.get(name);
    if (!nsp) {
      getLogger("socket.io").debug(`[server] initializing namespace ${name}`);
      nsp = new Namespace(this, name);
      this._nsps.set(name, nsp);
      if (name !== "/") {
        this.emitReserved("new_namespace", nsp);
      }
    }

    return nsp;
  }

  /**
   * Closes the server
   */
  public close() {
    this.engine.close();
  }

  /**
   * Sets up namespace middleware.
   *
   * @param fn - the middleware function
   */
  public use(
    fn: (
      socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => Promise<void>,
  ): this {
    this.mainNamespace.use(fn);
    return this;
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return self
   */
  public to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
    return this.mainNamespace.to(room);
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return self
   */
  public in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
    return this.mainNamespace.in(room);
  }

  /**
   * Excludes a room when emitting.
   *
   * @param name
   * @return self
   */
  public except(
    name: Room | Room[],
  ): BroadcastOperator<EmitEvents, SocketData> {
    return this.mainNamespace.except(name);
  }

  /**
   * Sends a `message` event to all clients.
   *
   * @return self
   */
  public send(...args: EventParams<EmitEvents, "message">): this {
    this.mainNamespace.emit("message", ...args);
    return this;
  }

  /**
   * Emit a packet to other Socket.IO servers
   *
   * @param ev - the event name
   * @param args - an array of arguments, which may include an acknowledgement callback at the end
   */
  public serverSideEmit<Ev extends EventNames<ServerSideEvents>>(
    ev: Ev,
    ...args: EventParams<ServerSideEvents, Ev>
  ): boolean {
    return this.mainNamespace.serverSideEmit(ev, ...args);
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
   * receive messages (because of network slowness or other issues, or because they’re connected through long polling
   * and is in the middle of a request-response cycle).
   *
   * @return self
   */
  public get volatile(): BroadcastOperator<EmitEvents, SocketData> {
    return this.mainNamespace.volatile;
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
   *
   * @return self
   */
  public get local(): BroadcastOperator<EmitEvents, SocketData> {
    return this.mainNamespace.local;
  }

  /**
   * Adds a timeout in milliseconds for the next operation
   *
   * <pre><code>
   *
   * io.timeout(1000).emit("some-event", (err, responses) => {
   *   // ...
   * });
   *
   * </pre></code>
   *
   * @param timeout
   */
  public timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
    return this.mainNamespace.timeout(timeout);
  }

  /**
   * Returns the matching socket instances
   */
  public fetchSockets(): Promise<RemoteSocket<EmitEvents, SocketData>[]> {
    return this.mainNamespace.fetchSockets();
  }

  /**
   * Makes the matching socket instances join the specified rooms
   *
   * @param room
   */
  public socketsJoin(room: Room | Room[]): void {
    return this.mainNamespace.socketsJoin(room);
  }

  /**
   * Makes the matching socket instances leave the specified rooms
   *
   * @param room
   */
  public socketsLeave(room: Room | Room[]): void {
    return this.mainNamespace.socketsLeave(room);
  }

  /**
   * Makes the matching socket instances disconnect
   *
   * @param close - whether to close the underlying connection
   */
  public disconnectSockets(close = false): void {
    return this.mainNamespace.disconnectSockets(close);
  }
}
