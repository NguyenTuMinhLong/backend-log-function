const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const flightRoutes = require("./routes/flight.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/flights", flightRoutes);

module.exports = app;