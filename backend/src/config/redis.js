require('dotenv').config({ path: __dirname + '/../../.env' });

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

module.exports = { redisConnection };
