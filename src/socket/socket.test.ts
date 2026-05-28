import { io } from "socket.io-client";

const conversationId = "cmp1mndtu0001wo9kfqzlu6kc";

// Connect to realtime server
const socket = io("http://localhost:5001");

socket.on("connect", () => {
  console.log(`✅ Connected to socket server: ${socket.id}`);

// Join conversation room
socket.emit("join_conversation", conversationId);
console.log(`📥 Joined room: conversation:${conversationId}`);
});

// Listen for realtime messages
socket.on("new_message", (message) => {
  console.log("📨 New realtime message received:");
  console.log(message);
})

socket.on("disconnect", () => {
  console.log("❌ Disconnected from socket server");
});