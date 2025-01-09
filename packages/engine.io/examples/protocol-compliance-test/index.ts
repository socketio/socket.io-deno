import { Server } from "../../mod.ts";

const engine = new Server({
  pingInterval: 300,
  pingTimeout: 200,
  maxHttpBufferSize: 1e6,
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT"],
  },
});

engine.on("connection", (socket) => {
  socket.on("message", (arg) => {
    socket.send(arg);
  });
});

Deno.serve({
  handler: engine.handler(),
  port: 3000,
});
