require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// =======================
// CORS
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
  if (!origin) return false;
  const normalized = String(origin).trim().replace(/\/$/, '');
  if (allowedOrigins.includes(normalized)) return true;
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(normalized);
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Requested-With, Accept, Origin'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Always answer preflight early (before routes / heavy handlers)
app.use((req, res, next) => {
  applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  })
);

app.use(express.json());

// =======================
// Static Files
// =======================

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// =======================
// API Routes
// =======================

app.use('/api', require('./routes'));

// =======================
// Home Route
// =======================

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Auth API is running',
  });
});

// =======================
// 404 Handler
// =======================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// =======================
// Error Handler (keep CORS on errors)
// =======================

app.use((err, req, res, next) => {
  applyCorsHeaders(req, res);
  return require('./middleware/error.middleware')(err, req, res, next);
});

module.exports = app;
