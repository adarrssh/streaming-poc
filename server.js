const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const uploadRoutes = require('./routes/uploadRoutes');
const backgroundProcessor = require('./services/backgroundProcessor');

const app = express();
const PORT = process.env.PORT || 8000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use(morgan('combined'));

// Routes
app.use('/api/upload', uploadRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Video upload service is running',
    timestamp: new Date().toISOString(),
    activeJobs: backgroundProcessor.getAllJobs().length
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Video Upload Service',
    version: '1.0.0',
    features: {
      asyncEncoding: true,
      cloudWatchLogging: true,
      progressTracking: true
    },
    endpoints: {
      health: '/health',
      upload: '/api/upload',
      status: '/api/upload/status/:videoId',
      jobs: '/api/upload/jobs'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Cleanup job scheduler (run every 30 minutes)
setInterval(() => {
  backgroundProcessor.cleanupCompletedJobs();
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📤 Video upload service ready`);
  console.log(`🔄 Background processing enabled`);
  console.log(`📊 CloudWatch logging enabled`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
}); 