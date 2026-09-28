/**
 * documentService.ts — PostgreSQL Database Service (DDA-WebPreview)
 *
 * Communicates with Node.js Express + Prisma + PostgreSQL backend (DDA-Backend)
 * to store and retrieve document metadata & cropped image attachments.
 * Completely eliminates obsolete Firebase Firestore and Storage dependencies.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { DocumentMetadata, ExpiryReminder } from '../../types/document';

const getBackendBaseUrl = (): string => {
  if (Platform.OS === 'web') {
    return 'http://localhost:5000';
  }
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest?.debuggerHost;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:5000`;
    }
  }
  return Platform.OS === 'android' ? 'http://10.1.1.88:5000' : 'http://localhost:5000';
};

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

    const uploadUrl = `${API_BASE_URL}/api/documents`;
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

    const docs = await this.getDocuments(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reminders: ExpiryReminder[] = [];

    docs.forEach(doc => {
      if (doc.expiryDate) {
        const expDate = new Date(doc.expiryDate);
        if (!isNaN(expDate.getTime())) {
          expDate.setHours(0, 0, 0, 0);
          const diffTime = expDate.getTime() - today.getTime();
          const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          let status: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' = 'VALID';
          if (daysRemaining < 0) status = 'EXPIRED';
          else if (daysRemaining <= 30) status = 'EXPIRING_SOON';
          reminders.push({
            id: `rem_${doc.id}`,
            documentId: doc.id,
            documentName: doc.documentName,
            documentType: doc.documentType,
            documentNumber: doc.documentNumber,
            expiryDate: doc.expiryDate,
            daysRemaining,
            status,
          });
        }
      }
    });

    return reminders.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }
}

export const documentService = new DocumentService();
