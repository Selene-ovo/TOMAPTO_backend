// models/friendDAO.js
const db = require('../db');

class FriendDAO {
  // 사용자 검색
  static searchUsers(searchTerm, userId, callback) {
    const searchSQL = `
      SELECT u.user_id, u.user_name, u.user_nickname 
      FROM Users u
      LEFT JOIN Friendships f ON (
        (f.user_id_1 = ? AND f.user_id_2 = u.user_id) OR 
        (f.user_id_2 = ? AND f.user_id_1 = u.user_id)
      )
      WHERE (u.user_id LIKE ? OR u.user_name LIKE ? OR u.user_nickname LIKE ?) 
      AND u.user_id != ? 
      AND u.user_status = 'active'
      AND (
        f.friendship_id IS NULL OR 
        (
          -- 서로 차단하지 않은 경우만 포함
          (f.user_id_1 = ? AND IFNULL(f.is_blocked_by_user_1, 0) = 0 AND IFNULL(f.is_blocked_by_user_2, 0) = 0) OR
          (f.user_id_2 = ? AND IFNULL(f.is_blocked_by_user_1, 0) = 0 AND IFNULL(f.is_blocked_by_user_2, 0) = 0)
        )
      )
      ORDER BY 
        CASE 
          WHEN u.user_nickname LIKE ? THEN 1
          WHEN u.user_id LIKE ? THEN 2
          WHEN u.user_name LIKE ? THEN 3
          ELSE 4 
        END,
        u.user_nickname, u.user_id
      LIMIT 20
    `;
    
    const searchPattern = `%${searchTerm}%`;
    const searchParams = [
      userId, userId, // LEFT JOIN 조건용
      searchPattern, searchPattern, searchPattern, // WHERE 조건용
      userId, // WHERE 조건용 (자기 자신 제외)
      userId, userId, // 차단 상태 확인용
      searchPattern, // ORDER BY 닉네임 매치용
      searchPattern, // ORDER BY 아이디 매치용  
      searchPattern  // ORDER BY 이름 매치용
    ];
    
    db.query(searchSQL, searchParams, callback);
  }

  // 친구 요청 전송
  static sendFriendRequest(senderId, recipientId, callback) {
    // 1. 친구 관계 확인
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    `;
    
    db.query(checkFriendshipSQL, [senderId, recipientId, recipientId, senderId], (err, friendshipResults) => {
      if (err) return callback(err);
      
      if (friendshipResults.length > 0) {
        return callback(new Error('이미 친구인 사용자입니다.'));
      }
      
      // 2. 이미 요청을 보냈는지 확인
      const checkRequestSQL = `
        SELECT * FROM FriendRequests 
        WHERE sender_id = ? AND recipient_id = ?
      `;
      
      db.query(checkRequestSQL, [senderId, recipientId], (err, requestResults) => {
        if (err) return callback(err);
        
        if (requestResults.length > 0 && requestResults[0].request_status === 'pending') {
          return callback(new Error('이미 친구 요청을 보냈습니다.'));
        }
        
        // 3. 상대방이 나에게 요청을 보냈는지 확인
        const checkReverseRequestSQL = `
          SELECT * FROM FriendRequests 
          WHERE sender_id = ? AND recipient_id = ?
        `;
        
        db.query(checkReverseRequestSQL, [recipientId, senderId], (err, reverseRequestResults) => {
          if (err) return callback(err);
          
          if (reverseRequestResults.length > 0 && reverseRequestResults[0].request_status === 'pending') {
            // 상대방이 나에게 요청을 보낸 경우, 자동으로 수락 처리
            this.acceptFriendRequestAuto(recipientId, senderId, callback);
          } else {
            // 새 친구 요청 생성
            const createRequestSQL = `
              INSERT INTO FriendRequests (sender_id, recipient_id, request_status, created_at, updated_at)
              VALUES (?, ?, 'pending', NOW(), NOW())
              ON DUPLICATE KEY UPDATE request_status = 'pending', updated_at = NOW()
            `;
            
            db.query(createRequestSQL, [senderId, recipientId], callback);
          }
        });
      });
    });
  }

  // 친구 요청 목록 조회
  static getFriendRequests(userId, callback) {
    const requestSQL = `
      SELECT fr.request_id, fr.sender_id, fr.request_status, 
             fr.created_at, u.user_name as sender_name, 
             u.user_nickname as sender_nickname
      FROM FriendRequests fr
      JOIN Users u ON fr.sender_id = u.user_id
      WHERE fr.recipient_id = ? AND fr.request_status = 'pending'
      ORDER BY fr.created_at DESC
    `;
    
    db.query(requestSQL, [userId], callback);
  }

  // 친구 요청 수락
  static acceptFriendRequest(requestId, userId, callback) {
    // 요청 확인
    const checkRequestSQL = `
      SELECT fr.*, u.user_name as sender_name, u.user_nickname as sender_nickname
      FROM FriendRequests fr 
      JOIN Users u ON fr.sender_id = u.user_id
      WHERE fr.request_id = ? AND fr.recipient_id = ? AND fr.request_status = 'pending'
    `;
    
    db.query(checkRequestSQL, [requestId, userId], (err, results) => {
      if (err) return callback(err);
      
      if (results.length === 0) {
        return callback(new Error('유효한 친구 요청을 찾을 수 없습니다.'));
      }
      
      const request = results[0];
      
      // 차단 상태 확인
      const checkBlockSQL = `
        SELECT * FROM Friendships 
        WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
        AND (is_blocked_by_user_1 = 1 OR is_blocked_by_user_2 = 1)
      `;
      
      db.query(checkBlockSQL, [request.sender_id, userId, userId, request.sender_id], (err, blockResults) => {
        if (err) return callback(err);
        
        if (blockResults.length > 0) {
          return callback(new Error('차단된 사용자의 요청은 수락할 수 없습니다.'));
        }
        
        // 요청 수락 상태로 업데이트
        const acceptRequestSQL = `
          UPDATE FriendRequests 
          SET request_status = 'accepted', updated_at = NOW() 
          WHERE request_id = ?
        `;
        
        db.query(acceptRequestSQL, [requestId], (err) => {
          if (err) return callback(err);
          
          // 친구 관계 생성
          this.createOrUpdateFriendship(request.sender_id, userId, (err, result) => {
            if (err) return callback(err);
            
            callback(null, {
              success: true,
              friend: {
                id: request.sender_id,
                name: request.sender_name,
                nickname: request.sender_nickname || ''
              }
            });
          });
        });
      });
    });
  }

  // 친구 요청 거절
  static rejectFriendRequest(requestId, userId, callback) {
    const checkRequestSQL = `
      SELECT * FROM FriendRequests 
      WHERE request_id = ? AND recipient_id = ? AND request_status = 'pending'
    `;
    
    db.query(checkRequestSQL, [requestId, userId], (err, results) => {
      if (err) return callback(err);
      
      if (results.length === 0) {
        return callback(new Error('유효한 친구 요청을 찾을 수 없습니다.'));
      }
      
      const updateRequestSQL = `
        UPDATE FriendRequests 
        SET request_status = 'rejected', updated_at = NOW() 
        WHERE request_id = ?
      `;
      
      db.query(updateRequestSQL, [requestId], callback);
    });
  }

  // 친구 요청 취소
  static cancelFriendRequest(requestId, userId, callback) {
    // 요청 확인 및 권한 확인
    const checkRequestSQL = `
      SELECT * FROM FriendRequests 
      WHERE request_id = ? AND sender_id = ? AND request_status = 'pending'
    `;
    
    db.query(checkRequestSQL, [requestId, userId], (err, results) => {
      if (err) return callback(err);
      
      if (results.length === 0) {
        return callback(new Error('취소할 수 있는 요청을 찾을 수 없습니다.'));
      }
      
      // 요청 삭제
      const deleteRequestSQL = `
        DELETE FROM FriendRequests WHERE request_id = ?
      `;
      
      db.query(deleteRequestSQL, [requestId], callback);
    });
  }

  // 친구 목록 조회
  static getFriends(userId, callback) {
    const sql = `
      SELECT 
        f.friendship_id,
        f.is_blocked_by_user_1,
        f.is_blocked_by_user_2,
        f.user_id_1,
        f.user_id_2,
        CASE 
          WHEN f.user_id_1 = ? THEN f.user_id_2
          ELSE f.user_id_1
        END as friend_id,
        u.user_name as name,
        u.user_nickname as nickname,
        false as isOnline
      FROM Friendships f
      JOIN Users u ON (
        CASE 
          WHEN f.user_id_1 = ? 
          THEN f.user_id_2
          ELSE f.user_id_1
        END = u.user_id
      )
      LEFT JOIN Location l ON (
        CASE 
          WHEN f.user_id_1 = ? THEN f.user_id_2
          ELSE f.user_id_1
        END = l.user_id
      )
      WHERE (f.user_id_1 = ? OR f.user_id_2 = ?)
      AND f.status = 'active'
      ORDER BY u.user_name
    `;
    
    db.query(sql, [userId, userId, userId, userId, userId], callback);
  }

  // 친구 관계 생성 또는 업데이트
  static createOrUpdateFriendship(user1, user2, callback) {
    const [smallerId, largerId] = user1 < user2 ? [user1, user2] : [user2, user1];
    
    // 기존 친구 관계가 있는지 확인
    const checkExistingSQL = `
      SELECT * FROM Friendships 
      WHERE user_id_1 = ? AND user_id_2 = ?
    `;
    
    db.query(checkExistingSQL, [smallerId, largerId], (err, results) => {
      if (err) return callback(err);
      
      if (results.length > 0) {
        // 기존 관계가 있으면 활성화 및 차단 해제
        const updateSQL = `
          UPDATE Friendships 
          SET status = 'active', is_blocked_by_user_1 = 0, is_blocked_by_user_2 = 0, updated_at = NOW() 
          WHERE user_id_1 = ? AND user_id_2 = ?
        `;
        
        db.query(updateSQL, [smallerId, largerId], callback);
      } else {
        // 새 친구 관계 생성
        const createSQL = `
          INSERT INTO Friendships (user_id_1, user_id_2, status, created_at, updated_at)
          VALUES (?, ?, 'active', NOW(), NOW())
        `;
        
        db.query(createSQL, [smallerId, largerId], callback);
      }
    });
  }

  // 친구 요청 자동 수락 (상대방이 먼저 요청한 경우)
  static acceptFriendRequestAuto(senderId, recipientId, callback) {
    const acceptRequestSQL = `
      UPDATE FriendRequests 
      SET request_status = 'accepted', updated_at = NOW() 
      WHERE sender_id = ? AND recipient_id = ?
    `;
    
    db.query(acceptRequestSQL, [senderId, recipientId], (err) => {
      if (err) return callback(err);
      
      // 친구 관계 생성
      this.createOrUpdateFriendship(senderId, recipientId, (err, result) => {
        if (err) return callback(err);
        
        callback(null, {
          success: true,
          message: '상대방이 보낸 친구 요청을 수락하여 친구가 되었습니다.',
          auto_accepted: true
        });
      });
    });
  }

  // 친구 차단
  static blockFriend(userId, friendId, callback) {
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    `;
    
    db.query(checkFriendshipSQL, [userId, friendId, friendId, userId], (err, results) => {
      if (err) return callback(err);
      
      if (results.length > 0) {
        // 이미 친구 관계가 있는 경우, 차단 플래그만 설정
        const friendship = results[0];
        
        let isBlockedByUser1 = friendship.is_blocked_by_user_1 || 0;
        let isBlockedByUser2 = friendship.is_blocked_by_user_2 || 0;
        
        if (friendship.user_id_1 === userId) {
          isBlockedByUser1 = 1;
        } else if (friendship.user_id_2 === userId) {
          isBlockedByUser2 = 1;
        }
        
        const updateSQL = `
          UPDATE Friendships 
          SET is_blocked_by_user_1 = ?, is_blocked_by_user_2 = ?, updated_at = NOW() 
          WHERE friendship_id = ?
        `;
        
        db.query(updateSQL, [isBlockedByUser1, isBlockedByUser2, friendship.friendship_id], callback);
      } else {
        // 친구 관계가 없는 경우, 차단된 관계 새로 생성
        const [smallerId, largerId] = userId < friendId ? [userId, friendId] : [friendId, userId];
        const isBlockedByUser1 = smallerId === userId ? 1 : 0;
        const isBlockedByUser2 = largerId === userId ? 1 : 0;
        
        const insertSQL = `
          INSERT INTO Friendships (user_id_1, user_id_2, status, is_blocked_by_user_1, is_blocked_by_user_2, created_at, updated_at)
          VALUES (?, ?, 'inactive', ?, ?, NOW(), NOW())
        `;
        
        db.query(insertSQL, [smallerId, largerId, isBlockedByUser1, isBlockedByUser2], callback);
      }
    });
  }

  // 친구 삭제
  static deleteFriend(userId, friendId, callback) {
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    `;
    
    db.query(checkFriendshipSQL, [userId, friendId, friendId, userId], (err, results) => {
      if (err) return callback(err);
      
      if (results.length === 0) {
        return callback(new Error('친구 관계를 찾을 수 없습니다.'));
      }
      
      const friendship = results[0];
      
      // 친구 관계를 데이터베이스에서 완전히 삭제
      const deleteFriendshipSQL = `
        DELETE FROM Friendships
        WHERE friendship_id = ?
      `;
      
      db.query(deleteFriendshipSQL, [friendship.friendship_id], (err) => {
        if (err) return callback(err);
        
        // 친구 요청 기록도 함께 삭제
        const deleteRequestsSQL = `
          DELETE FROM FriendRequests
          WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        `;
        
        db.query(deleteRequestsSQL, [userId, friendId, friendId, userId], (reqErr) => {
          // 요청 삭제에 실패해도 친구 관계는 이미 삭제됐으므로 계속 진행
          
          // 위치 공유 관계가 있다면 종료
          const terminateSharingSQL = `
            UPDATE LocationSharing
            SET status = 'inactive', end_time = NOW()
            WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
            AND status = 'active'
          `;
          
          db.query(terminateSharingSQL, [userId, friendId, friendId, userId], (err, result) => {
            // 오류가 있어도 무시하고 진행
            callback(null, { success: true, message: '친구 관계가 완전히 삭제되었습니다.' });
          });
        });
      });
    });
  }

  // 차단 상태 확인
  static checkBlockStatus(userId1, userId2, callback) {
    const sql = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      AND (is_blocked_by_user_1 = 1 OR is_blocked_by_user_2 = 1)
    `;
    
    db.query(sql, [userId1, userId2, userId2, userId1], (err, results) => {
      if (err) return callback(err, false, false);
      
      if (results.length === 0) {
        return callback(null, false, false);
      }
      
      const friendship = results[0];
      
      // userId1이 userId2를 차단했는지 확인
      const user1BlockedUser2 = 
        (friendship.user_id_1 === userId1 && friendship.is_blocked_by_user_1) ||
        (friendship.user_id_2 === userId1 && friendship.is_blocked_by_user_2);
      
      // userId2가 userId1을 차단했는지 확인
      const user2BlockedUser1 = 
        (friendship.user_id_1 === userId2 && friendship.is_blocked_by_user_1) ||
        (friendship.user_id_2 === userId2 && friendship.is_blocked_by_user_2);
      
      callback(null, user1BlockedUser2, user2BlockedUser1);
    });
  }
}

module.exports = FriendDAO;