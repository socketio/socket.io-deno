/**
 * @example
 * import { serve } from "https://deno.land/std@a.b.c/http/server.ts";
 * import { Server } from "https://deno.land/x/socket_io@x.y.z/mod.ts";
 *
 * const io = new Server();
 *
 * io.on("connection", (socket) => {
 *   console.log(`socket ${socket.id} connected`);
 *
 *   // send an event to the client
 *   socket.emit("foo", "bar");
 *
 *   socket.on("foobar", () => {
 *     // an event was received from the client
 *   });
 *
 *   // upon disconnection
 *   socket.on("disconnect", (reason) => {
 *     console.log(`socket ${socket.id} disconnected due to ${reason}`);
 *   });
 * });
 *
 * await serve(io.handler(), {
 *   port: 3000,
 * });
 */
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
 * @example
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
 */
export {
  createAdapter as createRedisAdapter,
  type RedisAdapterOptions,
} from "./packages/socket.io-redis-adapter/mod.ts";

/**
 * Temporary export to provide a workaround for https://github.com/denodrivers/redis/issues/335
 */
export { connect as createRedisClient } from "./vendor/deno.land/x/redis@v0.27.1/mod.ts";
