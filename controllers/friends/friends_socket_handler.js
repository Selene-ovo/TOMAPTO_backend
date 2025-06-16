// controllers/friends/friends_socket_handler.js (기존 로직만, 위치 로직 제거)
const FriendDAO = require('../../models/friendDAO');
const db = require('../../db');

// 친구 관련 소켓 이벤트 핸들러 설정
function setupFriendsSocketHandlers(io, socket, connectedUsers) {
  
  // 친구 요청 전송 이벤트
  socket.on('send_friend_request', (data) => {
    const senderId = socket.user.id;
    const { recipient_id } = data;
    
    console.log(`소켓 친구 요청: ${senderId} -> ${recipient_id}`);
    
    if (!recipient_id) {
      console.log('수신자 ID가 없습니다.');
      return;
    }
    
    // 차단 상태 확인
    FriendDAO.checkBlockStatus(senderId, recipient_id, (err, senderBlockedRecipient, recipientBlockedSender) => {
      if (err) {
        console.error('차단 상태 확인 오류:', err);
        return;
      }
      
      if (senderBlockedRecipient || recipientBlockedSender) {
        console.log(`친구 요청 차단됨: ${senderId} -> ${recipient_id} (차단 상태)`);
        return;
      }
      
      // 수신자가 온라인인지 확인하고 실시간 알림 전송
      const recipientSocketId = connectedUsers.get(recipient_id);
      if (recipientSocketId) {
        const recipientSocket = io.sockets.sockets.get(recipientSocketId);
        if (recipientSocket) {
          recipientSocket.emit('friend_request', {
            sender_id: senderId,
            sender_name: socket.user.name,
            sender_nickname: socket.user.nickname,
            message: `${socket.user.nickname || socket.user.name}님이 친구 요청을 보냈습니다.`
          });
          
          console.log(`실시간 친구 요청 알림 전송: ${senderId} -> ${recipient_id}`);
        }
      }
    });
  });
  
  // 친구 요청 수락 이벤트
  socket.on('accept_friend_request', (data) => {
    const userId = socket.user.id;
    const { request_id } = data;
    
    console.log(`소켓 친구 요청 수락: 사용자=${userId}, 요청ID=${request_id}`);
    
    if (!request_id) {
      console.log('요청 ID가 없습니다.');
      return;
    }
    
    // 요청 정보 조회
    const getRequestSQL = `
      SELECT fr.sender_id, u.user_name, u.user_nickname
      FROM FriendRequests fr
      JOIN Users u ON fr.sender_id = u.user_id
      WHERE fr.request_id = ? AND fr.recipient_id = ? AND fr.request_status = 'pending'
    `;
    
    db.query(getRequestSQL, [request_id, userId], (err, results) => {
      if (err) {
        console.error('친구 요청 정보 조회 오류:', err);
        return;
      }
      
      if (results.length === 0) {
        console.log('유효한 친구 요청을 찾을 수 없습니다.');
        return;
      }
      
      const request = results[0];
      const senderId = request.sender_id;
      
      // 발신자가 온라인인지 확인하고 수락 알림 전송
      const senderSocketId = connectedUsers.get(senderId);
      if (senderSocketId) {
        const senderSocket = io.sockets.sockets.get(senderSocketId);
        if (senderSocket) {
          senderSocket.emit('friend_accept', {
            accepter_id: userId,
            accepter_name: socket.user.name,
            accepter_nickname: socket.user.nickname,
            message: `${socket.user.nickname || socket.user.name}님이 친구 요청을 수락했습니다.`
          });
          
          console.log(`실시간 친구 수락 알림 전송: ${userId} -> ${senderId}`);
        }
      }
    });
  });
}

module.exports = setupFriendsSocketHandlers;