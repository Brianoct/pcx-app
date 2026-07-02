const express = require('express');
const cors = require('cors');
const http = require('http');
const { CUSTOMER_MENU_IMAGE_DIR, LEGACY_MENU_IMAGE_DIR } = require('./lib/customerMenu');
const { EMPLOYEE_ASSET_DIR } = require('./lib/employeeAssets');
const fsSync = require('fs');

const app = express();
const httpServer = http.createServer(app);

// Behind Render's proxy; needed so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// Restrict browser origins in production by setting FRONTEND_ORIGIN to a
// comma-separated list (e.g. https://pcx-frontend.onrender.com). When unset
// (local dev), all origins are allowed as before.
const allowedOrigins = String(process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : {}));
app.use(express.json({
  limit: '20mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

app.use('/customer-menu-images', express.static(CUSTOMER_MENU_IMAGE_DIR));
app.use('/menu-images', express.static(CUSTOMER_MENU_IMAGE_DIR));
app.use('/employee-assets', express.static(EMPLOYEE_ASSET_DIR));
if (fsSync.existsSync(LEGACY_MENU_IMAGE_DIR)) {
  app.use('/menu-images', express.static(LEGACY_MENU_IMAGE_DIR));
}

// Registered after the routers (see index.js).
const errorHandler = (err, _req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'La imagen es demasiado pesada para subir. Intenta con una imagen más liviana (máx ~8MB).'
    });
  }
  return next(err);
};

module.exports = { app, httpServer, errorHandler };
