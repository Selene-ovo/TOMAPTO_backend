require("dotenv").config();
const bodyParser = require("body-parser");
const express = require("express");
const cors = require("cors");
const app = express();

// account 관련 라우트 (기존 유지)
const accountRoutes = require("./account/signup");
const loginRoutes = require("./account/login");
const profileRoutes = require("./account/profile");
const profileEditRoutes = require("./account/profils_edit");
const logoutRoutes = require("./account/logout");
const emailVerificationRoutes = require("./account/email_verification");
const deleteAccountRoutes = require("./account/delete_account");

// 새로운 controllers 구조로 변경 (routes → controllers)
const friendsController = require("./controllers/friends/friends_controller");
const locationController = require("./controllers/location/location_controller");

// 미들웨어 설정
app.use(
  cors({
    origin: '*', // 모든 오리진 허용 (개발 환경용)
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(bodyParser.json());

// 기본 라우트
app.get("/", (req, res) => {
  res.send("tomapto");
});
app.get("/api/account", (req, res) => {
  res.send("/api/account req send.");
});
app.get("/api/account/login", (req, res) => {
  res.send("/api/account/login req send.");
});
app.get("/api/account/signup", (req, res) => {
  res.send("/api/account/signup req send.");
});

// 회원가입 및 로그인 관련 라우트 설정 (기존 유지)
app.use("/api/account", accountRoutes);
app.use("/api/account/login", loginRoutes);
app.use("/api/account/profile", profileRoutes);
app.use("/api/account/profile-edit", profileEditRoutes);
app.use("/api/account/logout", logoutRoutes);
app.use("/api/account/verification", emailVerificationRoutes);
app.use("/api/account/password-reset", emailVerificationRoutes);
app.use("/api/account/delete", deleteAccountRoutes);

// 분리된 controllers 사용 (routes → controllers)
app.use("/api/friends", friendsController);
app.use("/api/location", locationController);

// HTTP 서버 생성 및 소켓 서버 설정
const server = require("http").createServer(app);
const initSocketServer = require("./socket");

// 소켓 서버 초기화
const io = initSocketServer(server);

// 서버 시작
server.listen(8080, process.env.IP || '0.0.0.0', () => {
  console.log("http://localhost:8080 에서 서버 실행중");
});