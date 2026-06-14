-- ============================================================
-- Standalone admin seed — run this if the DB is already created
-- ============================================================
-- Username:  Bandit
-- Email:     nicklpb1123@gmail.com
-- Password:  khamphet

USE ditshop;

INSERT INTO users (username, email, password, full_name, role) VALUES
  ('Bandit',
   'nicklpb1123@gmail.com',
   '$2a$10$927TdaX/0ZdUIyhe/KLz8esFpjs8Eev/wz2di51c2TDkOBPvtwdMu',
   'Bandit',
   'admin')
ON DUPLICATE KEY UPDATE
  password   = VALUES(password),
  full_name  = VALUES(full_name),
  role       = 'admin';
