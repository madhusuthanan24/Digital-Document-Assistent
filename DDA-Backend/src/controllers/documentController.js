const prisma = require('../db');
const path = require('path');
const fs = require('fs');
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * Create Document
 * POST /api/documents
 */
const createDocument = async (req, res) => {
  try {
    const {
      documentType,
      documentName,
      documentNumber,
      name,
      fatherName,
      gender,
      address,
      dateOfBirth,
      issueDate,
      expiryDate,
      fields: bodyFields,
      imagePath: bodyImagePath,
    } = req.body;
    const userId = req.user?.userId || req.body.userId;

    console.log(`[Document] Saving document: type="${documentType}", name="${documentName}"`);

    if (!documentType || !documentName) {
      return errorResponse(res, 'documentType and documentName are required', 400);
    }

    // Ensure User record exists in PostgreSQL database
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
      await prisma.user.create({
        data: {
          id: userId,
          name: name || 'Document Owner',
          email: `${userId}@dda.local`,
          password: 'hashed_password',
        },
      });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : (bodyImagePath || null);
    const mimeType = req.file ? req.file.mimetype : (req.body.mimeType || 'image/jpeg');

    let fieldsStr = null;
    if (typeof bodyFields === 'string') {
      fieldsStr = bodyFields;
    } else if (typeof bodyFields === 'object' && bodyFields !== null) {
      fieldsStr = JSON.stringify(bodyFields);
    }

    console.log(`[Document] Image path: ${imagePath}, fields: ${fieldsStr}`);

    const document = await prisma.document.create({
      data: {
        userId,
        documentType,
        documentName,
        documentNumber: documentNumber || null,
        name: name || null,
        fatherName: fatherName || null,
        gender: gender || null,
        address: address || null,
        dateOfBirth: dateOfBirth || null,
        issueDate: issueDate || null,
        expiryDate: expiryDate || null,
        fields: fieldsStr,
        imagePath,
        croppedImagePath: imagePath,
        originalImagePath: req.body.originalImagePath || null,
        mimeType,
      },
    });

    console.log(`[Document] PostgreSQL document created: id=${document.id}`);

    return successResponse(res, document, 'Document created successfully', 201);
  } catch (error) {
    console.error('[DOC_CREATE] Error:', error);
    return errorResponse(res, 'Failed to create document: ' + error.message, 500);
  }
};

/**
 * Get All Documents (for authenticated user)
 * GET /api/documents
 */
const getDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;

    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return successResponse(res, documents, 'Documents retrieved successfully');
  } catch (error) {
    console.error('[DOC_LIST] Error:', error);
    return errorResponse(res, 'Failed to fetch documents: ' + error.message, 500);
  }
};

/**
 * Get Single Document by ID
 * GET /api/documents/:id
 */
const getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const document = await prisma.document.findFirst({
      where: { id, userId },
    });

    if (!document) {
      return errorResponse(res, 'Document not found', 404);
    }

    return successResponse(res, document, 'Document retrieved successfully');
  } catch (error) {
    console.error('[DOC_GET] Error:', error);
    return errorResponse(res, 'Failed to fetch document: ' + error.message, 500);
  }
};

/**
 * Update Document
 * PUT /api/documents/:id
 */
const updateDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const {
      documentType,
      documentName,
      documentNumber,
      name,
      fatherName,
      gender,
      address,
      dateOfBirth,
      issueDate,
      expiryDate,
      fields: bodyFields,
    } = req.body;

    const existing = await prisma.document.findFirst({ where: { id, userId } });
    if (!existing) {
      return errorResponse(res, 'Document not found', 404);
    }

    let fieldsStr = existing.fields;
    if (typeof bodyFields === 'string') {
      fieldsStr = bodyFields;
    } else if (typeof bodyFields === 'object' && bodyFields !== null) {
      fieldsStr = JSON.stringify(bodyFields);
    }

    const newImagePath = req.file ? `/uploads/${req.file.filename}` : existing.imagePath;
    const newMimeType = req.file ? req.file.mimetype : existing.mimeType;

    // Delete old file if replaced
    if (req.file && existing.imagePath) {
      const oldFilePath = path.join(__dirname, '../../', existing.imagePath);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    const updated = await prisma.document.update({
      where: { id },
      data: {
        documentType: documentType || existing.documentType,
        documentName: documentName || existing.documentName,
        documentNumber: documentNumber !== undefined ? documentNumber : existing.documentNumber,
        name: name !== undefined ? name : existing.name,
        fatherName: fatherName !== undefined ? fatherName : existing.fatherName,
        gender: gender !== undefined ? gender : existing.gender,
        address: address !== undefined ? address : existing.address,
        dateOfBirth: dateOfBirth !== undefined ? dateOfBirth : existing.dateOfBirth,
        issueDate: issueDate !== undefined ? issueDate : existing.issueDate,
        expiryDate: expiryDate !== undefined ? expiryDate : existing.expiryDate,
        fields: fieldsStr,
        imagePath: newImagePath,
        mimeType: newMimeType,
      },
    });

    return successResponse(res, updated, 'Document updated successfully');
  } catch (error) {
    console.error('[DOC_UPDATE] Error:', error);
    return errorResponse(res, 'Failed to update document: ' + error.message, 500);
  }
};

/**
 * Delete Document
 * DELETE /api/documents/:id
 */
const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const document = await prisma.document.findFirst({ where: { id, userId } });
    if (!document) {
      return errorResponse(res, 'Document not found', 404);
    }

    // Remove file from disk if exists
    if (document.imagePath) {
      const fullPath = path.join(__dirname, '../../', document.imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await prisma.document.delete({ where: { id } });

    return successResponse(res, null, 'Document deleted successfully');
  } catch (error) {
    console.error('[DOC_DELETE] Error:', error);
    return errorResponse(res, 'Failed to delete document: ' + error.message, 500);
  }
};

/**
 * Helper to parse diverse document date formats:
 * - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 * - YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
 * - 15 Oct 2026, October 15 2026, ISO strings
 */
function parseDocumentDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // 1. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 2. YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 3. Native Date parse fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function formatDisplayDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

function calculateDaysRemaining(targetDate, today = new Date()) {
  const targetMidnight = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = targetMidnight.getTime() - todayMidnight.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

const IGNORED_DATE_KEYS = [
  'dateofbirth', 'dob', 'birthdate', 'birth',
  'issuedate', 'issue_date', 'issuedon', 'issued',
  'registrationdate', 'registration_date',
  'documentdate', 'testdate', 'purchasedate', 'yearofpassing'
];

/**
 * Get Expiry Reminders (documents with upcoming or expired dates)
 * GET /api/documents/reminders/expiry
 */
const getExpiryReminders = async (req, res) => {
  try {
    const userId = req.user?.userId || req.headers['x-user-id'];

    if (!userId) {
      return errorResponse(res, 'User ID is required', 400);
    }

    // 1. Fetch user's Personal Vault documents
    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminders = [];

    // 2. Extract reminder-worthy date fields from each document
    for (const doc of documents) {
      let parsedFields = {};
      if (doc.fields) {
        try {
          parsedFields = typeof doc.fields === 'string' ? JSON.parse(doc.fields) : doc.fields;
        } catch (e) {
          parsedFields = {};
        }
      }

      const candidateDates = [];

      // A. Check explicit column
      if (doc.expiryDate && typeof doc.expiryDate === 'string' && doc.expiryDate.trim()) {
        candidateDates.push({ key: 'expiryDate', value: doc.expiryDate.trim(), type: 'Expiry' });
      }

      // B. Check dynamic fields
      for (const [k, v] of Object.entries(parsedFields)) {
        if (!v || typeof v !== 'string' || !v.trim()) continue;
        const lk = k.toLowerCase().replace(/[_\s-]/g, '');

        if (IGNORED_DATE_KEYS.some(ig => lk.includes(ig))) {
          continue;
        }

        let type = null;
        if (lk.includes('renewal')) type = 'Renewal';
        else if (lk.includes('due')) type = 'Due Date';
        else if (lk.includes('warranty')) type = 'Warranty Expiry';
        else if (lk.includes('validuntil') || lk.includes('validupto') || lk.includes('validity')) type = 'Validity';
        else if (lk.includes('expiry') || lk.includes('expire')) type = 'Expiry';

        if (type) {
          candidateDates.push({ key: k, value: v.trim(), type });
        }
      }

      // Deduplicate dates for this document
      const seenDates = new Set();

      for (const cd of candidateDates) {
        const parsedDate = parseDocumentDate(cd.value);
        if (!parsedDate) continue;

        const dateKey = `${cd.type}_${parsedDate.getFullYear()}-${parsedDate.getMonth()}-${parsedDate.getDate()}`;
        if (seenDates.has(dateKey)) continue;
        seenDates.add(dateKey);

        const daysRemaining = calculateDaysRemaining(parsedDate, today);
        let status;
        if (daysRemaining < 0) status = 'EXPIRED';
        else if (daysRemaining <= 30) status = 'EXPIRING_SOON';
        else status = 'VALID';

        reminders.push({
          id: `rem_${doc.id}_${cd.type.toLowerCase().replace(/\s+/g, '_')}`,
          documentId: doc.id,
          documentName: doc.documentName,
          documentType: doc.documentType,
          documentNumber: doc.documentNumber,
          reminderType: cd.type,
          targetDate: formatDisplayDate(parsedDate),
          targetDateIso: parsedDate.toISOString(),
          expiryDate: cd.value,
          daysRemaining,
          status,
          notificationSchedule: [30, 14, 7, 3, 1, 0],
        });
      }
    }

    // 3. Merge any manual reminders from prisma.reminder
    try {
      const manualReminders = await prisma.reminder.findMany({
        where: { userId },
        orderBy: { reminderDate: 'asc' },
      });

      for (const mr of manualReminders) {
        const parsedDate = new Date(mr.reminderDate);
        if (isNaN(parsedDate.getTime())) continue;

        const daysRemaining = calculateDaysRemaining(parsedDate, today);
        let status;
        if (daysRemaining < 0) status = 'EXPIRED';
        else if (daysRemaining <= 30) status = 'EXPIRING_SOON';
        else status = 'VALID';

        reminders.push({
          id: mr.id,
          documentId: 'manual',
          documentName: mr.title,
          documentType: 'Other',
          reminderType: 'Manual',
          targetDate: formatDisplayDate(parsedDate),
          targetDateIso: parsedDate.toISOString(),
          expiryDate: parsedDate.toISOString().slice(0, 10),
          daysRemaining,
          status,
          notificationSchedule: [30, 14, 7, 3, 1, 0],
        });
      }
    } catch (mErr) {
      console.warn('[DOC_REMINDERS] Manual reminders merge warning:', mErr?.message);
    }

    // 4. Sort: active / upcoming first (0 to N days), then expired
    reminders.sort((a, b) => {
      if (a.daysRemaining >= 0 && b.daysRemaining >= 0) return a.daysRemaining - b.daysRemaining;
      if (a.daysRemaining >= 0 && b.daysRemaining < 0) return -1;
      if (a.daysRemaining < 0 && b.daysRemaining >= 0) return 1;
      return b.daysRemaining - a.daysRemaining;
    });

    console.log(`[DOC_REMINDERS] Returning ${reminders.length} reminders for user "${userId}"`);
    return successResponse(res, reminders, 'Expiry reminders retrieved successfully');
  } catch (error) {
    console.error('[DOC_REMINDERS] Error:', error);
    return errorResponse(res, 'Failed to fetch reminders: ' + error.message, 500);
  }
};

/**
 * Get Document Image (Authenticated & Ownership Verified)
 * GET /api/documents/:id/image
 */
const getDocumentImage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.headers['x-user-id'];

    console.log(`[Vault] Loading document image: id=${id}`);

    if (!id || !userId) {
      return errorResponse(res, 'Document ID and user ID are required', 400);
    }

    const document = await prisma.document.findFirst({
      where: { id, userId },
    });

    const targetPath = document?.croppedImagePath || document?.imagePath;

    if (!document || !targetPath) {
      return errorResponse(res, 'Document or image not found', 404);
    }

    const cleanPath = targetPath.startsWith('/') ? targetPath.slice(1) : targetPath;
    const fullPath = path.join(__dirname, '../../', cleanPath);

    if (!fs.existsSync(fullPath)) {
      return errorResponse(res, 'Image file missing from disk', 404);
    }

    return res.sendFile(fullPath);
  } catch (error) {
    console.error('[DOC_IMAGE] Error:', error);
    return errorResponse(res, 'Failed to fetch document image: ' + error.message, 500);
  }
};

/**
 * Correct Document Field (Authenticated & Ownership Verified)
 * POST /api/documents/:id/correction
 */
const correctDocumentField = async (req, res) => {
  try {
    const { id } = req.params;
    const { field, value } = req.body;
    const userId = req.user?.userId || req.user?.id || req.headers['x-user-id'];

    if (!id || !userId) {
      return errorResponse(res, 'Document ID and User ID are required', 400);
    }

    if (!field || typeof field !== 'string') {
      return errorResponse(res, 'Field name is required', 400);
    }

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      return errorResponse(res, 'Document not found', 404);
    }

    // MANDATORY SECURITY: Verify authenticatedUserId === document.userId
    if (document.userId !== userId) {
      console.warn(`[SECURITY] Unauthorized correction attempt by user "${userId}" on document "${id}" owned by "${document.userId}"`);
      return errorResponse(res, 'Access denied: You do not own this document', 403);
    }

    // Whitelist allowed fields to prevent arbitrary column mutation
    const allowedFields = [
      'documentNumber', 'name', 'fatherName', 'gender', 'address',
      'dateOfBirth', 'issueDate', 'expiryDate', 'documentType', 'documentName'
    ];

    if (!allowedFields.includes(field)) {
      return errorResponse(res, `Field "${field}" is not allowed for correction`, 400);
    }

    // Parse existing JSON fields string
    let parsedFields = {};
    if (document.fields) {
      try {
        parsedFields = typeof document.fields === 'string' ? JSON.parse(document.fields) : document.fields;
      } catch (pErr) {
        parsedFields = {};
      }
    }

    // Update field value
    const updatedValue = value !== undefined && value !== null ? String(value).trim() : '';
    parsedFields[field] = updatedValue;

    const updateData = {
      fields: JSON.stringify(parsedFields),
    };

    // Also update explicit column if field maps to a table column
    if (field in document) {
      updateData[field] = updatedValue;
    }

    const updatedDocument = await prisma.document.update({
      where: { id },
      data: updateData,
    });

    console.log(`[Document] Field "${field}" updated to "${updatedValue}" for doc id=${id}`);
    return successResponse(res, updatedDocument, `Field "${field}" updated successfully`, 200);

  } catch (error) {
    console.error('[DOC_CORRECTION] Error:', error);
    return errorResponse(res, 'Failed to update document field: ' + error.message, 500);
  }
};

module.exports = {
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getExpiryReminders,
  getDocumentImage,
  correctDocumentField,
};
