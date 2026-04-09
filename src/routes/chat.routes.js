const express = require("express");

const chatController = require("../controllers/chat.controller");
const { authenticate } = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/ai", chatController.getAiConversation);
router.post("/ai/message", chatController.sendAiMessage);

router.get("/support", chatController.getSupportConversation);
router.post("/support/message", chatController.sendSupportMessage);

module.exports = router;
