const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const { errorResponse } = require('./utils/responseHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static uploads route
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'DDA PostgreSQL Backend is running', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/reminders', reminderRoutes);

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

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`DDA Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`=================================`);
});
