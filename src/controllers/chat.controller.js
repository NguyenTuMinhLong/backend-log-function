const chatService = require("../services/chat.service");

const getAiConversation = async (req, res) => {
  try {
    const data = await chatService.getConversationByType(req.user, "ai");
    return res.json({ message: "Lấy hội thoại AI thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const sendAiMessage = async (req, res) => {
  try {
    const data = await chatService.sendAiMessage(req.user, req.body);
    return res.json({ message: "Gửi tin nhắn AI thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const getSupportConversation = async (req, res) => {
  try {
    const data = await chatService.getConversationByType(req.user, "support");
    return res.json({ message: "Lấy hội thoại hỗ trợ thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const sendSupportMessage = async (req, res) => {
  try {
    const data = await chatService.sendSupportMessage(req.user, req.body);
    return res.json({ message: "Gửi tin nhắn hỗ trợ thành công", data });
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
