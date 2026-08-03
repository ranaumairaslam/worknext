require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

// =======================
// Middleware
// =======================

const allowedOrigins = (
  process.env.CLIENT_URL ||
  'http://localhost:3000,http://127.0.0.1:3000'
)
  .split(',')
  .map(origin => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('This origin is not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json());

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
