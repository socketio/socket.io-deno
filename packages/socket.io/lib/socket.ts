import { Packet, PacketType } from "../../socket.io-parser/mod.ts";
import { getLogger } from "../../../deps.ts";
import {
  DefaultEventsMap,
  EventEmitter,
  EventNames,
  EventParams,
  EventsMap,
} from "../../event-emitter/mod.ts";
import { Adapter, BroadcastFlags, Room, SocketId } from "./adapter.ts";
import { generateId } from "../../engine.io/mod.ts";
import { Namespace } from "./namespace.ts";
import { Client } from "./client.ts";
import { BroadcastOperator } from "./broadcast-operator.ts";

type ClientReservedEvents = "connect" | "connect_error";

type DisconnectReason =
  // Engine.IO close reasons
  | "transport error"
  | "transport close"
  | "forced close"
  | "ping timeout"
  | "parse error"
  // Socket.IO disconnect reasons
  | "client namespace disconnect"
  | "server namespace disconnect";

export interface SocketReservedEvents {
  disconnect: (reason: DisconnectReason) => void;
  disconnecting: (reason: DisconnectReason) => void;
}

// EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
export interface EventEmitterReservedEvents {
  newListener: (
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => void;
  removeListener: (
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => void;
}

export const RESERVED_EVENTS: ReadonlySet<string | symbol> = new Set<
  | ClientReservedEvents
  | keyof SocketReservedEvents
  | keyof EventEmitterReservedEvents
>(
  [
    "connect",
    "connect_error",
    "disconnect",
    "disconnecting",
    "newListener",
    "removeListener",
  ] as const,
);

/**
 * The handshake details
 */
export interface Handshake {
  /**
   * The headers sent as part of the handshake
   */
  headers: Headers;

  /**
   * The date of creation (as string)
   */
  time: string;

  /**
   * The ip of the client
   */
  address: string;

  /**
   * Whether the connection is cross-domain
   */
  xdomain: boolean;

  /**
   * Whether the connection is secure
   */
  secure: boolean;

  /**
   * The date of creation (as unix timestamp)
   */
  issued: number;

  /**
   * The request URL string
   */
  url: string;

  /**
   * The query object
   */
  query: URLSearchParams;

  /**
   * The auth object
   */
  auth: Record<string, unknown>;
}

function noop() {}

export class Socket<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = DefaultEventsMap,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = unknown,
> extends EventEmitter<
  ListenEvents,
  EmitEvents,
  SocketReservedEvents
> {
  public readonly id: SocketId;
  public readonly handshake: Handshake;
  /**
   * Additional information that can be attached to the Socket instance and which will be used in the fetchSockets method
   */
  public data: Partial<SocketData> = {};

  public connected = false;

  private readonly nsp: Namespace<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >;
  private readonly adapter: Adapter;

  /* private */ _acks: Map<number, () => void> = new Map();
  private flags: BroadcastFlags = {};
  private anyIncomingListeners?: Array<(...args: unknown[]) => void>;
  private anyOutgoingListeners?: Array<(...args: unknown[]) => void>;

  /* private */ readonly client: Client<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >;

  constructor(
    nsp: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    client: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    handshake: Handshake,
  ) {
    super();
    this.nsp = nsp;
    this.id = generateId();
    this.client = client;
    this.adapter = nsp.adapter;
    this.handshake = handshake;
  }

  /**
   * Emits to this client.
   *
   * @return Always returns `true`.
   */
  public emit<Ev extends EventNames<EmitEvents>>(
    ev: Ev,
    ...args: EventParams<EmitEvents, Ev>
  ): boolean {
    if (RESERVED_EVENTS.has(ev)) {
      throw new Error(`"${String(ev)}" is a reserved event name`);
    }
    const data: unknown[] = [ev, ...args];
    const packet: Packet = {
      nsp: this.nsp.name,
      type: PacketType.EVENT,
      data: data,
    };

    // access last argument to see if it's an ACK callback
    if (typeof data[data.length - 1] === "function") {
      const id = this.nsp._ids++;
      getLogger("socket.io").debug(
        `[socket] emitting packet with ack id ${id}`,
      );

      this.registerAckCallback(id, data.pop() as (...args: unknown[]) => void);
      packet.id = id;
    }

    const flags = Object.assign({}, this.flags);
    this.flags = {};

    this._notifyOutgoingListeners(packet);
    this.packet(packet, flags);

    return true;
  }

  /**
   * @private
   */
  private registerAckCallback(id: number, ack: (...args: unknown[]) => void) {
    const timeout = this.flags.timeout;
    if (timeout === undefined) {
      this._acks.set(id, ack);
      return;
    }

    const timerId = setTimeout(() => {
      getLogger("socket.io").debug(
        `[socket] event with ack id ${id} has timed out after ${timeout} ms`,
      );
      this._acks.delete(id);
      ack.call(this, new Error("operation has timed out"));
    }, timeout);

    this._acks.set(id, (...args) => {
      clearTimeout(timerId);
      ack.apply(this, [null, ...args]);
    });
  }

  /**
   * @param packet
   */
  /* private */ _onpacket(packet: Packet) {
    if (!this.connected) {
      return;
    }

    getLogger("socket.io").debug(`[socket] got packet type ${packet.type}`);
    switch (packet.type) {
      case PacketType.EVENT:
      case PacketType.BINARY_EVENT:
        this.onevent(packet);
        break;

      case PacketType.ACK:
      case PacketType.BINARY_ACK:
        this.onack(packet);
        break;

      case PacketType.DISCONNECT:
        this.ondisconnect();
        break;
    }
  }

  /**
   * Called upon event packet.
   *
   * @param {Packet} packet - packet object
   * @private
   */
  private onevent(packet: Packet): void {
    const args = packet.data || [];
    getLogger("socket.io").debug(`[socket] emitting event ${args}`);

    if (null != packet.id) {
      getLogger("socket.io").debug("[socket] attaching ack callback to event");
      args.push(this.ack(packet.id));
    }

    if (this.anyIncomingListeners && this.anyIncomingListeners.length) {
      const listeners = this.anyIncomingListeners.slice();
      for (const listener of listeners) {
        listener.apply(this, args);
      }
    }

    if (this.connected) {
      super.emit.apply(this, args);
    }
  }

  /**
   * Produces an ack callback to emit with an event.
   *
   * @param {Number} id - packet id
   * @private
   */
  private ack(id: number): () => void {
    const self = this;
    let sent = false;
    return function () {
      // prevent double callbacks
      if (sent) return;
      const args = Array.prototype.slice.call(arguments);
      getLogger("socket.io").debug(`[socket] sending ack ${id}`);

      self.packet({
        id: id,
        type: PacketType.ACK,
        data: args,
      });

      sent = true;
    };
  }

  /**
   * Called upon ack packet.
   *
   * @private
   */
  private onack(packet: Packet): void {
    const ack = this._acks.get(packet.id!);
    if ("function" == typeof ack) {
      getLogger("socket.io").debug(
        `[socket] calling ack ${packet.id}`,
      );
      ack.apply(this, packet.data);
      this._acks.delete(packet.id!);
    } else {
      getLogger("socket.io").debug(`[socket] bad ack ${packet.id}`);
    }
  }

  /**
   * Called upon client disconnect packet.
   *
   * @private
   */
  private ondisconnect(): void {
    getLogger("socket.io").debug("[socket] got disconnect packet");
    this._onclose("client namespace disconnect");
  }

  /**
   * Called upon closing. Called by `Client`.
   *
   * @param {String} reason
   * @throw {Error} optional error object
   *
   * @private
   */
  /* private */ _onclose(reason: DisconnectReason): this | undefined {
    if (!this.connected) return this;
    getLogger("socket.io").debug(`[socket] closing socket - reason ${reason}`);
    this.emitReserved("disconnecting", reason);
    this._cleanup();
    this.nsp._remove(this);
    this.client._remove(this);
    this.connected = false;
    this.emitReserved("disconnect", reason);
    return;
  }

  /**
   * Makes the socket leave all the rooms it was part of and prevents it from joining any other room
   *
   * @private
   */
  /* private */ _cleanup() {
    this.leaveAll();
    this.join = noop;
  }

  /**
   * Notify the listeners for each packet sent (emit or broadcast)
   *
   * @param packet
   *
   * @private
   */
  /* private */ _notifyOutgoingListeners(packet: Packet) {
    if (this.anyOutgoingListeners && this.anyOutgoingListeners.length) {
      const listeners = this.anyOutgoingListeners.slice();
      for (const listener of listeners) {
        listener.apply(this, packet.data);
      }
    }
  }

  /**
   * Sends a `message` event.
   *
   * @return self
   */
  public send(...args: EventParams<EmitEvents, "message">): this {
    this.emit("message", ...args);
    return this;
  }

  /**
   * Writes a packet.
   *
   * @param {Object} packet - packet object
   * @param {Object} opts - options
   * @private
   */
  private packet(
    packet: Omit<Packet, "nsp"> & Partial<Pick<Packet, "nsp">>,
    opts = {},
  ): void {
    packet.nsp = this.nsp.name;
    this.client._packet(packet as Packet, opts);
  }

  /**
   * Joins a room.
   *
   * @param {String|Array} rooms - room or array of rooms
   * @return a Promise or nothing, depending on the adapter
   */
  public join(rooms: Room | Array<Room>): Promise<void> | void {
    getLogger("socket.io").debug(`[socket] join room ${rooms}`);

    return this.adapter.addAll(
      this.id,
      new Set(Array.isArray(rooms) ? rooms : [rooms]),
    );
  }

  /**
   * Leaves a room.
   *
   * @param {String} room
   * @return a Promise or nothing, depending on the adapter
   */
  public leave(room: Room): Promise<void> | void {
    getLogger("socket.io").debug("[socket] leave room %s", room);

    return this.adapter.del(this.id, room);
  }

  /**
   * Leave all rooms.
   *
   * @private
   */
  private leaveAll(): void {
    this.adapter.delAll(this.id);
  }

  /**
   * Called by `Namespace` upon successful
   * middleware execution (ie: authorization).
   * Socket is added to namespace array before
   * call to join, so adapters can access it.
   *
   * @private
   */
  /* private */ _onconnect(): void {
    getLogger("socket.io").debug("[socket] socket connected - writing packet");
    this.connected = true;
    this.join(this.id);
    this.packet({ type: PacketType.CONNECT, data: { sid: this.id } });
  }

  /**
   * Produces an `error` packet.
   *
   * @param err - error object
   *
   * @private
   */
  /* private */ _error(err: { message: string; data: unknown }) {
    this.packet({ type: PacketType.CONNECT_ERROR, data: err });
  }

  /**
   * Disconnects this client.
   *
   * @param {Boolean} close - if `true`, closes the underlying connection
   * @return {Socket} self
   */
  public disconnect(close = false): this {
    if (!this.connected) return this;
    if (close) {
      this.client._disconnect();
    } else {
      this.packet({ type: PacketType.DISCONNECT });
      this._onclose("server namespace disconnect");
    }
    return this;
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
   * receive messages (because of network slowness or other issues, or because they’re connected through long polling
   * and is in the middle of a request-response cycle).
   *
   * @return {Socket} self
   */
  public get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data will only be broadcast to every sockets but the
   * sender.
   *
   * @return {Socket} self
   */
  public get broadcast(): BroadcastOperator<EmitEvents, SocketData> {
    return this.newBroadcastOperator();
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
   *
   * @return {Socket} self
   */
  public get local(): BroadcastOperator<EmitEvents, SocketData> {
    return this.newBroadcastOperator().local;
  }

  /**
   * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
   * given number of milliseconds have elapsed without an acknowledgement from the client:
   *
   * ```
   * socket.timeout(5000).emit("my-event", (err) => {
   *   if (err) {
   *     // the client did not acknowledge the event in the given delay
   *   }
   * });
   * ```
   *
   * @returns self
   */
  public timeout(timeout: number): this {
    this.flags.timeout = timeout;
    return this;
  }

  /**
   * Returns the rooms the socket is currently in
   */
  public get rooms(): Set<Room> {
    return this.adapter.socketRooms(this.id) || new Set();
  }

  private newBroadcastOperator(): BroadcastOperator<EmitEvents, SocketData> {
    const flags = Object.assign({}, this.flags);
    this.flags = {};
    return new BroadcastOperator(
      this.adapter,
      new Set<Room>(),
      new Set<Room>([this.id]),
      flags,
    );
  }
}
