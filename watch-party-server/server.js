const { Server } = require("socket.io");

const io = new Server(3000, {
  cors: { origin: "*" }
});

console.log('🚀 多房间同步信令服务器运行在 ws://localhost:3000');

io.on('connection', (socket) => {
    // ⚠️ 核心新增：监听客户端的加入房间请求
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId; // 将房间号烙印在这个连接的上下文中
        console.log(`[房间调度] 节点 ${socket.id} 加入了放映室: [${roomId}]`);
    });

    // 以下所有的广播，全部从 io.emit 改为定向的 socket.to(roomId).emit
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
            // 注意弹幕需要用 io.to().emit 以确保发送者自己也能看到动画
            io.to(socket.roomId).emit('receive_danmaku', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            console.log(`[断开连接] 节点 ${socket.id} 离开了放映室: [${socket.roomId}]`);
        }
    });
});