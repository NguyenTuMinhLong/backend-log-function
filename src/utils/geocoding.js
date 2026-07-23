"use strict";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lấy tọa độ (lat, lng) từ Nominatim (OpenStreetMap).
 * Thử lần lượt 3 query, delay 1s giữa mỗi lần (bắt buộc theo Nominatim policy).
 * @returns {{ lat: number, lng: number } | null}
 */
const getCoords = async (airportName, city, country) => {
  const queries = [
    `${airportName} airport`,
    `${city} airport ${country}`,
    `${city} ${country}`,
  ];

  for (const q of queries) {
    try {
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(q)}` +
        `&format=json&limit=1&addressdetails=0`;

      const res  = await fetch(url, {
        headers: { "User-Agent": "Vivudee/1.0 (daodungvan321@gmail.com)" },
      });
      const data = await res.json();

      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch (err) {
      console.error(`[geocoding] fetch error: ${err.message}`);
    }

    await delay(1000);
  }

  return null;
};

module.exports = { getCoords };
