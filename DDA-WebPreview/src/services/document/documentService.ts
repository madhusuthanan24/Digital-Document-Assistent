/**
 * documentService.ts — PostgreSQL Database Service (DDA-WebPreview)
 *
 * Communicates with Node.js Express + Prisma + PostgreSQL backend (DDA-Backend)
 * to store and retrieve document metadata & cropped image attachments.
 * Completely eliminates obsolete Firebase Firestore and Storage dependencies.
 */

import { Platform } from 'react-native';
import { DocumentMetadata, ExpiryReminder } from '../../types/document';
import { getBackendBaseUrl, verifyBackendHealth } from '../network/networkConfig';

export { getBackendBaseUrl, verifyBackendHealth };

const API_BASE_URL = getBackendBaseUrl();

class DocumentService {
  /**
   * Helper to resolve full image URL for a document.
   * Prioritizes the canonical backend endpoint / croppedImagePath.
   */
  public getDocumentImageUrl(documentId?: string, imagePath?: string, localFileUri?: string, croppedImagePath?: string): string {
    if (documentId) {
      return `${API_BASE_URL}/api/documents/${documentId}/image`;
    }
    const path = croppedImagePath || imagePath;
    if (path && !path.startsWith('file://') && !path.startsWith('content://')) {
      return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
    }
    if (localFileUri && (localFileUri.startsWith('file://') || localFileUri.startsWith('http://') || localFileUri.startsWith('https://'))) {
      return localFileUri;
    }
    if (path) {
      return path;
    }
    return '';
  }

  /**
   * Add Document to PostgreSQL database via DDA-Backend REST API.
   * Uploads the cropped image file along with document metadata.
   */
  /**
   * Helper to execute multipart/form-data upload using XMLHttpRequest.
   * This natively supports React Native's { uri, name, type } file parts via RCTNetworking
   * without triggering expo/fetch's "Unsupported FormDataPart implementation" error.
   */
  private executeMultipartUpload(
    url: string,
    formData: FormData,
    userId: string
  ): Promise<{ ok: boolean; status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('x-user-id', userId);
      xhr.timeout = 60000;

      xhr.onload = () => {
        let resData: any = null;
        try {
          resData = JSON.parse(xhr.responseText);
        } catch {
          resData = { success: xhr.status >= 200 && xhr.status < 300, message: xhr.responseText };
        }
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          data: resData,
        });
      };

      xhr.onerror = () => {
        reject(new Error(`Network request failed (status: ${xhr.status || 'unknown'})`));
      };

      xhr.ontimeout = () => {
        reject(new Error('Document upload request timed out after 60 seconds'));
      };

      xhr.send(formData);
    });
  }

  /**
   * Add Document to PostgreSQL database via DDA-Backend REST API.
   * Uploads the cropped image file along with document metadata.
   */
  public async addDocument(
    userId: string,
    docData: Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    console.log(`[POSTGRES_DOC] Saving document: type="${docData.documentType}", name="${docData.documentName}" for user: ${userId}`);

    const fileUri = docData.croppedImagePath || docData.localFileUri || docData.imagePath;
    const formData = new FormData();

    formData.append('userId', userId);
    formData.append('documentType', docData.documentType);
    formData.append('documentName', docData.documentName);

    if (docData.documentNumber) formData.append('documentNumber', docData.documentNumber);
    if (docData.name) formData.append('name', docData.name);
    if (docData.fatherName) formData.append('fatherName', docData.fatherName);
    if (docData.gender) formData.append('gender', docData.gender);
    if (docData.address) formData.append('address', docData.address);
    if (docData.dateOfBirth) formData.append('dateOfBirth', docData.dateOfBirth);
    if (docData.issueDate) formData.append('issueDate', docData.issueDate);
    if (docData.expiryDate) formData.append('expiryDate', docData.expiryDate);
    if (docData.fields) formData.append('fields', JSON.stringify(docData.fields));

    if (fileUri) {
      const filename = docData.fileName || fileUri.split('/').pop() || `cropped_${Date.now()}.jpg`;
      const mime = docData.mimeType || 'image/jpeg';

      console.log(`[POSTGRES_DOC_DIAG] upload URI: ${fileUri}`);
      console.log(`[POSTGRES_DOC_DIAG] upload MIME: ${mime}`);
      console.log(`[POSTGRES_DOC_DIAG] upload filename: ${filename}`);
      console.log(`[POSTGRES_DOC_DIAG] FormData field: file`);

      if (Platform.OS === 'web' && typeof fetch === 'function') {
        console.log(`[POSTGRES_DOC_DIAG] FormData value type: Blob (Web)`);
        try {
          const resp = await fetch(fileUri);
          const blob = await resp.blob();
          formData.append('file', blob, filename);
        } catch {
          formData.append('file', {
            uri: fileUri,
            name: filename,
            type: mime,
          } as any);
        }
      } else {
        console.log(`[POSTGRES_DOC_DIAG] FormData value type: React Native File Object ({ uri, name, type })`);
        formData.append('file', {
          uri: fileUri,
          name: filename,
          type: mime,
        } as any);
      }
    }

    const uploadUrl = `${getBackendBaseUrl()}/api/documents`;
    console.log(`[DOCUMENT][NETWORK] REQUEST_URL=${uploadUrl} METHOD=POST`);
    console.log(`[NETWORK][CONFIG] target_url=${uploadUrl}`);
    console.log(`[POSTGRES_DOC] Submitting multipart upload to: ${uploadUrl}`);

    const res = await this.executeMultipartUpload(uploadUrl, formData, userId);

    if (res.ok && res.data?.success) {
      const createdDoc = res.data.data;
      console.log(`[POSTGRES_DOC] PostgreSQL document created: id=${createdDoc.id}`);
      return createdDoc.id;
    } else {
      const errMsg = res.data?.message || `Upload failed with HTTP status ${res.status}`;
      console.error(`[POSTGRES_DOC] PostgreSQL upload failed: ${errMsg}`);
      throw new Error(`Failed to save document to PostgreSQL database: ${errMsg}`);
    }
  }

  /**
   * Get all Documents for a specific user from PostgreSQL database.
   */
  public async getDocuments(userId: string): Promise<DocumentMetadata[]> {
    if (!userId) return [];
    console.log(`[POSTGRES_DOC] Fetching documents for user: ${userId}`);
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'GET',
        headers: { 'x-user-id': userId },
      });
      const resData = await response.json();
      if (response.ok && resData.success && Array.isArray(resData.data)) {
        return resData.data.map((doc: any) => {
          let parsedFields: Record<string, string> | undefined = undefined;
          if (typeof doc.fields === 'string') {
            try { parsedFields = JSON.parse(doc.fields); } catch (e) {}
          } else if (typeof doc.fields === 'object' && doc.fields !== null) {
            parsedFields = doc.fields;
          }

          const rawPath = doc.croppedImagePath || doc.imagePath || '';
          const fullImageUrl = rawPath
            ? (rawPath.startsWith('http://') || rawPath.startsWith('https://') || rawPath.startsWith('file://') || rawPath.startsWith('content://')
                ? rawPath
                : `${API_BASE_URL}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`)
            : '';

          return {
            id: doc.id,
            userId: doc.userId,
            documentType: doc.documentType,
            documentName: doc.documentName,
            documentNumber: doc.documentNumber || '',
            name: doc.name,
            fatherName: doc.fatherName,
            gender: doc.gender,
            address: doc.address,
            dateOfBirth: doc.dateOfBirth,
            issueDate: doc.issueDate || '',
            expiryDate: doc.expiryDate || '',
            fields: parsedFields,
            imagePath: fullImageUrl || doc.imagePath || '',
            croppedImagePath: fullImageUrl || doc.croppedImagePath || '',
            originalImagePath: doc.originalImagePath || '',
            localFileUri: fullImageUrl,
            mimeType: doc.mimeType || 'image/jpeg',
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt || doc.createdAt,
          };
        });
      }
    } catch (err: any) {
      console.warn(`[POSTGRES_DOC] Fetch documents fallback: ${err?.message}`);
    }
    return [];
  }

  /**
   * Get a single document by ID for a user.
   */
  public async getDocumentById(
    userId: string,
    documentId: string
  ): Promise<DocumentMetadata | null> {
    if (!userId || !documentId) return null;
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}`, {
        method: 'GET',
        headers: { 'x-user-id': userId },
      });
      const resData = await response.json();
      if (response.ok && resData.success && resData.data) {
        const doc = resData.data;
        let parsedFields: Record<string, string> | undefined = undefined;
        if (typeof doc.fields === 'string') {
          try { parsedFields = JSON.parse(doc.fields); } catch (e) {}
        } else if (typeof doc.fields === 'object' && doc.fields !== null) {
          parsedFields = doc.fields;
        }

        const rawPath = doc.croppedImagePath || doc.imagePath || '';
        const fullImageUrl = rawPath
          ? (rawPath.startsWith('http://') || rawPath.startsWith('https://') || rawPath.startsWith('file://') || rawPath.startsWith('content://')
              ? rawPath
              : `${API_BASE_URL}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`)
          : '';

        return {
          id: doc.id,
          userId: doc.userId,
          documentType: doc.documentType,
          documentName: doc.documentName,
          documentNumber: doc.documentNumber || '',
          name: doc.name,
          fatherName: doc.fatherName,
          gender: doc.gender,
          address: doc.address,
          dateOfBirth: doc.dateOfBirth,
          issueDate: doc.issueDate || '',
          expiryDate: doc.expiryDate || '',
          fields: parsedFields,
          imagePath: fullImageUrl || doc.imagePath || '',
          croppedImagePath: fullImageUrl || doc.croppedImagePath || '',
          originalImagePath: doc.originalImagePath || '',
          localFileUri: fullImageUrl,
          mimeType: doc.mimeType || 'image/jpeg',
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt || doc.createdAt,
        };
      }
    } catch (err: any) {
      console.warn(`[POSTGRES_DOC] Get document by ID fallback: ${err?.message}`);
    }
    return null;
  }

  public async updateDocument(
    userId: string,
    documentId: string,
    docData: Partial<Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt'>>
  ): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify(docData),
      });
      console.log(`[DOCUMENT_EDIT] Update API response: ${response.status}`);
      let resData: any = null;
      try {
        resData = await response.json();
      } catch {
        resData = {};
      }
      if (!response.ok || (resData && resData.success === false)) {
        throw new Error(resData?.message || `Failed to update document (status: ${response.status})`);
      }
      console.log(`[DOCUMENT_EDIT] Updated successfully: ${documentId}`);
    } catch (err: any) {
      console.warn(`[POSTGRES_DOC] Update document error: ${err?.message}`);
      throw err;
    }
  }

  public async deleteDocument(
    userId: string,
    documentId: string
  ): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId },
      });
    } catch (err: any) {
      console.warn(`[POSTGRES_DOC] Delete document fallback: ${err?.message}`);
    }
  }

  public async getReminders(userId: string): Promise<ExpiryReminder[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/reminders/expiry`, {
        method: 'GET',
        headers: { 'x-user-id': userId },
      });
      const resData = await response.json();
      if (response.ok && resData.success && Array.isArray(resData.data)) {
        return resData.data;
      }
    } catch (err: any) {
      console.warn(`[POSTGRES_DOC] Get reminders fallback: ${err?.message}`);
    }

    // Fallback: Compute reminders directly from stored vault documents
    const docs = await this.getDocuments(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reminders: ExpiryReminder[] = [];

    const IGNORED_KEYS = [
      'dateofbirth', 'dob', 'birthdate', 'birth',
      'issuedate', 'issue_date', 'issuedon', 'issued',
      'registrationdate', 'registration_date',
      'documentdate', 'testdate', 'purchasedate', 'yearofpassing'
    ];

    docs.forEach(doc => {
      const candidateDates: { key: string; value: string; type: 'Expiry' | 'Renewal' | 'Due Date' | 'Warranty Expiry' | 'Validity' }[] = [];

      // 1. Column expiryDate
      if (doc.expiryDate && typeof doc.expiryDate === 'string' && doc.expiryDate.trim()) {
        candidateDates.push({ key: 'expiryDate', value: doc.expiryDate.trim(), type: 'Expiry' });
      }

      // 2. Dynamic fields
      if (doc.fields && typeof doc.fields === 'object') {
        for (const [k, v] of Object.entries(doc.fields)) {
          if (!v || typeof v !== 'string' || !v.trim()) continue;
          const lk = k.toLowerCase().replace(/[_\s-]/g, '');
          if (IGNORED_KEYS.some(ig => lk.includes(ig))) continue;

          let type: 'Expiry' | 'Renewal' | 'Due Date' | 'Warranty Expiry' | 'Validity' | null = null;
          if (lk.includes('renewal')) type = 'Renewal';
          else if (lk.includes('due')) type = 'Due Date';
          else if (lk.includes('warranty')) type = 'Warranty Expiry';
          else if (lk.includes('validuntil') || lk.includes('validupto') || lk.includes('validity')) type = 'Validity';
          else if (lk.includes('expiry') || lk.includes('expire')) type = 'Expiry';

          if (type) {
            candidateDates.push({ key: k, value: v.trim(), type });
          }
        }
      }

      const seen = new Set<string>();

      for (const cd of candidateDates) {
        const parsedDate = parseDocumentDate(cd.value);
        if (!parsedDate) continue;

        const dateKey = `${cd.type}_${parsedDate.getFullYear()}-${parsedDate.getMonth()}-${parsedDate.getDate()}`;
        if (seen.has(dateKey)) continue;
        seen.add(dateKey);

        const targetMidnight = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
        const diffMs = targetMidnight.getTime() - today.getTime();
        const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));

        let status: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' = 'VALID';
        if (daysRemaining < 0) status = 'EXPIRED';
        else if (daysRemaining <= 30) status = 'EXPIRING_SOON';

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
        });
      }
    });

    return reminders.sort((a, b) => {
      if (a.daysRemaining >= 0 && b.daysRemaining >= 0) return a.daysRemaining - b.daysRemaining;
      if (a.daysRemaining >= 0 && b.daysRemaining < 0) return -1;
      if (a.daysRemaining < 0 && b.daysRemaining >= 0) return 1;
      return b.daysRemaining - a.daysRemaining;
    });
  }
}

function parseDocumentDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
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

  // YYYY-MM-DD or YYYY/MM/DD
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

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

function formatDisplayDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

export const documentService = new DocumentService();
