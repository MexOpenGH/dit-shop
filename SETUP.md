# 🌸 Dit Shop — Setup Guide

## ⚠️ Why "Failed to fetch"?

The HTML preview only displays the **UI**. Creating accounts, placing orders, and the inbox all hit `/api/...` endpoints that require the **Node.js backend + MySQL** to be running. Until you start them, all forms will show "Failed to fetch".

---

## Step 1 — Install MySQL

If you don't have MySQL yet:
- **Easiest:** Download [XAMPP](https://www.apachefriends.org/) → install → open Control Panel → **Start MySQL**.
- Or install **MySQL Server** from https://dev.mysql.com/downloads/installer/

## Step 2 — Create the database

Open a MySQL client (XAMPP → "Shell", or MySQL Workbench, or the CLI) and run:

```bash
mysql -u root -p < "D:\Work\Dit shop\database\schema.sql"
```

This creates the `ditshop` database, all tables, and seeds your admin account:

| Field    | Value                       |
|----------|-----------------------------|
| Username | `Bandit`                    |
| Email    | `nicklpb1123@gmail.com`     |
| Password | `khamphet`                  |
| Role     | `admin`                     |

> If you already ran the original schema, just apply `database/seed_admin.sql` instead.

## Step 3 — Configure backend

```powershell
cd "D:\Work\Dit shop\backend"
Copy-Item .env.example .env
```

Edit `.env` and set:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=         # your MySQL root password (XAMPP default is empty)
DB_NAME=ditshop
JWT_SECRET=any_long_random_string_here_change_me
JWT_EXPIRES_IN=7d
PORT=3000
```

## Step 4 — Install dependencies & run

```powershell
cd "D:\Work\Dit shop\backend"
npm install
npm start
```

You should see:
```
Dit Shop server running at http://localhost:3000
```

## Step 5 — Open in browser

Go to **http://localhost:3000** (not the file:// preview!).

- Login at `/login.html` with the admin credentials above
- After admin login you're redirected to `/admin/index.html`
- Regular users: register at `/register.html`

---

## Quick troubleshoot

| Symptom | Fix |
|--------|-----|
| `Failed to fetch` on register/login | Backend isn't running → `npm start` in `backend/` |
| `ECONNREFUSED ::1:3306` | MySQL not running → start MySQL service |
| `ER_ACCESS_DENIED_ERROR` | Wrong DB_USER / DB_PASSWORD in `.env` |
| `Unknown database 'ditshop'` | Run `schema.sql` first |
| Admin login fails | Re-run `seed_admin.sql` to refresh hash |
