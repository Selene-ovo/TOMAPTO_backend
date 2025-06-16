// socket.js - 분리된 핸들러 import 추가 (완전판)
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');

// 분리된 소켓 핸들러들 import
const setupFriendsSocketHandlers = require('./controllers/friends/friends_socket_handler');
const setupLocationSocketHandlers = require('./controllers/location/location_socket_handler');

// 소켓 사용자 맵
const connectedUsers = new Map();

// 소켓 서버 초기화 함수
function initSocketServer(server) {
  const io = socketIO(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    }
  });

  // 인증 미들웨어 (기존 그대로)
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return next(new Error('인증 토큰이 필요합니다.'));
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET || '7belly_fat4');
      
      socket.user = {
        id: decoded.user_id
      };
      
      const sql = `SELECT user_id, user_name, user_nickname FROM Users WHERE user_id = ?`;
      
      db.query(sql, [decoded.user_id], (err, results) => {
        if (err || results.length === 0) {
          return next(new Error('유효하지 않은 사용자입니다.'));
        }
        
        socket.user.name = results[0].user_name || decoded.user_id;
        socket.user.nickname = results[0].user_nickname || '';
        
        next();
      });
    } catch (error) {
      console.error('소켓 인증 오류:', error);
      next(new Error('인증 오류가 발생했습니다.'));
    }
  });

  // 소켓 연결 처리 (기존 그대로)
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    
    console.log(`소켓 연결: 사용자 ${userId} (${socket.user.name}), 소켓 ID: ${socket.id}`);
    
    connectedUsers.set(userId, socket.id);
    
    socket.emit('connect_success', {
      message: '소켓 연결이 성공했습니다.',
      user_id: userId,
      socket_id: socket.id
    });

    // 분리된 핸들러들 설정
    setupFriendsSocketHandlers(io, socket, connectedUsers);
    setupLocationSocketHandlers(io, socket, connectedUsers);

    // 기존 기본 이벤트들 (그대로)
    socket.on('disconnect', (reason) => {
      console.log(`소켓 연결 해제: 사용자 ${userId}, 이유: ${reason}`);
      
      connectedUsers.delete(userId);
      
      notifyFriendsStatusChange(userId, 'offline', io, connectedUsers);
    });

    socket.on('error', (error) => {
      console.error(`소켓 오류 - 사용자 ${userId}:`, error);
    });

    notifyFriendsStatusChange(userId, 'online', io, connectedUsers);
  });

  console.log('소켓 서버 초기화 완료');
  return io;
}

// 기존 헬퍼 함수 (그대로)
function notifyFriendsStatusChange(userId, status, io, connectedUsers) {
  const getFriendsSQL = `
    SELECT DISTINCT 
      CASE 
        WHEN f.user_id_1 = ? THEN f.user_id_2
        ELSE f.user_id_1
      END as friend_id
    FROM Friendships f
    WHERE (f.user_id_1 = ? OR f.user_id_2 = ?)
    AND f.status = 'active'
    AND (IFNULL(f.is_blocked_by_user_1, 0) = 0 AND IFNULL(f.is_blocked_by_user_2, 0) = 0)
  `;
  
  db.query(getFriendsSQL, [userId, userId, userId], (err, results) => {
    if (err) {
      console.error('친구 목록 조회 오류:', err);
      return;
    }
    
    const userInfoSQL = `
      SELECT user_id, user_name, user_nickname 
      FROM Users 
      WHERE user_id = ?
    `;
    
    db.query(userInfoSQL, [userId], (err, userResults) => {
      if (err || userResults.length === 0) {
        console.error('사용자 정보 조회 오류:', err);
        return;
      }
      
      const user = userResults[0];
      
      results.forEach(friend => {
        const friendSocketId = connectedUsers.get(friend.friend_id);
        
        if (friendSocketId) {
          const friendSocket = io.sockets.sockets.get(friendSocketId);
          if (friendSocket) {
            friendSocket.emit('friend_status_change', {
              user_id: user.user_id,
              user_name: user.user_name,
              user_nickname: user.user_nickname,
              status: status,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      
      console.log(`상태 변경 알림 전송 완료: ${userId} -> ${status} (${results.length}명의 친구)`);
    });
  });
}

module.exports = initSocketServer;