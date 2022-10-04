export {
  Adapter,
  type BroadcastOptions,
  type Namespace,
  Server,
  type ServerOptions,
  type Socket,
} from "./packages/socket.io/mod.ts";

/**
 * The Redis adapter, to broadcast packets between several Socket.IO servers
 *
 * Documentation: https://socket.io/docs/v4/redis-adapter/
 *
 * Usage:
 *
 * ```
 * import { serve } from "https://deno.land/std/http/server.ts";
 * import { Server, createRedisAdapter, createRedisClient } from "https://deno.land/x/socket_io/mod.ts";
 *
 * const [pubClient, subClient] = await Promise.all([
 *   createRedisClient({
 *     hostname: "localhost",
 *   }),
 *   createRedisClient({
 *     hostname: "localhost",
 *   })
 * ]);
 *
 * const io = new Server({
 *     adapter: createRedisAdapter(pubClient, subClient)
 * });
 *
 * await serve(io.handler(), {
 *     port: 3000
 * });
 * ```
 */
export {
  createAdapter as createRedisAdapter,
  type RedisAdapterOptions,
} from "./packages/socket.io-redis-adapter/mod.ts";

/**
 * Temporary export to provide a workaround for https://github.com/denodrivers/redis/issues/335
 */
export { connect as createRedisClient } from "./vendor/deno.land/x/redis@v0.27.1/mod.ts";
