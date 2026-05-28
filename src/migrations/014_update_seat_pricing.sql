-- Xoa du lieu cu (window/standard gia qua thap)
DELETE FROM seat_pricing WHERE flight_id IS NULL;

-- Them du lieu moi voi gia hop ly va du 4 vi tri
INSERT INTO seat_pricing (flight_id, seat_class, position, extra_price)
VALUES
  -- Economy
  (NULL, 'economy', 'window',        150000),
  (NULL, 'economy', 'aisle',          80000),
  (NULL, 'economy', 'middle',              0),
  (NULL, 'economy', 'extra_legroom', 350000),

  -- Business
  (NULL, 'business', 'window',       200000),
  (NULL, 'business', 'aisle',        100000),
  (NULL, 'business', 'middle',            0),
  (NULL, 'business', 'extra_legroom',500000),

  -- First
  (NULL, 'first', 'window',          300000),
  (NULL, 'first', 'aisle',           150000),
  (NULL, 'first', 'middle',               0),
  (NULL, 'first', 'extra_legroom',   700000);
