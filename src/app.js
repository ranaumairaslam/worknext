require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// =======================
// CORS
// =======================

const allowedOrigins = [
  'https://worknest-softcenterci.vercel.app',
].map(origin => origin.trim());

const corsOptions = {
  origin: (origin, callback) => {
    // Postman / curl / server-to-server requests
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },

  credentials: true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
  ],

  optionsSuccessStatus: 204,
};

// CORS middleware
app.use(cors(corsOptions));

// Explicit preflight handling
app.options('*', cors(corsOptions));

// =======================
// Body Parser
// =======================

app.use(express.json());

// =======================
// Static Files
// =======================

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'))
);

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
// Error Handler
// =======================

app.use(require('./middleware/error.middleware'));

module.exports = app;