require("dotenv").config();
require("./config/db");

require("dns").setDefaultResultOrder("ipv4first");

const http = require("http");

const app = require("./app");
const { initSocketServer } = require("./socket");

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

initSocketServer(server);

server.listen(PORT, () => {
  console.log(`[Kết nối thành công] Server đang chạy trên PORT: ${PORT}`);
});
