// Per-request context via AsyncLocalStorage. Today it carries the sandbox
// flag: when a request runs "in sandbox", every db.js query is routed to the
// sandbox schema without the route handlers knowing anything about it.
// Background jobs run outside any request context and therefore always hit
// the real schema.
const { AsyncLocalStorage } = require('node:async_hooks');

const requestContext = new AsyncLocalStorage();

const runWithRequestContext = (store, fn) => requestContext.run(store, fn);

const getRequestContext = () => requestContext.getStore() || null;

const isSandboxRequest = () => Boolean(requestContext.getStore()?.sandbox);

module.exports = {
  getRequestContext,
  isSandboxRequest,
  runWithRequestContext
};
