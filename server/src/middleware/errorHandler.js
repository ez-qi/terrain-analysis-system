export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  console.error(`[ERROR] ${req.method} ${req.path} — ${err.message}`);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
}

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Not Found' });
}
