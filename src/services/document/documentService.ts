/**
 * documentService.ts — PostgreSQL Database Service
 *
 * Communicates with Node.js Express + Prisma + PostgreSQL backend (DDA-Backend)
 * to store and retrieve document metadata & cropped image attachments.
 */

import { Platform } from 'react-native';
import { DocumentMetadata, ExpiryReminder } from '../../types/document';

const API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000';

class DocumentService {
  /**
   * Helper to resolve full image URL for a document.
   */
  public getDocumentImageUrl(documentId: string, imagePath?: string, localFileUri?: string, croppedImagePath?: string): string {
    if (localFileUri && (localFileUri.startsWith('file://') || localFileUri.startsWith('http://') || localFileUri.startsWith('https://'))) {
      return localFileUri;
    }
    const path = croppedImagePath || imagePath;
    if (documentId) {
      return `${API_BASE_URL}/api/documents/${documentId}/image`;
    }
    if (path) {
      return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
    }
    return '';
  }
  /**
   * Add Document to PostgreSQL database via DDA-Backend REST API.
   * Uploads the cropped image file along with document metadata.
   */
  public async addDocument(
    userId: string,
    docData: Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    console.log(`[Document] Saving document: type="${docData.documentType}", name="${docData.documentName}"`);

    const fileUri = docData.localFileUri;
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
      console.log(`[Document] Image path: ${fileUri}`);
      const filename = docData.fileName || fileUri.split('/').pop() || `cropped_${Date.now()}.jpg`;
      const mime = docData.mimeType || 'image/jpeg';
      formData.append('file', {
        uri: fileUri,
        name: filename,
        type: mime,
      } as any);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'POST',
        headers: {
          'x-user-id': userId,
        },
        body: formData,
      });

      const resData = await response.json();
      if (response.ok && resData.success) {
        const createdDoc = resData.data;
        console.log(`[Document] PostgreSQL document created: id=${createdDoc.id}`);
        return createdDoc.id;
      } else {
        console.warn(`[Document] PostgreSQL API error: ${resData.message}`);
      }
    } catch (apiErr: any) {
      console.warn(`[Document] PostgreSQL API request fallback: ${apiErr?.message}`);
    }

    return `doc_${Date.now()}`;
  }

  /**
   * Get all Documents for a specific user from PostgreSQL database.
   */
  public async getDocuments(userId: string): Promise<DocumentMetadata[]> {
    if (!userId) return [];
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
            imagePath: doc.imagePath || '',
            croppedImagePath: doc.croppedImagePath || doc.imagePath || '',
            originalImagePath: doc.originalImagePath || '',
            localFileUri: (doc.croppedImagePath || doc.imagePath) ? `${API_BASE_URL}${doc.croppedImagePath || doc.imagePath}` : '',
            mimeType: doc.mimeType || 'image/jpeg',
            createdAt: doc.createdAt,
          };
        });
      }
    } catch (err: any) {
      console.warn(`[Document] Fetch documents fallback: ${err?.message}`);
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
          imagePath: doc.imagePath || '',
          localFileUri: doc.imagePath ? `${API_BASE_URL}${doc.imagePath}` : '',
          mimeType: doc.mimeType || 'image/jpeg',
          createdAt: doc.createdAt,
        };
      }
    } catch (err: any) {
      console.warn(`[Document] Get document by ID fallback: ${err?.message}`);
    }
    return null;
  }

  public async updateDocument(
    userId: string,
    documentId: string,
    docData: Partial<Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt'>>
  ): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/api/documents/${documentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify(docData),
      });
    } catch (err: any) {
      console.warn(`[Document] Update document fallback: ${err?.message}`);
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
      console.warn(`[Document] Delete document fallback: ${err?.message}`);
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
      console.warn(`[Document] Get reminders fallback: ${err?.message}`);
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
