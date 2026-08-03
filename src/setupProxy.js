const { createProxyMiddleware } = require('http-proxy-middleware');

const PAYMONGO_TEST_SECRET_KEY_ENV_KEYS = Object.freeze([
  'REACT_APP_PAYMONGO_TEST_SECRET_KEY',
  'REACT_APP_PAYMONGO_SECRET_KEY',
]);

function readPayMongoTestSecretKey() {
  const secretKey = PAYMONGO_TEST_SECRET_KEY_ENV_KEYS.map((envKey) => process.env[envKey]).find(
    (value) => typeof value === 'string' && value.trim()
  );

  if (!secretKey) {
    return '';
  }

  const trimmedKey = secretKey.trim();
  return trimmedKey.startsWith('sk_test_') ? trimmedKey : '';
}

module.exports = function setupPayMongoProxy(app) {
  app.use(
    '/api/paymongo',
    createProxyMiddleware({
      changeOrigin: true,
      on: {
        proxyReq: (proxyReq) => {
          const secretKey = readPayMongoTestSecretKey();

          // PayMongo server-to-server endpoints can reject browser-originated headers.
          proxyReq.removeHeader('origin');
          proxyReq.removeHeader('referer');

          if (secretKey) {
            proxyReq.setHeader('Authorization', `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`);
          }
        },
      },
      pathRewrite: {
        '^/api/paymongo': '',
      },
      target: 'https://api.paymongo.com',
    })
  );
};
