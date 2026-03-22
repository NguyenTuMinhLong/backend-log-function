require("dotenv").config();
require("./config/db");

const app = require("./app");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Kết nối PostgreSQL thành công!`);
  console.log(`Server running on port ${PORT}`);
});