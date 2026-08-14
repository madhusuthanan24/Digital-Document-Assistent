const prisma = require('../db');
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * Create Reminder
 * POST /api/reminders
 */
const createReminder = async (req, res) => {
  try {
    const { title, reminderDate } = req.body;
    const userId = req.user.userId;

    if (!title || !reminderDate) {
      return errorResponse(res, 'title and reminderDate are required', 400);
    }

    const parsedDate = new Date(reminderDate);
    if (isNaN(parsedDate.getTime())) {
      return errorResponse(res, 'Invalid reminderDate format. Must be a valid date.', 400);
    }

    const reminder = await prisma.reminder.create({
      data: {
        userId,
        title,
        reminderDate: parsedDate,
      },
    });

    return successResponse(res, reminder, 'Reminder created successfully', 201);
  } catch (error) {
    console.error('[REMINDER_CREATE] Error:', error);
    return errorResponse(res, 'Failed to create reminder: ' + error.message, 500);
  }
};

/**
 * Get All Reminders for authenticated user
 * GET /api/reminders
 */
const getReminders = async (req, res) => {
  try {
    const userId = req.user.userId;

    const reminders = await prisma.reminder.findMany({
      where: { userId },
      orderBy: { reminderDate: 'asc' },
    });

    return successResponse(res, reminders, 'Reminders retrieved successfully');
  } catch (error) {
    console.error('[REMINDER_LIST] Error:', error);
    return errorResponse(res, 'Failed to fetch reminders: ' + error.message, 500);
  }
};

/**
 * Get Single Reminder by ID
 * GET /api/reminders/:id
 */
const getReminderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const reminder = await prisma.reminder.findFirst({
      where: { id, userId },
    });

    if (!reminder) {
      return errorResponse(res, 'Reminder not found', 404);
    }

    return successResponse(res, reminder, 'Reminder retrieved successfully');
  } catch (error) {
    console.error('[REMINDER_GET] Error:', error);
    return errorResponse(res, 'Failed to fetch reminder: ' + error.message, 500);
  }
};

/**
 * Update Reminder
 * PUT /api/reminders/:id
 */
const updateReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { title, reminderDate } = req.body;

    const existing = await prisma.reminder.findFirst({ where: { id, userId } });
    if (!existing) {
      return errorResponse(res, 'Reminder not found', 404);
    }

    const updatedDate = reminderDate ? new Date(reminderDate) : existing.reminderDate;

    const updated = await prisma.reminder.update({
      where: { id },
      data: {
        title: title !== undefined ? title : existing.title,
        reminderDate: updatedDate,
      },
    });

    return successResponse(res, updated, 'Reminder updated successfully');
  } catch (error) {
    console.error('[REMINDER_UPDATE] Error:', error);
    return errorResponse(res, 'Failed to update reminder: ' + error.message, 500);
  }
};

/**
 * Delete Reminder
 * DELETE /api/reminders/:id
 */
const deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const reminder = await prisma.reminder.findFirst({ where: { id, userId } });
    if (!reminder) {
      return errorResponse(res, 'Reminder not found', 404);
    }

    await prisma.reminder.delete({ where: { id } });

    return successResponse(res, null, 'Reminder deleted successfully');
  } catch (error) {
    console.error('[REMINDER_DELETE] Error:', error);
    return errorResponse(res, 'Failed to delete reminder: ' + error.message, 500);
  }
};

module.exports = {
  createReminder,
  getReminders,
  getReminderById,
  updateReminder,
  deleteReminder,
};
