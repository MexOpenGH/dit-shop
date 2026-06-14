-- ============================================================
-- Dit Shop - Gift Card Store Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS ditshop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ditshop;

-- ------------------------------------------------------------
-- Users Table
-- ------------------------------------------------------------
CREATE TABLE users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    email       VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,          -- bcrypt hash
    full_name   VARCHAR(100),
    role        ENUM('user','admin') NOT NULL DEFAULT 'user',
    avatar_url  VARCHAR(255),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Gift Card Types / Products
-- ------------------------------------------------------------
CREATE TABLE gift_cards (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    denomination  DECIMAL(10,2) NOT NULL,       -- face value, e.g. 25.00
    price         DECIMAL(10,2) NOT NULL,        -- selling price
    image_url     VARCHAR(255),
    category      VARCHAR(50),
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Gift Card Codes (Stock)
-- ------------------------------------------------------------
CREATE TABLE gift_card_codes (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    gift_card_id  INT NOT NULL,
    code          VARCHAR(100) NOT NULL UNIQUE,
    status        ENUM('available','reserved','used') NOT NULL DEFAULT 'available',
    added_by      INT,                            -- admin user id
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (added_by)     REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- Orders
-- ------------------------------------------------------------
CREATE TABLE orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    gift_card_id    INT NOT NULL,
    code_id         INT,                           -- assigned after admin confirms
    quantity        INT NOT NULL DEFAULT 1,
    total_price     DECIMAL(10,2) NOT NULL,
    status          ENUM('pending','confirmed','delivered','cancelled') NOT NULL DEFAULT 'pending',
    payment_ref     VARCHAR(100),                  -- external payment reference
    notes           TEXT,
    confirmed_by    INT,                           -- admin user id
    confirmed_at    DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE,
    FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id)       ON DELETE RESTRICT,
    FOREIGN KEY (code_id)      REFERENCES gift_card_codes(id)  ON DELETE SET NULL,
    FOREIGN KEY (confirmed_by) REFERENCES users(id)            ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- Inbox Messages  (two-way: system→user, user→admin help, admin→user reply)
-- ------------------------------------------------------------
CREATE TABLE inbox_messages (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,                      -- recipient (user inbox owner, OR admin row owner)
    from_user_id  INT,                               -- author; NULL for system; set for user→admin help and admin→user reply
    order_id      INT,                               -- linked order (nullable for system msgs)
    sender        VARCHAR(50) NOT NULL DEFAULT 'Dit Shop',
    subject       VARCHAR(200) NOT NULL,
    body          TEXT NOT NULL,
    is_help       TINYINT(1) NOT NULL DEFAULT 0,     -- 1 = user-submitted HELP message visible to admin
    parent_id     INT,                               -- reply chain pointer
    is_read       TINYINT(1) NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id)            ON DELETE SET NULL,
    FOREIGN KEY (order_id)     REFERENCES orders(id)           ON DELETE SET NULL,
    FOREIGN KEY (parent_id)    REFERENCES inbox_messages(id)   ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- Indexes for common queries
-- ------------------------------------------------------------
CREATE INDEX idx_codes_status       ON gift_card_codes(gift_card_id, status);
CREATE INDEX idx_orders_user        ON orders(user_id, status);
CREATE INDEX idx_orders_status      ON orders(status);
CREATE INDEX idx_inbox_user_read    ON inbox_messages(user_id, is_read);
CREATE INDEX idx_inbox_help         ON inbox_messages(is_help, is_read);

-- ------------------------------------------------------------
-- Seed: admin account
--   username: Bandit
--   email:    nicklpb1123@gmail.com
--   password: khamphet   (bcrypt hash below)
-- ------------------------------------------------------------
INSERT INTO users (username, email, password, full_name, role) VALUES
('Bandit', 'nicklpb1123@gmail.com', '$2a$10$927TdaX/0ZdUIyhe/KLz8esFpjs8Eev/wz2di51c2TDkOBPvtwdMu', 'Bandit', 'admin');

-- ------------------------------------------------------------
-- Seed: sample gift cards
-- ------------------------------------------------------------
INSERT INTO gift_cards (name, description, denomination, price, category, image_url) VALUES
('Steam Gift Card $10',  'Use on any Steam purchase.',              10.00,  10.50, 'Gaming',     '/img/steam.png'),
('Netflix Gift Card $25','1 month premium subscription voucher.',   25.00,  26.00, 'Streaming',  '/img/netflix.png'),
('Google Play $15',      'Buy apps, games, or movies on Google.',   15.00,  15.75, 'Mobile',     '/img/google.png'),
('Amazon Gift Card $50', 'Shop anything on Amazon.com.',            50.00,  51.00, 'Shopping',   '/img/amazon.png'),
('Spotify Premium $10',  '1 month ad-free music streaming.',        10.00,  10.25, 'Streaming',  '/img/spotify.png');
