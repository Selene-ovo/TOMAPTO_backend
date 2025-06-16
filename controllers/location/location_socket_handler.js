// controllers/location/location_socket_handler.js (기존 위치 로직 완전체)
const FriendDAO = require('../../models/friendDAO');
const db = require('../../db');

// 위치 관련 소켓 이벤트 핸들러 설정 (기존 friends_socket_handler에서 이동)
function setupLocationSocketHandlers(io, socket, connectedUsers) {
  
  // 위치 공유 시작 이벤트 (기존 코드 그대로)
  socket.on('start_location_sharing', (data) => {
    const userId = socket.user.id;
    const { friend_id, duration_minutes, unidirectional, direction } = data;
    
    console.log(`위치 공유 시작 요청: ${userId} -> ${friend_id}, 기간: ${duration_minutes || "무제한"}, 방향: ${direction}`);
    
    if (!friend_id) {
      console.log('친구 ID가 없습니다.');
      return;
    }
    
    // 친구 관계 및 차단 상태 확인
    FriendDAO.checkBlockStatus(userId, friend_id, (err, userBlockedFriend, friendBlockedUser) => {
      if (err) {
        console.error('차단 상태 확인 오류:', err);
        return;
      }
      
      if (userBlockedFriend || friendBlockedUser) {
        console.log(`위치 공유 차단됨: ${userId} -> ${friend_id} (차단 상태)`);
        socket.emit('location_sharing_error', {
          error: '차단된 사용자와는 위치를 공유할 수 없습니다.'
        });
        return;
      }
      
      // 친구에게 위치 공유 시작 알림
      const friendSocketId = connectedUsers.get(friend_id);
      if (friendSocketId) {
        const friendSocket = io.sockets.sockets.get(friendSocketId);
        if (friendSocket) {
          friendSocket.emit('location_sharing_started', {
            sharer_id: userId,
            sharer_name: socket.user.name,
            sharer_nickname: socket.user.nickname,
            duration_minutes: duration_minutes,
            unidirectional: unidirectional,
            direction: direction,
            message: `${socket.user.nickname || socket.user.name}님이 위치 공유를 시작했습니다.`
          });
          
          console.log(`위치 공유 시작 알림 전송: ${userId} -> ${friend_id}`);
        }
      }
      
      // 본인에게도 확인 메시지
      socket.emit('location_sharing_started', {
        friend_id: friend_id,
        duration_minutes: duration_minutes,
        message: '위치 공유가 시작되었습니다.'
      });
    });
  });
  
  // 위치 공유 종료 이벤트 (기존 코드 그대로)
  socket.on('stop_location_sharing', (data) => {
    const userId = socket.user.id;
    const { friend_id } = data;
    
    console.log(`위치 공유 종료 요청: ${userId} -> ${friend_id}`);
    
    if (!friend_id) {
      console.log('친구 ID가 없습니다.');
      return;
    }
    
    // 친구에게 위치 공유 종료 알림
    const friendSocketId = connectedUsers.get(friend_id);
    if (friendSocketId) {
      const friendSocket = io.sockets.sockets.get(friendSocketId);
      if (friendSocket) {
        friendSocket.emit('location_sharing_stopped', {
          sharer_id: userId,
          sharer_name: socket.user.name,
          sharer_nickname: socket.user.nickname,
          message: `${socket.user.nickname || socket.user.name}님이 위치 공유를 종료했습니다.`
        });
        
        console.log(`위치 공유 종료 알림 전송: ${userId} -> ${friend_id}`);
      }
    }
    
    // 본인에게도 확인 메시지
    socket.emit('location_sharing_stopped', {
      friend_id: friend_id,
      message: '위치 공유가 종료되었습니다.'
    });
  });
  
  // 위치 업데이트 이벤트 (기존 코드 그대로)
  socket.on('update_location', (data) => {
    const userId = socket.user.id;
    const { latitude, longitude, heading, accuracy } = data;
    
    if (!latitude || !longitude) {
      console.log('위치 정보가 불완전합니다.');
      return;
    }
    
    console.log(`위치 업데이트: 사용자=${userId}, 위치=[${latitude}, ${longitude}]`);
    
    // 현재 사용자와 위치를 공유 중인 친구들에게 업데이트 전송
    const getActiveSharingSQL = `
      SELECT DISTINCT 
        CASE 
          WHEN ls.sharer_id = ? THEN ls.sharee_id
          ELSE ls.sharer_id
        END as friend_id
      FROM LocationSharing ls
      WHERE (ls.sharer_id = ? OR ls.sharee_id = ?)
      AND ls.status = 'active'
      AND (ls.end_time IS NULL OR ls.end_time > NOW())
    `;
    
    db.query(getActiveSharingSQL, [userId, userId, userId], (err, results) => {
      if (err) {
        console.error('활성 위치 공유 조회 오류:', err);
        return;
      }
      
      // 각 친구에게 위치 업데이트 전송
      results.forEach(row => {
        const friendId = row.friend_id;
        const friendSocketId = connectedUsers.get(friendId);
        
        if (friendSocketId) {
          const friendSocket = io.sockets.sockets.get(friendSocketId);
          if (friendSocket) {
            friendSocket.emit('location_update', {
              user_id: userId,
              user_name: socket.user.name,
              user_nickname: socket.user.nickname,
              latitude: latitude,
              longitude: longitude,
              heading: heading,
              accuracy: accuracy,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      
      console.log(`위치 업데이트 전송 완료: ${userId} -> ${results.length}명의 친구`);
    });
  });
}

module.exports = setupLocationSocketHandlers;