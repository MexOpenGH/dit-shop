# 🌸 Dit Shop — Gift Card Store

A full-stack gift card store with a Pink Rose theme, built with Node.js/Express and vanilla HTML/CSS/JS.

## Project Structure

```
Dit shop/
├── database/
│   └── schema.sql          ← Run this first to set up the DB
├── backend/
│   ├── server.js           ← Express entry point
│   ├── .env.example        ← Copy to .env and fill in values
│   ├── package.json
│   ├── config/db.js        ← MySQL connection pool
│   ├── middleware/auth.js  ← JWT auth + admin guard
│   └── routes/
│       ├── auth.js         ← /api/auth  (register, login, me)
│       ├── cards.js        ← /api/cards (browse, manage, add codes)
│       ├── orders.js       ← /api/orders (place, confirm, cancel)
│       ├── inbox.js        ← /api/inbox (messages)
│       └── admin.js        ← /api/admin (stats, users, stock)
└── frontend/
    ├── index.html          ← Storefront
    ├── login.html
    ├── register.html
    ├── profile.html        ← My Orders
    ├── inbox.html          ← User Inbox / Message Box
    ├── admin/
    │   ├── index.html      ← Admin Dashboard
    │   ├── stocks.html     ← Manage gift card types + codes
    │   └── orders.html     ← Confirm orders & assign codes
    ├── css/
    │   ├── main.css        ← Pink Rose theme
    │   └── animations.css  ← Hover effects, skeletons, transitions
    └── js/
        └── api.js          ← Shared fetch client, toast, auth helpers
```

## Quick Start

### 1. Database

```sql
-- In MySQL client:
source database/schema.sql
```

Then generate a real bcrypt hash for the admin password and update the seed row:
```bash
node -e "require('bcryptjs').hash('Admin@123',10,(_,h)=>console.log(h))"
# Copy the output, then:
UPDATE users SET password='<hash>' WHERE username='admin';
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # fill in DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET
npm install
npm run dev                   # nodemon, or: npm start
```

Server starts at **http://localhost:3000**  
Frontend is served statically from `/frontend`.

### 3. Open in browser

| URL | Page |
|-----|------|
| `http://localhost:3000` | Storefront |
| `http://localhost:3000/login.html` | User Login |
| `http://localhost:3000/register.html` | Register |
| `http://localhost:3000/profile.html` | My Orders |
| `http://localhost:3000/inbox.html` | User Inbox |
| `http://localhost:3000/admin/index.html` | Admin Dashboard |
| `http://localhost:3000/admin/stocks.html` | Stock Manager |
| `http://localhost:3000/admin/orders.html` | Order Management |

## Core API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login, get JWT |
| GET | `/api/auth/me` | User | Get own profile |
| GET | `/api/cards` | — | List available gift cards |
| POST | `/api/cards` | Admin | Create new card type |
| POST | `/api/cards/:id/codes` | Admin | Add codes to stock |
| POST | `/api/orders` | User | Place an order |
| GET | `/api/orders` | User/Admin | List orders |
| POST | `/api/orders/:id/confirm` | Admin | Confirm & deliver code to inbox |
| POST | `/api/orders/:id/cancel` | User/Admin | Cancel pending order |
| GET | `/api/inbox` | User | List inbox messages |
| PATCH | `/api/inbox/:id/read` | User | Mark message as read |
| GET | `/api/admin/stats` | Admin | Dashboard stats |

## Key User Flow

1. **User registers** → logs in → browses storefront
2. **User places order** → status: `pending`, inbox confirmation message sent
3. **Admin opens Orders page** → clicks "Confirm" on a pending order
4. **System picks an available code** from stock, marks it `used`, updates order to `delivered`
5. **User's inbox** receives a message containing the gift card code automatically

## Design Tokens (Pink Rose Theme)

```css
--rose-500: #f43f5e   /* primary accent */
--pink-500: #ec4899   /* secondary accent */
--rose-50:  #fff1f2   /* light backgrounds */
--rose-100: #ffe4e6   /* cards, subtle fills */
```
