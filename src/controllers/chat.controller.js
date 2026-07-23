const chatService = require("../services/chat.service");

const getChatOptions = (req) => ({
  guestSessionId: req.headers["x-guest-session"],
});

const getAiConversation = async (req, res) => {
  try {
    const data = await chatService.getConversationByType(req.user, "ai", getChatOptions(req));
    return res.json({ message: "Lay hoi thoai AI thanh cong", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const sendAiMessage = async (req, res) => {
  try {
    const data = await chatService.sendAiMessage(req.user, req.body, getChatOptions(req));
    return res.json({ message: "Gui tin nhan AI thanh cong", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const getSupportConversation = async (req, res) => {
  try {
    const data = await chatService.getConversationByType(req.user, "support", getChatOptions(req));
    return res.json({ message: "Lay hoi thoai ho tro thanh cong", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const sendSupportMessage = async (req, res) => {
  try {
    const data = await chatService.sendSupportMessage(req.user, req.body, getChatOptions(req));
    return res.json({ message: "Gui tin nhan ho tro thanh cong", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getAiConversation,
  sendAiMessage,
  getSupportConversation,
  sendSupportMessage,
};
