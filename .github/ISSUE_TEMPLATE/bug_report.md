---
name: Bug report
about: Create a report to help us improve
title: ''
labels: 'to triage'
assignees: ''

---

**Describe the bug**

A clear and concise description of what the bug is.

**To Reproduce**

```ts
import { serve } from "https://deno.land/std@a.b.c/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@x.y.z/mod.ts";

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

**Expected behavior**

A clear and concise description of what you expected to happen.

**Screenshots**

If applicable, add screenshots to help explain your problem.

**Platform:**

- Device: [e.g. Samsung S8]
- OS: [e.g. Android 9.2]

**Additional context**

Add any other context about the problem here.
