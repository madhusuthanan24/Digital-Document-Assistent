const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const prisma = require('./db');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const assistantRoutes = require('./routes/assistantRoutes');
const { errorResponse } = require('./utils/responseHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy headers (e.g. Render, Railway, Cloudflare, Fly.io)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// General API rate limiter (300 requests per 15 minutes per IP)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', generalLimiter);

// Specific rate limiter for AI Assistant (30 requests per minute per IP)
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'AI Assistant rate limit reached. Please wait a moment.' },
});
app.use('/api/assistant/', assistantLimiter);

// Static uploads route (fallback for local files)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint (checks database connectivity)
app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error: ' + (err.message || 'database unreachable');
  }

  const isHealthy = dbStatus === 'connected';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'OK' : 'DEGRADED',
    message: 'DDA Backend is running',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/assistant', assistantRoutes);

// 404 Handler
app.use((req, res) => {
  return errorResponse(res, `Route ${req.originalUrl} not found`, 404);
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[SERVER_ERROR]', err.stack || err);
  const statusCode = err.statusCode || 500;
  return errorResponse(res, err.message || 'Internal Server Error', statusCode);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`DDA Backend running on port ${PORT} (0.0.0.0)`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`[ASSISTANT_PROVIDER] NVIDIA`);
  console.log(`=================================`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down server...');
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log('Database disconnected.');
    } catch (e) {
      console.error('Error disconnecting database:', e);
    }
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);