require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// =======================
// Middleware
// =======================

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://worknest-softcenterci.vercel.app',
];

const allowedOrigins = [
  ...DEFAULT_ORIGINS,
  ...String(process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
];

function isAllowedOrigin(origin) {
  const normalized = String(origin).trim().replace(/\/$/, '');
  if (allowedOrigins.includes(normalized)) return true;

  // Any Vercel deployment (production or preview URL) of the frontend
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(normalized);
}

const corsOptions = {
  origin(origin, callback) {
    // No Origin header (Postman/curl/server-to-server) → allow.
    // Deny with callback(null, false) — never callback(new Error()), or Express
    // turns it into a 500 instead of a clean CORS rejection.
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));

// Answer preflight before any route/404 handler can swallow it
app.options(/.*/, cors(corsOptions));

app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// =======================
// Routing
// =======================

// Centralized API Router
app.use('/api', require('./routes'));

// Home Route
app.get('/', (req, res) => res.json({ success: true, message: 'Auth API is running' }));

// 404 Handler
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Error Handler
app.use(require('./middleware/error.middleware'));

module.exports = app;
