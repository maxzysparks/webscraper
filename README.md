# Production Web Scraper

A robust, scalable web scraping solution with built-in queue management, proxy support, CAPTCHA handling, and comprehensive error recovery. Designed for production environments with high availability and reliability requirements.

## Features

- **Queue System**: Bull queue implementation for large-scale scraping
- **Database Integration**: MongoDB storage with Mongoose
- **Proxy Support**: Rotating proxy pool with failure detection
- **CAPTCHA Handling**: Automatic CAPTCHA detection and solving
- **Rate Limiting**: Domain-specific and global rate limiting
- **Error Recovery**: Sophisticated retry mechanisms and error handling
- **Monitoring**: Prometheus metrics and health checks
- **Security**: Built-in protection against common vulnerabilities
- **Scalability**: Cluster mode support for multiple workers
- **API Access**: RESTful API with authentication

## Prerequisites

- Node.js (v14.x or higher)
- MongoDB (v4.x or higher)
- Redis (v6.x or higher)
- PM2 (for production deployment)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-repo/web-scraper.git
cd web-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Create environment files:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```env
# Server Configuration
NODE_ENV=production
PORT=3000
API_KEY=your-secure-api-key

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/scraper
REDIS_URL=redis://localhost:6379

# Scraping Configuration
MAX_CONCURRENT_SCRAPES=5
CAPTCHA_API_KEY=your-2captcha-api-key
PROXY_LIST=proxy1.example.com:8080,proxy2.example.com:8080

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX_REQUESTS=100

# Security
ALLOWED_ORIGINS=https://your-domain.com,https://another-domain.com

# Logging
LOG_LEVEL=info
```

## Usage

### Starting the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### API Endpoints

#### Queue Scraping Jobs
```http
POST /api/scrape
Content-Type: application/json
X-API-Key: your-api-key

{
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2"
  ],
  "priority": 3
}
```

#### Check Job Status
```http
GET /api/results/:jobId
X-API-Key: your-api-key
```

#### Health Check
```http
GET /healthz
```

#### Metrics
```http
GET /metrics
```

### Example Usage

```javascript
const WebScraper = require('./WebScraper');

const scraper = new WebScraper({
  timeout: 15000,
  retries: 3,
  delay: 2000,
  maxConcurrent: 5,
  proxyList: ['proxy1.example.com:8080']
});

// Queue multiple URLs for scraping
const urls = [
  'https://example.com/page1',
  'https://example.com/page2'
];

scraper.queueScrape(urls)
  .then(jobs => console.log('Jobs queued:', jobs))
  .catch(error => console.error('Error:', error));
```

## Monitoring

### Available Metrics

- `web_scraper_attempts_total`: Total number of scraping attempts
- `web_scraper_successes_total`: Successful scrapes
- `web_scraper_errors_total`: Failed scrapes
- `web_scraper_duration_seconds`: Scraping duration
- `mongodb_errors_total`: MongoDB errors
- `mongodb_disconnections_total`: MongoDB disconnections
- `scraping_queue_size`: Current queue size
- `proxy_failures_total`: Proxy failures

### Health Checks

The service provides two health check endpoints:
- `/healthz`: Liveness probe
- `/readyz`: Readiness probe

## Production Deployment

1. Set up MongoDB replication:
```bash
# MongoDB replication configuration
mongod --replSet "rs0"
```

2. Configure Redis persistence:
```bash
# redis.conf
appendonly yes
appendfsync everysec
```

3. Start the application using PM2:
```bash
pm2 start ecosystem.config.js
```

4. Set up Nginx reverse proxy:
```nginx
upstream scraper {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name scraper.yourdomain.com;

    location / {
        proxy_pass http://scraper;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Error Handling

The scraper implements multiple levels of error handling:

1. Network errors: Automatic retry with exponential backoff
2. CAPTCHA detection: Automatic solving using 2captcha
3. Proxy failures: Automatic rotation to working proxies
4. Rate limiting: Per-domain throttling
5. Database errors: Automatic reconnection
6. Queue errors: Job recovery and persistence

## Security Considerations

- API authentication required for all endpoints
- Input validation and sanitization
- Rate limiting per IP and domain
- CORS protection
- Security headers (Helmet)
- Request size limits
- MongoDB query sanitization

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Maintenance

### Log Rotation

Logs are automatically rotated when they reach 5MB, keeping the last 5 files:
```javascript
filename: 'logs/error.log',
maxsize: 5242880, // 5MB
maxFiles: 5
```

### Database Maintenance

Regular database maintenance tasks:
```bash
# Compact database
mongod --repair --dbpath /var/lib/mongodb

# Create backups
mongodump --out /backup/mongodump-$(date +"%Y-%m-%d")
```

## License

MIT License - see LICENSE file for details

## Support

For support questions, please open an issue in the GitHub repository

## Acknowledgments

- Bull for queue management
- Cheerio for HTML parsing
- Puppeteer for browser automation
- MongoDB for data storage
- Express for API framework