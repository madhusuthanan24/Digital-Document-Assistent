const express = require('express');
const router = express.Router();
const {
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getExpiryReminders,
  getDocumentImage,
} = require('../controllers/documentController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(authMiddleware);

router.get('/reminders/expiry', getExpiryReminders);
router.get('/:id/image', getDocumentImage);
router.post('/', upload.single('file'), createDocument);
router.get('/', getDocuments);
router.get('/:id', getDocumentById);
router.put('/:id', upload.single('file'), updateDocument);
router.delete('/:id', deleteDocument);

module.exports = router;
