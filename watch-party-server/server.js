const { Server } = require("socket.io");

// 监听 3000 端口，允许跨域
const io = new Server(3000, {
  cors: { origin: "*" }
});

const ROOM_ID = "private_couple_room";
let currentVideoState = { time: 0, state: 'paused' }; // 缓存当前状态，防朋友掉线

io.on("connection", (socket) => {
  console.log(`用户连入: ${socket.id}`);
  
  // 强制加入唯一的私密房间
  socket.join(ROOM_ID);
  
  // 刚连入时，同步当前房间的视频状态给他
  socket.emit("sync_receive", currentVideoState);

  // 接收任一端的播放状态更新
  socket.on("sync_send", (data) => {
    currentVideoState = data; // 更新服务端缓存
    // 广播给房间里的【其他人】（不包括发送者自己）
    socket.to(ROOM_ID).emit("sync_receive", data);
  });

  socket.on("disconnect", () => {
    console.log(`用户断开: ${socket.id}`);
  });
});

console.log("双人同步信令服务器运行在 ws://localhost:3000");
