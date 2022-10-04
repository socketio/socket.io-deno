import {
  DefaultEventsMap,
  EventEmitter,
  EventNames,
  EventParams,
  EventsMap,
} from "../../event-emitter/mod.ts";
import { Handshake, Socket } from "./socket.ts";
import { Server, ServerReservedEvents } from "./server.ts";
import { Adapter, Room, SocketId } from "./adapter.ts";
import { Client } from "./client.ts";
import { getLogger } from "../../../deps.ts";
import { BroadcastOperator, RemoteSocket } from "./broadcast-operator.ts";

export interface NamespaceReservedEvents<
  ListenEvents extends EventsMap,
  EmitEvents extends EventsMap,
  ServerSideEvents extends EventsMap,
  SocketData,
> {
  connection: (
    socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ) => void;
}

export const RESERVED_EVENTS: ReadonlySet<string | symbol> = new Set<
  keyof ServerReservedEvents<never, never, never, never>
>(["connection", "new_namespace"] as const);

export class Namespace<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = DefaultEventsMap,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = unknown,
> extends EventEmitter<
  ServerSideEvents,
  EmitEvents,
  NamespaceReservedEvents<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >
> {
  public readonly name: string;
  public readonly sockets: Map<
    SocketId,
    Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
  > = new Map();
  public adapter: Adapter;

  /* private */ readonly _server: Server<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >;

  /* private */ _fns: Array<
    (
      socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => Promise<void>
  > = [];

  /* private */ _ids = 0;

  constructor(
    server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    name: string,
  ) {
    super();
    this._server = server;
    this.name = name;
    this.adapter = server.opts.adapter(this as Namespace);
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
    this._fns.push(fn);
    return this;
  }

  /**
   * Executes the middleware for an incoming client.
   *
   * @param socket - the socket that will get added
   * @private
   */
  private async run(
    socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): Promise<void> {
    switch (this._fns.length) {
      case 0:
        return;
      case 1:
        return this._fns[0](socket);
      default:
        for (const fn of this._fns.slice()) {
          await fn(socket);
        }
    }
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return self
   */
  public to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
    return new BroadcastOperator(this.adapter).to(room);
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return self
   */
  public in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
    return new BroadcastOperator(this.adapter).in(room);
  }

  /**
   * Excludes a room when emitting.
   *
   * @param room
   * @return self
   */
  public except(
    room: Room | Room[],
  ): BroadcastOperator<EmitEvents, SocketData> {
    return new BroadcastOperator(this.adapter).except(room);
  }

  /**
   * Adds a new client
   *
   * @param client - the client
   * @param handshake - the handshake
   * @private
   */
  /* private */ async _add(
    client: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    handshake: Handshake,
    callback: (
      socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => void,
  ) {
    getLogger("socket.io").debug(
      `[namespace] adding socket to nsp ${this.name}`,
    );
    const socket = new Socket<
      ListenEvents,
      EmitEvents,
      ServerSideEvents,
      SocketData
    >(this, client, handshake);

    try {
      await this.run(socket);
    } catch (err) {
      getLogger("socket.io").debug(
        "[namespace] middleware error, sending CONNECT_ERROR packet to the client",
      );
      socket._cleanup();
      return socket._error({
        message: err.message || err,
        data: err.data,
      });
    }

    if (client.conn.readyState !== "open") {
      getLogger("socket.io").debug(
        "[namespace] next called after client was closed - ignoring socket",
      );
      socket._cleanup();
      return;
    }

    // track socket
    this.sockets.set(socket.id, socket);

    // it's paramount that the internal `onconnect` logic
    // fires before user-set events to prevent state order
    // violations (such as a disconnection before the connection
    // logic is complete)
    socket._onconnect();

    callback(socket);

    // fire user-set events
    this.emitReserved("connection", socket);
  }

  /**
   * Removes a client. Called by each `Socket`.
   *
   * @private
   */
  /* private */ _remove(
    socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): void {
    this.sockets.delete(socket.id);
  }

  /**
   * Emits to all clients.
   *
   * @return Always true
   */
  public emit<Ev extends EventNames<EmitEvents>>(
    ev: Ev,
    ...args: EventParams<EmitEvents, Ev>
  ): boolean {
    return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(
      ev,
      ...args,
    );
  }

  /**
   * Sends a `message` event to all clients.
   *
   * @return self
   */
  public send(...args: EventParams<EmitEvents, "message">): this {
    this.emit("message", ...args);
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
    if (RESERVED_EVENTS.has(ev)) {
      throw new Error(`"${String(ev)}" is a reserved event name`);
    }
    args.unshift(ev);
    this.adapter.serverSideEmit(args);
    return true;
  }

  /**
   * Called when a packet is received from another Socket.IO server
   *
   * @param args - an array of arguments, which may include an acknowledgement callback at the end
   *
   * @private
   */
  /* private */ _onServerSideEmit(args: [string, ...unknown[]]) {
    // @ts-ignore FIXME
    super.emit.apply(this, args);
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
   * receive messages (because of network slowness or other issues, or because they’re connected through long polling
   * and is in the middle of a request-response cycle).
   *
   * @return self
   */
  public get volatile(): BroadcastOperator<EmitEvents, SocketData> {
    return new BroadcastOperator(this.adapter).volatile;
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
   *
   * @return self
   */
  public get local(): BroadcastOperator<EmitEvents, SocketData> {
    return new BroadcastOperator(this.adapter).local;
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
  public timeout(timeout: number) {
    return new BroadcastOperator(this.adapter).timeout(timeout);
  }

  /**
   * Returns the matching socket instances
   */
  public fetchSockets(): Promise<RemoteSocket<EmitEvents, SocketData>[]> {
    return new BroadcastOperator(this.adapter).fetchSockets();
  }

  /**
   * Makes the matching socket instances join the specified rooms
   *
   * @param room
   */
  public socketsJoin(room: Room | Room[]): void {
    return new BroadcastOperator(this.adapter).socketsJoin(room);
  }

  /**
   * Makes the matching socket instances leave the specified rooms
   *
   * @param room
   */
  public socketsLeave(room: Room | Room[]): void {
    return new BroadcastOperator(this.adapter).socketsLeave(room);
  }

  /**
   * Makes the matching socket instances disconnect
   *
   * @param close - whether to close the underlying connection
   */
  public disconnectSockets(close = false): void {
    return new BroadcastOperator(this.adapter).disconnectSockets(close);
  }
}
