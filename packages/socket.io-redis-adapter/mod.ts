import { getLogger } from "../../test_deps.ts";
import { type Redis } from "../../vendor/deno.land/x/redis@v0.27.1/mod.ts";
import {
  Adapter,
  type BroadcastOptions,
  type Namespace,
} from "../socket.io/mod.ts";
import { type Packet } from "../socket.io-parser/mod.ts";
import { decode, encode } from "../msgpack/mod.ts";
import {
  ClusterRequest,
  ClusterResponse,
  RequestType,
} from "../socket.io/lib/adapter.ts";

export interface RedisAdapterOptions {
  /**
   * The name of the key to pub/sub events on as prefix
   * @default "socket.io"
   */
  key: string;
}

export function createAdapter<
  ListenEvents,
  EmitEvents,
  ServerSideEvents,
  SocketData,
>(
  pubClient: Redis,
  subClient: Redis,
  opts?: Partial<RedisAdapterOptions>,
) {
  const options = Object.assign({
    key: "socket.io",
  }, opts);
  return function (
    nsp: Namespace,
  ) {
    return new RedisAdapter(nsp, pubClient, subClient, options);
  };
}

const TEXT_DECODER = new TextDecoder();

class RedisAdapter extends Adapter {
  private readonly pubClient: Redis;
  private readonly subClient: Redis;
  private readonly opts: RedisAdapterOptions;

  private readonly broadcastChannel: string;
  private readonly requestChannel: string;
  private readonly responseChannel: string;

  constructor(
    nsp: Namespace,
    pubClient: Redis,
    subClient: Redis,
    opts: RedisAdapterOptions,
  ) {
    super(nsp);
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.opts = opts;

    this.broadcastChannel = `${opts.key}#${nsp.name}#`;
    this.requestChannel = `${opts.key}-request#${nsp.name}#`;
    this.responseChannel = `${opts.key}-response#${nsp.name}#${this.uid}#`;

    getLogger("socket.io").debug(
      `[redis-adapter] [${this.uid}] subscribing to ${
        this.broadcastChannel + "*"
      }, ${this.requestChannel} and ${this.responseChannel}`,
    );
    this.subClient.psubscribe<Uint8Array>(this.broadcastChannel + "*").then(
      async (sub) => {
        await sub.subscribe(this.requestChannel, this.responseChannel);

        for await (const { channel, message } of sub.receiveBinary()) {
          if (channel === this.requestChannel) {
            await this.#onRawRequest(message);
          } else if (channel === this.responseChannel) {
            this.#onRawResponse(message);
          } else if (channel.startsWith(this.broadcastChannel)) {
            this.#onBroadcastMessage(channel, message);
          } else {
            getLogger("socket.io").debug(
              `[redis-adapter] [${this.uid}] ignoring message for channel: ${channel}`,
            );
            return;
          }
        }
      },
    ).catch((err) => {
      this.emitReserved("error", err);
    });
  }

  override publishRequest(request: ClusterRequest) {
    const [channel, payload] = this.#encodeRequest(request);

    getLogger("socket.io").debug(
      `[redis-adapter] [${this.uid}] sending request type ${request.type} to channel ${channel}`,
    );

    this.pubClient.publish(channel, payload).catch((err) => {
      this.emitReserved("error", err);
    });
  }

  /**
   * Encode the request payload to match the format of the Node.js implementation
   *
   * @param request
   * @private
   */
  #encodeRequest(request: ClusterRequest): [string, string | Uint8Array] {
    switch (request.type) {
      case RequestType.BROADCAST: {
        const withAck = request.data.requestId !== undefined;

        if (withAck) {
          const payload = new Uint8Array(encode({
            uid: request.uid,
            type: 7,
            requestId: request.data.requestId,
            packet: request.data.packet,
            opts: request.data.opts,
          }));

          return [this.requestChannel, payload];
        } else {
          const opts = request.data.opts as { rooms: string[] };
          let channel = this.broadcastChannel;
          if (opts.rooms && opts.rooms.length === 1) {
            channel += opts.rooms[0] + "#";
          }
          const payload = new Uint8Array(
            encode([request.uid, request.data.packet, opts]),
          );

          return [channel, payload];
        }
      }

      case RequestType.SOCKETS_JOIN: {
        const payload = JSON.stringify({
          uid: request.uid,
          type: 2,
          opts: request.data.opts,
          rooms: request.data.rooms,
        });

        return [this.requestChannel, payload];
      }

      case RequestType.SOCKETS_LEAVE: {
        const payload = JSON.stringify({
          uid: request.uid,
          type: 3,
          opts: request.data.opts,
          rooms: request.data.rooms,
        });

        return [this.requestChannel, payload];
      }

      case RequestType.DISCONNECT_SOCKETS: {
        const payload = JSON.stringify({
          uid: request.uid,
          type: 4,
          opts: request.data.opts,
          close: request.data.close,
        });

        return [this.requestChannel, payload];
      }

      case RequestType.FETCH_SOCKETS: {
        const payload = JSON.stringify({
          uid: request.uid,
          requestId: request.data.requestId,
          type: 5,
          opts: request.data.opts,
        });

        return [this.requestChannel, payload];
      }

      case RequestType.SERVER_SIDE_EMIT: {
        const payload = JSON.stringify({
          uid: request.uid,
          type: 6,
          data: request.data.packet,
          requestId: request.data.requestId,
        });

        return [this.requestChannel, payload];
      }

      default:
        throw "should not happen";
    }
  }

  override publishResponse(requesterUid: string, response: ClusterResponse) {
    // matches the behavior of the Node.js implementation with publishOnSpecificResponseChannel: true
    const channel =
      `${this.opts.key}-response#${this.nsp.name}#${requesterUid}#`;
    const payload = RedisAdapter.#encodeResponse(response);

    getLogger("socket.io").debug(
      `[redis-adapter] [${this.uid}] sending response type ${response.type} to channel ${channel}`,
    );

    this.pubClient.publish(channel, payload).catch((err) => {
      this.emitReserved("error", err);
    });
  }

  /**
   * Encode the response payload to match the format of the Node.js implementation
   *
   * @param response
   * @private
   */
  static #encodeResponse(
    response: ClusterResponse,
  ): string | Uint8Array {
    switch (response.type) {
      case RequestType.FETCH_SOCKETS_RESPONSE: {
        return JSON.stringify({
          requestId: response.data.requestId,
          sockets: response.data.sockets,
        });
      }

      case RequestType.SERVER_SIDE_EMIT_RESPONSE: {
        return JSON.stringify({
          type: 6,
          requestId: response.data.requestId,
          data: response.data.packet,
        });
      }

      case RequestType.BROADCAST_CLIENT_COUNT: {
        return JSON.stringify({
          type: 8,
          requestId: response.data.requestId,
          clientCount: response.data.clientCount,
        });
      }

      case RequestType.BROADCAST_ACK: {
        return new Uint8Array(encode({
          type: 9,
          requestId: response.data.requestId,
          packet: response.data.packet,
        }));
      }

      default:
        throw "should not happen";
    }
  }

  /**
   * Called with a subscription message
   *
   * @private
   */
  #onBroadcastMessage(channel: string, msg: Uint8Array) {
    const room = channel.slice(this.broadcastChannel.length, -1);
    if (room !== "" && !this.#hasRoom(room)) {
      return getLogger("socket.io").debug(
        `[redis-adapter] [${this.uid}] ignore unknown room ${room}`,
      );
    }

    const [uid, packet, opts] = decode(msg) as [
      string,
      Packet,
      BroadcastOptions,
    ];

    return this.onRequest({
      uid,
      type: RequestType.BROADCAST,
      data: {
        packet,
        opts,
      },
    });
  }

  /**
   * Checks whether the room exists (as it is encoded to a string in the broadcast method)
   *
   * @param room
   * @private
   */
  #hasRoom(room: string): boolean {
    const numericRoom = parseFloat(room);
    const hasNumericRoom = !isNaN(numericRoom) && this.rooms.has(numericRoom);
    return hasNumericRoom || this.rooms.has(room);
  }

  /**
   * Called on request from another node
   *
   * @private
   */
  #onRawRequest(msg: Uint8Array) {
    let rawRequest: Record<string, unknown>;

    try {
      // if the buffer starts with a "{" character
      if (msg[0] === 0x7b) {
        rawRequest = JSON.parse(TEXT_DECODER.decode(msg));
      } else {
        rawRequest = decode(msg) as Record<string, unknown>;
      }
    } catch (_) {
      getLogger("socket.io").debug(
        `[redis-adapter] [${this.uid}] ignoring malformed request`,
      );
      return;
    }

    const request = RedisAdapter.#decodeRequest(rawRequest);

    if (request) {
      return this.onRequest(request);
    }
  }

  /**
   * Decode request payload
   *
   * @param rawRequest
   * @private
   */
  static #decodeRequest(
    rawRequest: Record<string, unknown>,
  ): ClusterRequest | null {
    switch (rawRequest.type) {
      case 2:
        return {
          uid: rawRequest.uid as string,
          type: RequestType.SOCKETS_JOIN,
          data: {
            opts: rawRequest.opts,
            rooms: rawRequest.rooms,
          },
        };

      case 3:
        return {
          uid: rawRequest.uid as string,
          type: RequestType.SOCKETS_LEAVE,
          data: {
            opts: rawRequest.opts,
            rooms: rawRequest.rooms,
          },
        };

      case 4:
        return {
          uid: rawRequest.uid as string,
          type: RequestType.DISCONNECT_SOCKETS,
          data: {
            opts: rawRequest.opts,
            close: rawRequest.close,
          },
        };

      case 5:
        return {
          uid: rawRequest.uid as string,
          type: RequestType.FETCH_SOCKETS,
          data: {
            requestId: rawRequest.requestId,
            opts: rawRequest.opts,
          },
        };

      case 6:
        return {
          uid: rawRequest.uid as string,
          type: RequestType.SERVER_SIDE_EMIT,
          data: {
            requestId: rawRequest.requestId,
            packet: rawRequest.data,
          },
        };

      case 7:
        return {
          uid: rawRequest.uid as string,
          type: RequestType.BROADCAST,
          data: {
            opts: rawRequest.opts,
            requestId: rawRequest.requestId,
            packet: rawRequest.packet,
          },
        };

      default:
        return null;
    }
  }

  /**
   * Called on request from another node
   *
   * @private
   */
  #onRawResponse(msg: Uint8Array) {
    let rawResponse: Record<string, unknown>;

    try {
      // if the buffer starts with a "{" character
      if (msg[0] === 0x7b) {
        rawResponse = JSON.parse(TEXT_DECODER.decode(msg));
      } else {
        rawResponse = decode(msg) as Record<string, unknown>;
      }
    } catch (_) {
      getLogger("socket.io").debug(
        `[redis-adapter] [${this.uid}] ignoring malformed response`,
      );
      return;
    }

    const response = RedisAdapter.#decodeResponse(rawResponse);

    if (response) {
      this.onResponse(response);
    }
  }

  static #decodeResponse(
    rawResponse: Record<string, unknown>,
  ): ClusterResponse | null {
    // the Node.js implementation of fetchSockets() does not include the type of the request
    // reference: https://github.com/socketio/socket.io-redis-adapter/blob/b4215cdbc00af96eac37a0b9cc0fbcb793384b53/lib/index.ts#L349-L361
    const responseType = rawResponse.type || RequestType.FETCH_SOCKETS;

    switch (responseType) {
      case RequestType.FETCH_SOCKETS:
        return {
          type: RequestType.FETCH_SOCKETS_RESPONSE,
          data: {
            requestId: rawResponse.requestId as string,
            sockets: rawResponse.sockets,
          },
        };

      case RequestType.SERVER_SIDE_EMIT:
        return {
          type: RequestType.SERVER_SIDE_EMIT_RESPONSE,
          data: {
            requestId: rawResponse.requestId as string,
            packet: rawResponse.data,
          },
        };

      case 8:
        return {
          type: RequestType.BROADCAST_CLIENT_COUNT,
          data: {
            requestId: rawResponse.requestId as string,
            clientCount: rawResponse.clientCount,
          },
        };

      case 9:
        return {
          type: RequestType.BROADCAST_ACK,
          data: {
            requestId: rawResponse.requestId as string,
            packet: rawResponse.packet,
          },
        };

      default:
        return null;
    }
  }

  override async serverCount(): Promise<number> {
    // TODO NUMSUB within a Redis cluster
    const [_, value] = await this.pubClient.pubsubNumsub(this.requestChannel);
    getLogger("socket.io").debug(
      `[redis-adapter] [${this.uid}] there are ${value} server(s) in the cluster`,
    );
    return value as number;
  }
}
