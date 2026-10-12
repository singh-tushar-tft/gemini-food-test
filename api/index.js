'use strict';
const path = require('path');
const { createApp } = require('../src/server');

const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
const app = createApp({ dataDir });

module.exports = app;
