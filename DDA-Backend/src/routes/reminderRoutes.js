const express = require('express');
const router = express.Router();
const {
  createReminder,
  getReminders,
  getReminderById,
  updateReminder,
  deleteReminder,
} = require('../controllers/reminderController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', createReminder);
router.get('/', getReminders);
router.get('/:id', getReminderById);
router.put('/:id', updateReminder);
router.delete('/:id', deleteReminder);

module.exports = router;
