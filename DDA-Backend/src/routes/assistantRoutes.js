/**
 * assistantRoutes.js — DDA AI Assistant REST Routes
 */

const express = require('express');
const router = express.Router();
const { processChatMessage } = require('../controllers/assistantController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/chat', processChatMessage);

module.exports = router;
