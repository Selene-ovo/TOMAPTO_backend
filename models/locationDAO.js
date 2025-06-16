// models/locationDAO.js
const db = require('../db');

class LocationDAO {
  // 위치 업데이트 또는 생성
  static updateLocation(userId, latitude, longitude, accuracy, heading, callback) {
    // 먼저 사용자의 위치 정보가 이미 존재하는지 확인
    const checkSQL = `SELECT location_id FROM Location WHERE user_id = ?`;
    
    db.query(checkSQL, [userId], (err, result) => {
      if (err) return callback(err);
      
      let sql, params;
      
      if (result && result.length > 0) {
        // 기존 위치 정보 업데이트
        sql = `
          UPDATE Location 
          SET latitude = ?, longitude = ?, accuracy = ?, heading = ?, updated_at = NOW() 
          WHERE user_id = ?
        `;
        params = [latitude, longitude, accuracy || 0, heading || 0, userId];
      } else {
        // 새 위치 정보 생성
        sql = `
          INSERT INTO Location (user_id, latitude, longitude, accuracy, heading, updated_at) 
          VALUES (?, ?, ?, ?, ?, NOW())
        `;
        params = [userId, latitude, longitude, accuracy || 0, heading || 0];
      }
      
      db.query(sql, params, (err, result) => {
        if (err) return callback(err);
        
        // 위치 히스토리 추가
        const historySQL = `
          INSERT INTO LocationHistory (user_id, latitude, longitude, accuracy, heading, created_at) 
          VALUES (?, ?, ?, ?, ?, NOW())
        `;
        
        db.query(historySQL, [userId, latitude, longitude, accuracy || 0, heading || 0], (histErr) => {
          if (histErr) {
            console.error('위치 히스토리 저장 실패:', histErr);
          }
          
          callback(null, {
            success: true,
            message: '위치가 업데이트되었습니다.',
            user_id: userId,
            latitude: latitude,
            longitude: longitude,
            updated_at: new Date().toISOString()
          });
        });
      });
    });
  }

  // 친구 위치 조회 (친구 관계 및 위치 공유 확인)
  static getFriendLocation(userId, friendId, callback) {
    // 1. 친구 관계 확인
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      AND status = 'active'
      AND ((user_id_1 = ? AND IFNULL(is_blocked_by_user_1, 0) = 0) OR (user_id_2 = ? AND IFNULL(is_blocked_by_user_2, 0) = 0))
      AND ((user_id_1 = ? AND IFNULL(is_blocked_by_user_2, 0) = 0) OR (user_id_2 = ? AND IFNULL(is_blocked_by_user_1, 0) = 0))
    `;

    db.query(checkFriendshipSQL, [userId, friendId, friendId, userId, userId, userId, friendId, friendId], (err, friendResult) => {
      if (err) return callback(err);
      
      if (friendResult.length === 0) {
        return callback(new Error('친구 관계가 없거나 차단된 사용자입니다.'));
      }

      // 2. 위치 공유 관계 확인
      const checkSharingSQL = `
        SELECT * FROM LocationSharing 
        WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
        AND status = 'active'
        AND (end_time IS NULL OR end_time > NOW())
      `;

      db.query(checkSharingSQL, [userId, friendId, friendId, userId], (err, sharingResult) => {
        if (err) return callback(err);
        
        if (sharingResult.length === 0) {
          return callback(new Error('위치 공유 관계가 없습니다.'));
        }

        // 3. 친구의 최신 위치 조회
        const getLocationSQL = `
          SELECT l.user_id, l.latitude, l.longitude, l.accuracy, l.heading, 
                 l.location_name, l.updated_at, u.user_nickname
          FROM Location l
          JOIN Users u ON l.user_id = u.user_id
          WHERE l.user_id = ?
        `;

        db.query(getLocationSQL, [friendId], (err, locationResult) => {
          if (err) return callback(err);
          
          if (locationResult.length === 0) {
            return callback(new Error('친구의 위치 정보가 없습니다.'));
          }

          // 위치 조회 로그 저장
          const logViewSQL = `
            INSERT INTO LocationViewLogs (viewer_id, viewed_user_id, viewed_at)
            VALUES (?, ?, NOW())
          `;
          
          db.query(logViewSQL, [userId, friendId], () => {
            // 로그 저장 실패해도 무시
            callback(null, locationResult[0]);
          });
        });
      });
    });
  }

  // 위치 공유 시작 또는 업데이트
  static startLocationSharing(userId, friendId, durationMinutes, callback) {
    // 1. 친구 관계 확인
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      AND status = 'active'
      AND ((user_id_1 = ? AND IFNULL(is_blocked_by_user_1, 0) = 0) OR (user_id_2 = ? AND IFNULL(is_blocked_by_user_2, 0) = 0))
      AND ((user_id_1 = ? AND IFNULL(is_blocked_by_user_2, 0) = 0) OR (user_id_2 = ? AND IFNULL(is_blocked_by_user_1, 0) = 0))
    `;

    db.query(checkFriendshipSQL, [userId, friendId, friendId, userId, userId, userId, friendId, friendId], (err, friendResult) => {
      if (err) return callback(err);
      
      if (friendResult.length === 0) {
        return callback(new Error('친구 관계가 없거나 차단된 사용자입니다.'));
      }

      // 2. 기존 위치 공유 확인
      const checkActiveSharingSQL = `
        SELECT * FROM LocationSharing 
        WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
      `;

      db.query(checkActiveSharingSQL, [userId, friendId, friendId, userId], (err, activeSharingResult) => {
        if (err) return callback(err);
        
        let endTime = null;
        if (durationMinutes) {
          const now = new Date();
          endTime = new Date(now.getTime() + durationMinutes * 60000);
        }
        
        if (activeSharingResult.length > 0) {
          // 기존 위치 공유 업데이트
          const sharingId = activeSharingResult[0].sharing_id;
          const updateSQL = `
            UPDATE LocationSharing 
            SET status = 'active', end_time = ?, updated_at = NOW() 
            WHERE sharing_id = ?
          `;
          
          db.query(updateSQL, [endTime, sharingId], (err, result) => {
            if (err) return callback(err);
            
            callback(null, {
              success: true,
              message: '위치 공유가 설정되었습니다.',
              duration_minutes: durationMinutes,
              end_time: endTime ? endTime.toISOString() : null
            });
          });
        } else {
          // 새 위치 공유 생성
          const insertSQL = `
            INSERT INTO LocationSharing (sharer_id, sharee_id, status, start_time, end_time, created_at, updated_at) 
            VALUES (?, ?, 'active', NOW(), ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE status = 'active', end_time = ?, updated_at = NOW()
          `;
          
          db.query(insertSQL, [userId, friendId, endTime, endTime], (err, result) => {
            if (err) return callback(err);
            
            callback(null, {
              success: true,
              message: '위치 공유가 설정되었습니다.',
              duration_minutes: durationMinutes,
              end_time: endTime ? endTime.toISOString() : null
            });
          });
        }
      });
    });
  }

  // 위치 공유 종료
  static stopLocationSharing(userId, friendId, callback) {
    // 현재 공유 상태 확인
    const checkSharingSQL = `
      SELECT * FROM LocationSharing
      WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
    `;
    
    db.query(checkSharingSQL, [userId, friendId, friendId, userId], (err, sharingResults) => {
      if (err) return callback(err);
      
      if (sharingResults.length === 0) {
        return callback(new Error('위치 공유 관계를 찾을 수 없습니다.'));
      }

      // 위치 공유 비활성화
      const sql = `
        UPDATE LocationSharing
        SET status = 'inactive', end_time = NOW(), updated_at = NOW()
        WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
      `;

      db.query(sql, [userId, friendId, friendId, userId], (err, result) => {
        if (err) return callback(err);
        
        if (result.affectedRows === 0) {
          return callback(new Error('위치 공유 종료 실패: 업데이트된 레코드가 없습니다.'));
        }
        
        callback(null, { message: '위치 공유가 종료되었습니다.' });
      });
    });
  }

  // 활성 위치 공유 목록 조회
  static getActiveSharings(userId, callback) {
    const sql = `
      SELECT ls.*, 
             u1.user_nickname as sharer_nickname,
             u2.user_nickname as sharee_nickname
      FROM LocationSharing ls
      JOIN Users u1 ON ls.sharer_id = u1.user_id
      JOIN Users u2 ON ls.sharee_id = u2.user_id
      WHERE (ls.sharer_id = ? OR ls.sharee_id = ?)
      AND ls.status = 'active'
      AND (ls.end_time IS NULL OR ls.end_time > NOW())
    `;

    db.query(sql, [userId, userId], callback);
  }

  // 위치 히스토리 조회
  static getLocationHistory(userId, friendId, limit, callback) {
    // 1. 친구 관계 확인
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      AND status = 'active'
      AND ((user_id_1 = ? AND IFNULL(is_blocked_by_user_1, 0) = 0) OR (user_id_2 = ? AND IFNULL(is_blocked_by_user_2, 0) = 0))
      AND ((user_id_1 = ? AND IFNULL(is_blocked_by_user_2, 0) = 0) OR (user_id_2 = ? AND IFNULL(is_blocked_by_user_1, 0) = 0))
    `;

    db.query(checkFriendshipSQL, [userId, friendId, friendId, userId, userId, userId, friendId, friendId], (err, friendResult) => {
      if (err) return callback(err);
      
      if (friendResult.length === 0) {
        return callback(new Error('친구 관계가 없거나 차단된 사용자입니다.'));
      }

      // 2. 위치 히스토리 조회
      const locationHistorySQL = `
        SELECT lh.*, u.user_nickname
        FROM LocationHistory lh
        JOIN Users u ON lh.user_id = u.user_id
        WHERE lh.user_id = ?
        ORDER BY lh.created_at DESC
        LIMIT ?
      `;

      db.query(locationHistorySQL, [friendId, limit], callback);
    });
  }

  // 위치 공유 중인 친구들 조회 (소켓용)
  static getActiveSharingFriends(userId, callback) {
    const sql = `
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
    
    db.query(sql, [userId, userId, userId], callback);
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

module.exports = LocationDAO;