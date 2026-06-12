require('dotenv').config();

const { app, httpServer, errorHandler } = require('./app');
const { ensureUsersSchema, ensureQuotesMarketingSchema } = require('./lib/schema');
const { ensureProductionKanbanTables } = require('./lib/kanban');
const { ensureProductCostingTable } = require('./lib/costing');
const { ensureWhatsAppInboxTables, initWhatsAppInboxWebSocketGateway } = require('./lib/whatsapp');

// Mount order matters where path patterns overlap:
// routes/auth (/api/users/sales) must precede routes/adminUsers (/api/users/:id).
const routers = [
  require('./routes/whatsapp'),
  require('./routes/auth'),
  require('./routes/customerMenu'),
  require('./routes/quotes'),
  require('./routes/timeoff'),
  require('./routes/projects'),
  require('./routes/expenses'),
  require('./routes/stock'),
  require('./routes/marketing'),
  require('./routes/adminUsers'),
  require('./routes/performance'),
  require('./routes/catalogAdmin'),
  require('./routes/production'),
  require('./routes/adminStats'),
  require('./routes/qc'),
  require('./routes/profile')
];

for (const router of routers) {
  app.use(router);
}
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
const startServer = async () => {
  await ensureUsersSchema();
  await ensureQuotesMarketingSchema();
  await ensureProductionKanbanTables();
  await ensureProductCostingTable();
  await ensureWhatsAppInboxTables();
  initWhatsAppInboxWebSocketGateway(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

void startServer();
