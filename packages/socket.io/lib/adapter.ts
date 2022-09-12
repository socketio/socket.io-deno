import { EventEmitter } from "../../event-emitter/mod.ts";
import { type Socket } from "./socket.ts";
import { type Namespace } from "./namespace.ts";
import { type Packet } from "../../socket.io-parser/mod.ts";

export type SocketId = string;
export type Room = string | number;

export interface BroadcastOptions {
  rooms: Set<Room>;
  except?: Set<Room>;
  flags?: BroadcastFlags;
}

export interface BroadcastFlags {
  volatile?: boolean;
  local?: boolean;
  broadcast?: boolean;
  timeout?: number;
}

interface AdapterEvents {
  "create-room": (room: Room) => void;
  "delete-room": (room: Room) => void;
  "join-room": (room: Room, sid: SocketId) => void;
  "leave-room": (room: Room, sid: SocketId) => void;
}

export class Adapter extends EventEmitter<never, never, AdapterEvents> {
  private readonly nsp: Namespace;

  private rooms: Map<Room, Set<SocketId>> = new Map();
  private sids: Map<SocketId, Set<Room>> = new Map();

  constructor(nsp: Namespace) {
    super();
    this.nsp = nsp;
  }

  /**
   * Returns the number of Socket.IO servers in the cluster
   */
  public serverCount(): Promise<number> {
    return Promise.resolve(1);
  }

  /**
   * Adds a socket to a list of room.
   *
   * @param id - the socket ID
   * @param rooms - a set of rooms
   */
  public addAll(id: SocketId, rooms: Set<Room>): Promise<void> | void {
    let roomsForSid = this.sids.get(id);
    if (!roomsForSid) {
      this.sids.set(id, roomsForSid = new Set());
    }

    for (const room of rooms) {
      roomsForSid.add(room);

      let sidsForRoom = this.rooms.get(room);

      if (!sidsForRoom) {
        this.rooms.set(room, sidsForRoom = new Set());
        this.emitReserved("create-room", room);
      }
      if (!sidsForRoom.has(id)) {
        sidsForRoom.add(id);
        this.emitReserved("join-room", room, id);
      }
    }
  }

  /**
   * Removes a socket from a room.
   *
   * @param {SocketId} id     the socket id
   * @param {Room}     room   the room name
   */
  public del(id: SocketId, room: Room): Promise<void> | void {
    this.sids.get(id)?.delete(room);
    this.removeSidFromRoom(room, id);
  }

  private removeSidFromRoom(room: Room, id: SocketId) {
    const sids = this.rooms.get(room);

    if (!sids) {
      return;
    }

    const deleted = sids.delete(id);
    if (deleted) {
      this.emitReserved("leave-room", room, id);
    }
    if (sids.size === 0 && this.rooms.delete(room)) {
      this.emitReserved("delete-room", room);
    }
  }

  /**
   * Removes a socket from all rooms it's joined.
   *
   * @param id - the socket ID
   */
  public delAll(id: SocketId): void {
    const rooms = this.sids.get(id);

    if (!rooms) {
      return;
    }

    for (const room of rooms) {
      this.removeSidFromRoom(room, id);
    }

    this.sids.delete(id);
  }

  /**
   * Broadcasts a packet.
   *
   * Options:
   *  - `flags` {Object} flags for this packet
   *  - `except` {Array} sids that should be excluded
   *  - `rooms` {Array} list of rooms to broadcast to
   *
   * @param {Object} packet   the packet object
   * @param {Object} opts     the options
   */
  public broadcast(packet: Packet, opts: BroadcastOptions): void {
    const encodedPackets = this.nsp._server._encoder.encode(packet);

    this.apply(opts, (socket) => {
      socket._notifyOutgoingListeners(packet);
      socket.client._writeToEngine(encodedPackets, {
        volatile: opts.flags && opts.flags.volatile,
      });
    });
  }

  /**
   * Broadcasts a packet and expects multiple acknowledgements.
   *
   * Options:
   *  - `flags` {Object} flags for this packet
   *  - `except` {Array} sids that should be excluded
   *  - `rooms` {Array} list of rooms to broadcast to
   *
   * @param {Object} packet   the packet object
   * @param {Object} opts     the options
   * @param clientCountCallback - the number of clients that received the packet
   * @param ack                 - the callback that will be called for each client response
   */
  public broadcastWithAck(
    packet: Packet,
    opts: BroadcastOptions,
    clientCountCallback: (clientCount: number) => void,
    ack: (...args: unknown[]) => void,
  ) {
    const flags = opts.flags || {};
    const packetOpts = {
      preEncoded: true,
      volatile: flags.volatile,
    };

    packet.nsp = this.nsp.name;
    // we can use the same id for each packet, since the _ids counter is common (no duplicate)
    packet.id = this.nsp._ids++;

    const encodedPackets = this.nsp._server._encoder.encode(packet);

    let clientCount = 0;

    this.apply(opts, (socket) => {
      // track the total number of acknowledgements that are expected
      clientCount++;
      // call the ack callback for each client response
      socket._acks.set(packet.id!, ack);

      socket._notifyOutgoingListeners(packet);
      socket.client._writeToEngine(encodedPackets, packetOpts);
    });

    clientCountCallback(clientCount);
  }

  /**
   * Gets the list of rooms a given socket has joined.
   *
   * @param {SocketId} id   the socket id
   */
  public socketRooms(id: SocketId): Set<Room> | undefined {
    return this.sids.get(id);
  }

  /**
   * Returns the matching socket instances
   *
   * @param opts - the filters to apply
   */
  public fetchSockets(opts: BroadcastOptions): Promise<Socket[]> {
    const sockets: Socket[] = [];

    this.apply(opts, (socket) => {
      sockets.push(socket);
    });

    return Promise.resolve(sockets);
  }

  /**
   * Makes the matching socket instances join the specified rooms
   *
   * @param opts - the filters to apply
   * @param rooms - the rooms to join
   */
  public addSockets(opts: BroadcastOptions, rooms: Room[]): void {
    this.apply(opts, (socket) => {
      socket.join(rooms);
    });
  }

  /**
   * Makes the matching socket instances leave the specified rooms
   *
   * @param opts - the filters to apply
   * @param rooms - the rooms to leave
   */
  public delSockets(opts: BroadcastOptions, rooms: Room[]): void {
    this.apply(opts, (socket) => {
      rooms.forEach((room) => socket.leave(room));
    });
  }

  /**
   * Makes the matching socket instances disconnect
   *
   * @param opts - the filters to apply
   * @param close - whether to close the underlying connection
   */
  public disconnectSockets(opts: BroadcastOptions, close: boolean): void {
    this.apply(opts, (socket) => {
      socket.disconnect(close);
    });
  }

  private apply(
    opts: BroadcastOptions,
    callback: (socket: Socket) => void,
  ): void {
    const rooms = opts.rooms;
    const except = this.computeExceptSids(opts.except);

    if (rooms.size) {
      const ids = new Set();
      for (const room of rooms) {
        if (!this.rooms.has(room)) continue;

        for (const id of this.rooms.get(room)!) {
          if (ids.has(id) || except.has(id)) continue;
          const socket = this.nsp.sockets.get(id);
          if (socket) {
            callback(socket);
            ids.add(id);
          }
        }
      }
    } else {
      for (const [id] of this.sids) {
        if (except.has(id)) continue;
        const socket = this.nsp.sockets.get(id);
        if (socket) callback(socket);
      }
    }
  }

  private computeExceptSids(exceptRooms?: Set<Room>) {
    const exceptSids = new Set();
    if (exceptRooms && exceptRooms.size > 0) {
      for (const room of exceptRooms) {
        this.rooms.get(room)?.forEach((sid) => exceptSids.add(sid));
      }
    }
    return exceptSids;
  }

  /**
   * Send a packet to the other Socket.IO servers in the cluster
   * @param _packet - an array of arguments, which may include an acknowledgement callback at the end
   */
  public serverSideEmit(_packet: unknown[]): void {
    console.warn(
      "this adapter does not support the serverSideEmit() functionality",
    );
  }
}
