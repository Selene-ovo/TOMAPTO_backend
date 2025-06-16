// controllers/location/location_controller.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const LocationDAO = require('../../models/locationDAO');

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

// API 상태 확인 엔드포인트 (디버깅용)
router.get('/status', auth, (req, res) => {
  res.status(200).json({
    success: true,
    message: '위치 API 서버가 정상 작동 중입니다.',
    user_id: req.user.user_id,
    timestamp: new Date().toISOString()
  });
});

// 내 위치 업데이트 API
router.post('/update', auth, (req, res) => {
  const { latitude, longitude, accuracy, heading } = req.body;
  const user_id = req.user.user_id;

  console.log(`위치 업데이트 요청 - 사용자: ${user_id}, 위치: ${latitude}, ${longitude}`);

  if (!latitude || !longitude) {
    return res.status(400).json({ error: '위도와 경도는 필수 입력값입니다.' });
  }

  LocationDAO.updateLocation(user_id, latitude, longitude, accuracy, heading, (err, result) => {
    if (err) {
      console.error('위치 업데이트 실패:', err);
      return res.status(500).json({ error: '위치 업데이트에 실패했습니다.' });
    }
    
    console.log(`위치 업데이트 성공 - 사용자: ${user_id}`);
    res.status(200).json(result);
  });
});

// 친구 위치 조회 API
router.get('/friend/:friendId', auth, (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = req.params.friendId;

  LocationDAO.getFriendLocation(user_id, friend_id, (err, result) => {
    if (err) {
      console.error('친구 위치 조회 실패:', err);
      if (err.message.includes('친구 관계가 없거나')) {
        return res.status(403).json({ error: err.message });
      }
      if (err.message.includes('위치 공유 관계가 없습니다')) {
        return res.status(403).json({ error: err.message });
      }
      if (err.message.includes('위치 정보가 없습니다')) {
        return res.status(404).json({ error: err.message });
      }
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    res.status(200).json(result);
  });
});

// 위치 공유 시작 API
router.post('/share', auth, (req, res) => {
  const { friend_id, duration_minutes } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  LocationDAO.startLocationSharing(user_id, friend_id, duration_minutes, (err, result) => {
    if (err) {
      console.error('위치 공유 시작 실패:', err);
      if (err.message.includes('친구 관계가 없거나')) {
        return res.status(403).json({ error: err.message });
      }
      return res.status(500).json({ error: '위치 공유 설정에 실패했습니다.' });
    }
    
    res.status(200).json(result);
  });
});

// 위치 공유 종료 API
router.post('/end-sharing', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  LocationDAO.stopLocationSharing(user_id, friend_id, (err, result) => {
    if (err) {
      console.error('위치 공유 종료 실패:', err);
      if (err.message.includes('위치 공유 관계를 찾을 수 없습니다')) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes('업데이트된 레코드가 없습니다')) {
        return res.status(404).json({ error: err.message });
      }
      return res.status(500).json({ error: '위치 공유 종료에 실패했습니다.' });
    }
    
    res.status(200).json(result);
  });
});

// 내 모든 활성 위치 공유 목록 조회 API
router.get('/active-sharings', auth, (req, res) => {
  const user_id = req.user.user_id;

  LocationDAO.getActiveSharings(user_id, (err, result) => {
    if (err) {
      console.error('위치 공유 목록 조회 실패:', err);
      return res.status(500).json({ error: '위치 공유 목록 조회에 실패했습니다.' });
    }
    
    res.status(200).json(result);
  });
});

// 위치 히스토리 조회 API
router.get('/history/:friendId', auth, (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = req.params.friendId;
  const limit = parseInt(req.query.limit) || 20;

  LocationDAO.getLocationHistory(user_id, friend_id, limit, (err, result) => {
    if (err) {
      console.error('위치 히스토리 조회 실패:', err);
      if (err.message.includes('친구 관계가 없거나')) {
        return res.status(403).json({ error: err.message });
      }
      return res.status(500).json({ error: '위치 히스토리 조회에 실패했습니다.' });
    }
    
    res.status(200).json(result);
  });
});

module.exports = router;