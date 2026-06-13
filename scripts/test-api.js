"use strict";

require("dotenv").config();
const http = require("http");

const options = {
  hostname: "localhost",
  port: 3000,
  path: "/api/recommendations",
  method: "GET",
  timeout: 20000,
};

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    const parsed = JSON.parse(data);
    const d = parsed.data;
    console.log("Flights:", d?.flights?.length);
    console.log("Groups:", d?.groups?.length);
    console.log("Meta:", JSON.stringify(d?.meta, null, 2));
    if (d?.flights?.length > 0) {
      const f = d.flights[0];
      console.log("\nSample flight:", f.flight_number, f.departure?.code, "->", f.arrival?.code);
      console.log("Price:", f.seat?.base_price, "x", f.seat?.price_multiplier, "=", f.seat?.adjusted_price);
    }
  });
});

req.on("error", (e) => console.error("Error:", e.message));
  req.on("timeout", () => {
  console.error("Request TIMEOUT after 20s");
  req.destroy();
});
req.end();
