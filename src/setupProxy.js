const { createProxyMiddleware } = require('http-proxy-middleware');
const express = require('express');
const fs = require('fs');

const nubStudentAuthPath = require.resolve('../api/nub-student-auth');
let nubStudentAuthHandler = require(nubStudentAuthPath);
let nubStudentAuthModifiedAt = fs.statSync(nubStudentAuthPath).mtimeMs;

function getNubStudentAuthHandler() {
  const modifiedAt = fs.statSync(nubStudentAuthPath).mtimeMs;
  if (modifiedAt !== nubStudentAuthModifiedAt) {
    delete require.cache[nubStudentAuthPath];
    nubStudentAuthHandler = require(nubStudentAuthPath);
    nubStudentAuthModifiedAt = modifiedAt;
  }
  return nubStudentAuthHandler;
}

const PAYMONGO_TEST_SECRET_KEY_ENV_KEYS = Object.freeze([
  'PAYMONGO_SECRET_KEY',
  'PAYMONGO_TEST_SECRET_KEY',
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
  app.use('/api/nub-student-auth', express.json({ limit: '5mb' }));
  app.post('/api/nub-student-auth', (request, response, next) => {
    Promise.resolve(getNubStudentAuthHandler()(request, response)).catch(next);
  });

  app.use('/api/paymongo', (request, response, next) => {
    if (!readPayMongoTestSecretKey()) {
      response.status(503).json({
        error: 'PayMongo is not configured locally. Add PAYMONGO_SECRET_KEY=sk_test_... to .env.local, then restart the development server.',
      });
      return;
    }

    next();
  });

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
