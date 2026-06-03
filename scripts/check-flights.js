// Check flights in DB
require('dotenv').config();
const pool = require('../src/config/db');

pool.query(`
  SELECT f.id, f.flight_number, f.departure_time, 
         al.code as airline, 
         dep.code as "from", 
         arr.code as "to"
  FROM flights f 
  JOIN airlines al ON al.id = f.airline_id 
  JOIN airports dep ON dep.id = f.departure_airport_id 
  JOIN airports arr ON arr.id = f.arrival_airport_id 
  WHERE f.status = 'scheduled' 
    AND f.is_active = true 
    AND f.departure_time > NOW()
  LIMIT 10
`).then(r => { 
  console.log('Total flights:', r.rows.length);
  console.log(JSON.stringify(r.rows, null, 2)); 
  pool.end(); 
});
