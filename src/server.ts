import http from "http";
import { env } from "@/config/env.js";
import app from "./app.js";
import { initializeSocketServer } from "@/socket/socket.server.js";

const PORT = env.PORT;

const server = http.createServer(app);

// Initialize realtime socket server
initializeSocketServer(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});