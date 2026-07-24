require('dotenv').config();

const { app, httpServer, errorHandler } = require('./app');
const { pool } = require('./db');
const { runMigrations } = require('./scripts/migrate');
const { initWhatsAppInboxWebSocketGateway } = require('./lib/whatsapp');

// Mount order matters where path patterns overlap:
// routes/auth (/api/users/sales) must precede routes/adminUsers (/api/users/:id).
const routers = [
  require('./routes/whatsapp'),
  require('./routes/auth'),
  require('./routes/customerMenu'),
  require('./routes/quotes'),
  require('./routes/timeoff'),
  require('./routes/calendar'),
  require('./routes/projects'),
  require('./routes/expenses'),
  require('./routes/stock'),
  require('./routes/procurement'),
  require('./routes/marketing'),
  require('./routes/adminUsers'),
  require('./routes/performance'),
  require('./routes/catalogAdmin'),
  require('./routes/production'),
  require('./routes/adminStats'),
  require('./routes/adminBrief'),
  require('./routes/ai'),
  require('./routes/qc'),
  require('./routes/profile'),
  require('./routes/customers'),
  require('./routes/campaigns'),
  require('./routes/promos'),
  require('./routes/careers'),
  require('./routes/training'),
  require('./routes/dayplan'),
  require('./routes/overview')
];

for (const router of routers) {
  app.use(router);
}
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
const startServer = async () => {
  await runMigrations(pool);
  initWhatsAppInboxWebSocketGateway(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

void startServer();
