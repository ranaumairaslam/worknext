require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// =======================
// Middleware
// =======================

const allowedOrigins = [
  process.env.CLIENT_URL || 'https://worknest-softcenterci.vercel.app',
].map(origin => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without an Origin header (e.g. Postman/curl)
      if (!origin) {
        return callback(null, true);
      }

      // Allow only the configured production frontend
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json());

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'))
);

// =======================
// Routing
// =======================

// Centralized API Router
app.use('/api', require('./routes'));

// Home Route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Auth API is running',
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error Handler
app.use(require('./middleware/error.middleware'));

module.exports = app;
/* */