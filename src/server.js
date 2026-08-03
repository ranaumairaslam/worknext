require('dotenv').config();

const app = require('./app');
const pool = require('./config/db');

const PORT = process.env.PORT || 5000;

pool
  .query('SELECT NOW()')
  .then(() => {
    console.log('Connected to Postgres database');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Database connection error:', err.message);
    process.exit(1);
  });
