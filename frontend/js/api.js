/* ============================================================
   Dit Shop — API Client (shared by all pages)
   ============================================================ */

const API_BASE = '/api';

/* ── Currencies ────────────────────────────────────────────── */
const CURRENCIES = {
    USD: { symbol: '$', label: 'US Dollar'  },
    LAK: { symbol: '₭', label: 'Lao Kip'    },
    KIP: { symbol: '₭', label: 'Kip'        },
    THB: { symbol: '฿', label: 'Thai Baht'  },
};
function currencySymbol(code) {
    return (CURRENCIES[code] || CURRENCIES.USD).symbol;
}
/** Format a numeric amount with the matching currency symbol. */
function fmtPrice(amount, code) {
    return `${currencySymbol(code || 'USD')}${parseFloat(amount || 0).toFixed(2)}`;
}

function getToken() { return localStorage.getItem('ds_token'); }
function getUser()  { return JSON.parse(localStorage.getItem('ds_user') || 'null'); }
function setSession(token, user) {
    localStorage.setItem('ds_token', token);
    localStorage.setItem('ds_user', JSON.stringify(user));
}
function clearSession() {
    localStorage.removeItem('ds_token');
    localStorage.removeItem('ds_user');
}
function isLoggedIn()  { return !!getToken(); }
function isAdmin()     { return getUser()?.role === 'admin'; }

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(API_BASE + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
        clearSession();
        if (!window.location.pathname.includes('login')) {
            window.location.href = '/login.html?expired=1';
        }
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
}

/** Multipart upload (no Content-Type — browser sets boundary). */
async function apiUpload(path, formData) {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API_BASE + path, { method: 'POST', headers, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Upload failed'), { status: res.status, data });
    return data;
}

// Convenience wrappers
const api = {
    get:    (path)         => apiFetch(path),
    post:   (path, body)   => apiFetch(path, { method: 'POST',   body: JSON.stringify(body) }),
    put:    (path, body)   => apiFetch(path, { method: 'PUT',    body: JSON.stringify(body) }),
    patch:  (path, body)   => apiFetch(path, { method: 'PATCH',  body: JSON.stringify(body || {}) }),
    delete: (path)         => apiFetch(path, { method: 'DELETE' }),
    upload: (path, fd)     => apiUpload(path, fd),
};

/* ── Toast ─────────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { success: '✅', error: '❌', info: '💌' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || '💌'}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'toastOut .3s ease forwards';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

/* ── Ripple effect ─────────────────────────────────────────── */
document.addEventListener('click', e => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const r = document.createElement('span');
    r.className = 'ripple-effect';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    btn.appendChild(r);
    setTimeout(() => r.remove(), 600);
});

/* ── Navbar unread badge ───────────────────────────────────── */
async function refreshUnreadBadge() {
    if (!isLoggedIn()) return;
    try {
        const { count } = await api.get('/inbox/unread-count');
        document.querySelectorAll('.unread-count').forEach(el => {
            el.textContent = count;
            el.closest('.badge').style.display = count > 0 ? 'flex' : 'none';
        });
    } catch {}
}

/* ── Protect admin pages ───────────────────────────────────── */
function requireAuth(adminOnly = false) {
    if (!isLoggedIn()) { window.location.href = '/login.html'; return false; }
    if (adminOnly && !isAdmin()) { window.location.href = '/index.html'; return false; }
    return true;
}

/* ── Update navbar with auth state ────────────────────────── */
function updateNavAuth() {
    const user = getUser();
    const loginLinks  = document.querySelectorAll('.nav-login');
    const profileLinks = document.querySelectorAll('.nav-profile');
    const adminLinks  = document.querySelectorAll('.nav-admin');

    loginLinks.forEach(el => el.style.display = user ? 'none' : '');
    profileLinks.forEach(el => {
        el.style.display = user ? '' : 'none';
        const nameEl = el.querySelector('.nav-username');
        if (nameEl) nameEl.textContent = user?.username || '';
    });
    adminLinks.forEach(el => el.style.display = user?.role === 'admin' ? '' : 'none');
}

window.addEventListener('DOMContentLoaded', () => {
    updateNavAuth();
    refreshUnreadBadge();
});
