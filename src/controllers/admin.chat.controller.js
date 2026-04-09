const adminChatService = require("../services/admin.chat.service");
const chatService = require("../services/chat.service");

const getChatConfig = async (_req, res) => {
  try {
    const data = await adminChatService.getConfig();
    return res.json({ message: "Lấy cấu hình chat thành công", data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const replaceChatConfig = async (req, res) => {
  try {
    const data = await adminChatService.replaceConfig(req.body);
    return res.json({ message: "Cập nhật toàn bộ cấu hình chat thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const patchChatConfig = async (req, res) => {
  try {
    const data = await adminChatService.patchConfig(req.body);
    return res.json({ message: "Cập nhật một phần cấu hình chat thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const sendChatMessage = async (req, res) => {
  try {
    const result = await adminChatService.chat(req.body);
    return res.json({ message: "Chat xử lý thành công", data: result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const listSupportConversations = async (req, res) => {
  try {
    const data = await chatService.listSupportConversations(req.query);
    return res.json({ message: "Lấy danh sách hội thoại hỗ trợ thành công", ...data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const getSupportConversation = async (req, res) => {
  try {
    const data = await chatService.getSupportConversationForAdmin(req.params.id, req.user);
    return res.json({ message: "Lấy chi tiết hội thoại hỗ trợ thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const replySupportConversation = async (req, res) => {
  try {
    const data = await chatService.replySupportConversation(req.params.id, req.user, req.body);
    return res.json({ message: "Gửi phản hồi hỗ trợ thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const updateSupportConversationStatus = async (req, res) => {
  try {
    const data = await chatService.updateSupportConversationStatus(req.params.id, req.body.status, req.user);
    return res.json({ message: "Cập nhật trạng thái hội thoại hỗ trợ thành công", data });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getChatConfig,
  replaceChatConfig,
  patchChatConfig,
  sendChatMessage,
  listSupportConversations,
  getSupportConversation,
  replySupportConversation,
  updateSupportConversationStatus,
};
