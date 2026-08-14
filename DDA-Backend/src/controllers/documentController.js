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
 * Get Expiry Reminders (documents with upcoming or expired dates)
 * GET /api/documents/reminders/expiry
 */
const getExpiryReminders = async (req, res) => {
  try {
    const userId = req.user.userId;

    const documents = await prisma.document.findMany({
      where: { userId, expiryDate: { not: null } },
      orderBy: { expiryDate: 'asc' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminders = documents
      .map((doc) => {
        const expDate = new Date(doc.expiryDate);
        if (isNaN(expDate.getTime())) return null;
        expDate.setHours(0, 0, 0, 0);

        const diffMs = expDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        let status;
        if (daysRemaining < 0) status = 'EXPIRED';
        else if (daysRemaining <= 30) status = 'EXPIRING_SOON';
        else status = 'VALID';

        return {
          id: `rem_${doc.id}`,
          documentId: doc.id,
          documentName: doc.documentName,
          documentType: doc.documentType,
          documentNumber: doc.documentNumber,
          expiryDate: doc.expiryDate,
          daysRemaining,
          status,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

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

module.exports = {
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getExpiryReminders,
  getDocumentImage,
};
