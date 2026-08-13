module.exports = function (err, req, res, next) {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    code: status,
    message: status === 500 ? 'Something went wrong' : err.message || 'Request failed',
  });
};
