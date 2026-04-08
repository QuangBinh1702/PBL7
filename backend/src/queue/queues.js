const { Queue } = require('bullmq');
const { redisConnection } = require('../config/redis');

const downloadQueue = new Queue('download-thumbs', { connection: redisConnection });

module.exports = { downloadQueue };
