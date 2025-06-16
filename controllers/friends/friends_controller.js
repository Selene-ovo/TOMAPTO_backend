// controllers/friends/friends_controller.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const FriendDAO = require('../../models/friendDAO');

// 인증 미들웨어
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '7belly_fat4');
    
    req.user = {
      user_id: decoded.user_id
    };
    
    next();
  } catch (error) {
    console.error('인증 오류:', error);
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

// 사용자 검색 API
router.get('/search', auth, (req, res) => {
  const searchTerm = req.query.term;
  const userId = req.user.user_id;
  
  if (!searchTerm) {
    return res.status(400).json({ error: '검색어가 필요합니다.' });
  }
  
  FriendDAO.searchUsers(searchTerm, userId, (err, results) => {
    if (err) {
      console.error('사용자 검색 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    const users = results.map(user => ({
      id: user.user_id,
      name: user.user_name || user.user_id,
      nickname: user.user_nickname || ''
    }));
    
    res.status(200).json({ users });
  });
});

// 친구 요청 전송 API
router.post('/request', auth, (req, res) => {
  const { recipient_id } = req.body;
  const sender_id = req.user.user_id;
  
  if (!recipient_id) {
    return res.status(400).json({ error: '수신자 ID가 필요합니다.' });
  }
  
  if (sender_id === recipient_id) {
    return res.status(400).json({ error: '자기 자신에게는 친구 요청을 보낼 수 없습니다.' });
  }
  
  FriendDAO.sendFriendRequest(sender_id, recipient_id, (err, result) => {
    if (err) {
      console.error('친구 요청 전송 오류:', err);
      return res.status(400).json({ error: err.message });
    }
    
    if (result && result.auto_accepted) {
      // 자동 수락된 경우
      return res.status(200).json(result);
    }
    
    // 일반 요청 생성된 경우
    res.status(201).json({ 
      message: '친구 요청을 보냈습니다.',
      request_id: result.insertId
    });
  });
});

// 친구 요청 목록 조회 API
router.get('/requests', auth, (req, res) => {
  const userId = req.user.user_id;
  
  FriendDAO.getFriendRequests(userId, (err, results) => {
    if (err) {
      console.error('친구 요청 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    res.status(200).json({ requests: results });
  });
});

// 친구 요청 수락 API
router.post('/request/:requestId/accept', auth, (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.user.user_id;
  
  console.log(`친구 요청 수락 처리: ID=${requestId}, 사용자=${userId}`);
  
  FriendDAO.acceptFriendRequest(requestId, userId, (err, result) => {
    if (err) {
      console.error('친구 요청 수락 오류:', err);
      return res.status(400).json({ error: err.message });
    }
    
    console.log('친구 요청 수락 완료');
    res.status(200).json({ 
      message: '친구 요청을 수락했습니다.',
      friend: result.friend
    });
  });
});

// 친구 요청 거절 API
router.post('/request/:requestId/reject', auth, (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.user.user_id;
  
  FriendDAO.rejectFriendRequest(requestId, userId, (err, result) => {
    if (err) {
      console.error('친구 요청 거절 오류:', err);
      return res.status(400).json({ error: err.message });
    }
    
    res.status(200).json({ message: '친구 요청을 거절했습니다.' });
  });
});

// 친구 요청 취소 API
router.delete('/request/:requestId', auth, (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.user.user_id;
  
  console.log(`친구 요청 취소: 요청ID=${requestId}, 사용자=${userId}`);
  
  FriendDAO.cancelFriendRequest(requestId, userId, (err, result) => {
    if (err) {
      console.error('친구 요청 취소 오류:', err);
      return res.status(400).json({ error: err.message });
    }
    
    res.status(200).json({ message: '친구 요청이 취소되었습니다.' });
  });
});

// 친구 목록 조회 API (기존 경로 /list로 변경)
router.get('/list', auth, (req, res) => {
  const userId = req.user.user_id;
  
  FriendDAO.getFriends(userId, (err, results) => {
    if (err) {
      console.error('친구 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    // 차단되지 않은 친구만 필터링
    const friends = results
      .filter(friend => {
        // 내가 친구를 차단했거나, 친구가 나를 차단한 경우 제외
        const iBlockedFriend = 
          (friend.user_id_1 === userId && friend.is_blocked_by_user_1) ||
          (friend.user_id_2 === userId && friend.is_blocked_by_user_2);
        
        const friendBlockedMe = 
          (friend.user_id_1 === friend.friend_id && friend.is_blocked_by_user_1) ||
          (friend.user_id_2 === friend.friend_id && friend.is_blocked_by_user_2);
        
        // 서로 차단하지 않은 경우만 포함
        const shouldInclude = !iBlockedFriend && !friendBlockedMe;
        
        if (!shouldInclude) {
          console.log(`친구 목록에서 제외: ${friend.friend_id} (차단 상태)`);
        }
        
        return shouldInclude;
      })
      .map(friend => ({
        id: friend.friend_id,
        name: friend.name || friend.friend_id,
        nickname: friend.nickname || '',
        isOnline: friend.isOnline || false
      }));
    
    console.log(`친구 목록 조회 결과: 전체 ${results.length}명 중 표시 ${friends.length}명`);
    res.status(200).json({ friends });
  });
});

// 친구 차단 API
router.post('/block', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;
  
  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID가 필요합니다.' });
  }
  
  console.log(`친구 차단 요청: 사용자=${user_id}, 친구=${friend_id}`);
  
  FriendDAO.blockFriend(user_id, friend_id, (err, result) => {
    if (err) {
      console.error('친구 차단 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    // 위치 공유 종료 (차단 시 위치 공유 자동 종료)
    const terminateSharingSQL = `
      UPDATE LocationSharing
      SET status = 'inactive', end_time = NOW()
      WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
      AND status = 'active'
    `;
    
    // 위치 공유 종료는 별도로 처리 (DAO에서 분리해도 됨)
    require('../../db').query(terminateSharingSQL, [user_id, friend_id, friend_id, user_id], () => {
      console.log(`친구 차단 완료: ${user_id} -> ${friend_id}`);
      res.status(200).json({ message: '사용자가 차단되었습니다.' });
    });
  });
});

// 친구 삭제 API
router.post('/delete', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;
  
  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID가 필요합니다.' });
  }
  
  console.log(`친구 삭제 요청: 사용자=${user_id}, 친구=${friend_id}`);
  
  FriendDAO.deleteFriend(user_id, friend_id, (err, result) => {
    if (err) {
      console.error('친구 삭제 오류:', err);
      return res.status(400).json({ error: err.message });
    }
    
    console.log(`친구 삭제 완료: ${user_id} <-> ${friend_id}`);
    res.status(200).json(result);
  });
});

module.exports = router;