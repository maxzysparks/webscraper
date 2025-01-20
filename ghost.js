// Dependencies and security
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const compression = require('compression');
const sanitize = require('mongo-sanitize');
const { celebrates, Segments, Joi } = require('celebrate');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { createTerminus } = require('@godaddy/terminus');
const http = require('http');

require('dotenv-safe').config({
  allowEmptyValues: false,
  example: '.env.example'
});

const requiredEnvVars = [
  'MONGODB_URI',
  'REDIS_URL',
  'CAPTCHA_API_KEY',
  'PORT',
  'NODE_ENV',
  'API_KEY',
  'PROXY_LIST',
  'MAX_CONCURRENT_SCRAPES',
  'RATE_LIMIT_WINDOW',
  'RATE_LIMIT_MAX_REQUESTS'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
});

class ScraperError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.metadata(),
    winston.format.json()
  ),
  defaultMeta: { service: 'web-scraper' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 10000
    });

    mongoose.connection.on('error', error => {
      logger.error('MongoDB connection error:', error);
      metrics.mongoErrors.inc();
    });

    mongoose.connection.on('disconnected', () => {
      logger.error('MongoDB disconnected. Attempting to reconnect...');
      metrics.mongoDisconnections.inc();
    });

    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

const metrics = {
  ...metrics,
  mongoErrors: new prometheusClient.Counter({
    name: 'mongodb_errors_total',
    help: 'Total number of MongoDB errors'
  }),
  mongoDisconnections: new prometheusClient.Counter({
    name: 'mongodb_disconnections_total',
    help: 'Total number of MongoDB disconnections'
  }),
  queueSize: new prometheusClient.Gauge({
    name: 'scraping_queue_size',
    help: 'Current size of the scraping queue'
  }),
  proxyFailures: new prometheusClient.Counter({
    name: 'proxy_failures_total',
    help: 'Total number of proxy failures'
  })
};

const scrapeRequestSchema = Joi.object({
  urls: Joi.array().items(Joi.string().uri()).min(1).max(100).required(),
  priority: Joi.number().min(1).max(5).default(3),
  callback: Joi.string().uri().optional()
});

class WebScraper {
  constructor(config = {}) {
    const configSchema = Joi.object({
      timeout: Joi.number().min(1000).max(60000).default(10000),
      retries: Joi.number().min(1).max(10).default(3),
      delay: Joi.number().min(100).max(10000).default(1000),
      maxConcurrent: Joi.number().min(1).max(100).default(5),
      proxyList: Joi.array().items(Joi.string()).default([])
    });

    const { error, value } = configSchema.validate(config);
    if (error) {
      throw new ScraperError('Invalid configuration', 'CONFIG_ERROR', error.details);
    }

    this.config = value;
    this.initialize();
  }

  async initialize() {
    try {
      await connectDB();
      await this.initializeRedis();
      await this.initializeQueues();
      this.setupCleanup();
    } catch (error) {
      logger.error('Initialization error:', error);
      throw error;
    }
  }

  setupCleanup() {
    process.on('SIGTERM', this.cleanup.bind(this));
    process.on('SIGINT', this.cleanup.bind(this));
  }

  async cleanup() {
    logger.info('Starting cleanup...');
    try {
      await Promise.all([
        mongoose.connection.close(),
        this.closeRedisConnections(),
        this.closePuppeteerInstances()
      ]);
      logger.info('Cleanup completed successfully');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }
}

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS),
  handler: (req, res) => {
    logger.warn('Rate limit exceeded:', { ip: req.ip });
    res.status(429).json({
      error: 'Too many requests, please try again later',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    logger.warn('Invalid API key attempt:', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

const errorHandler = (err, req, res, next) => {
  logger.error('API Error:', {
    error: err,
    request: {
      method: req.method,
      url: req.url,
      body: req.body,
      ip: req.ip
    }
  });

  if (err instanceof ScraperError) {
    return res.status(400).json({
      error: err.message,
      code: err.code,
      details: err.details
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: err.details
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id
  });
};

// API routes with validation
app.post('/api/scrape', 
  apiLimiter,
  authenticate,
  celebrates({
    [Segments.BODY]: scrapeRequestSchema
  }),
  async (req, res, next) => {
    try {
      const sanitizedUrls = req.body.urls.map(url => sanitize(url));
      const scraper = new WebScraper();
      const jobs = await scraper.queueScrape(sanitizedUrls, req.body.priority);
      
      metrics.queueSize.set(await scrapeQueue.getWaitingCount());
      
      res.json({
        message: 'Scraping jobs queued',
        jobIds: jobs.map(job => job.id)
      });
    } catch (error) {
      next(error);
    }
  }
);

const healthCheck = async () => {
  await Promise.all([
    mongoose.connection.db.admin().ping(),
    new Promise((resolve, reject) => {
      scrapeQueue.client.ping((err) => {
        if (err) reject(err);
        resolve();
      });
    })
  ]);
};

const server = http.createServer(app);

createTerminus(server, {
  healthChecks: {
    '/healthz': healthCheck,
    '/readyz': healthCheck
  },
  timeout: 1000,
  signals: ['SIGTERM', 'SIGINT'],
  beforeShutdown: async () => {
    logger.info('Server is shutting down...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  },
  onSignal: async () => {
    logger.info('Starting cleanup...');
    await Promise.all([
      mongoose.connection.close(),
      scrapeQueue.close()
    ]);
  }
});

if (process.env.NODE_ENV === 'production' && cluster.isMaster) {
  logger.info(`Master ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.error(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  server.listen(process.env.PORT, () => {
    logger.info(`Worker ${process.pid} started on port ${process.env.PORT}`);
  });
}

module.exports = WebScraper;