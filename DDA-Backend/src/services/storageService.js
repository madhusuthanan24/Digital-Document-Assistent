/**
 * storageService.js — Permanent Cloud & Local Document Storage Provider
 *
 * Supports Cloudinary persistent object storage with seamless fallback to local disk storage.
 * Ensures uploaded document images survive server redeployments, restarts, and container scaling.
 */

const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// Check if Cloudinary is configured
const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (isCloudinaryConfigured) {
  if (!process.env.CLOUDINARY_URL && process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
  console.log('[STORAGE] Persistent Cloud Storage: Cloudinary active');
} else {
  console.log('[STORAGE] Persistent Cloud Storage not configured; falling back to local disk (/uploads)');
}

/**
 * Uploads a file buffer or path to storage.
 * Returns { url, publicId, storageType }
 */
async function uploadDocumentImage(file, options = {}) {
  const folder = options.folder || 'dda_documents';
  const customId = options.id || `doc_${Date.now()}_${Math.round(Math.random() * 1e6)}`;

  if (isCloudinaryConfigured) {
    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder,
        public_id: customId,
        resource_type: 'auto',
        overwrite: true,
      };

      if (file.buffer) {
        const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
          if (error) {
            console.error('[STORAGE][CLOUDINARY] Upload error:', error.message);
            return reject(error);
          }
          console.log(`[STORAGE][CLOUDINARY] Upload success: ${result.secure_url}`);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            storageType: 'cloudinary',
          });
        });
        uploadStream.end(file.buffer);
      } else if (file.path) {
        cloudinary.uploader.upload(file.path, uploadOptions, (error, result) => {
          if (error) {
            console.error('[STORAGE][CLOUDINARY] File upload error:', error.message);
            return reject(error);
          }
          // Clean up local temp file after cloud upload
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch {}
          console.log(`[STORAGE][CLOUDINARY] Upload success: ${result.secure_url}`);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            storageType: 'cloudinary',
          });
        });
      } else {
        reject(new Error('Invalid file object provided for upload'));
      }
    });
  }

  // Fallback to local disk
  if (file.filename) {
    return {
      url: `/uploads/${file.filename}`,
      publicId: file.filename,
      storageType: 'local',
    };
  }

  if (file.buffer) {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `file-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
    const fullPath = path.join(uploadDir, filename);
    fs.writeFileSync(fullPath, file.buffer);
    return {
      url: `/uploads/${filename}`,
      publicId: filename,
      storageType: 'local',
    };
  }

  throw new Error('Could not persist file');
}

/**
 * Deletes a file from storage.
 */
async function deleteDocumentImage(imagePath) {
  if (!imagePath) return;

  try {
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      if (isCloudinaryConfigured && imagePath.includes('cloudinary.com')) {
        // Extract public_id from URL
        const matches = imagePath.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-zA-Z0-9]+$/);
        if (matches && matches[1]) {
          await cloudinary.uploader.destroy(matches[1]);
          console.log(`[STORAGE][CLOUDINARY] Deleted remote asset: ${matches[1]}`);
        }
      }
      return;
    }

    // Local disk deletion
    const cleanPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    const fullPath = path.join(__dirname, '../../', cleanPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`[STORAGE][LOCAL] Deleted file: ${fullPath}`);
    }
  } catch (err) {
    console.warn(`[STORAGE] Error deleting file (${imagePath}):`, err.message);
  }
}

module.exports = {
  isCloudinaryConfigured,
  uploadDocumentImage,
  deleteDocumentImage,
};
