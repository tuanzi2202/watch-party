const { Server } = require("socket.io");

const io = new Server(3000, {
  cors: { origin: "*" }
});

console.log('🚀 多房间同步信令服务器运行在 ws://localhost:3000');

// 辅助函数：广播指定房间的实时人数
const broadcastRoomCount = (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    io.to(roomId).emit('room_count', count);
};

io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId;
        console.log(`[房间调度] 节点 ${socket.id} 加入了放映室: [${roomId}]`);
        // 触发人数广播更新
        broadcastRoomCount(roomId);
    });

    socket.on('sync_send', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_receive', data);
        }
    });

    socket.on('change_video', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('change_video', data);
            console.log(`[信令转发] 放映室 [${socket.roomId}] 触发换片: ${data.bvid}`);
        }
    });

    socket.on('send_chat', (data) => {
        if (socket.roomId) {
            io.to(socket.roomId).emit('receive_danmaku', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            console.log(`[断开连接] 节点 ${socket.id} 离开了放映室: [${socket.roomId}]`);
            // 稍作延迟确保当前 socket 已脱离 room 队列，获取最新人数
            setTimeout(() => { broadcastRoomCount(socket.roomId); }, 100);
        }
    });
});