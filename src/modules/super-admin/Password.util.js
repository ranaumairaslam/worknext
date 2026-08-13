const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;


/*
|--------------------------------------------------------------------------
| Hash Password
|--------------------------------------------------------------------------
*/

const hashPassword = async (password) => {
  if (!password) {
    throw new Error('Password is required');
  }

  return bcrypt.hash(password, SALT_ROUNDS);
};


/*
|--------------------------------------------------------------------------
| Compare Password
|--------------------------------------------------------------------------
*/

const comparePassword = async (password, hashedPassword) => {
  if (!password || !hashedPassword) {
    return false;
  }

  return bcrypt.compare(password, hashedPassword);
};


module.exports = {
  hashPassword,
  comparePassword,
};