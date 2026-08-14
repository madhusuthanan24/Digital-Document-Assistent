import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { firestore, storage } from '../../config/firebase';
import { DocumentMetadata, ExpiryReminder } from '../../types/document';

// ---------------------------------------------------------------------------
// Utility — Firestore rejects undefined values; strip them before every write
// ---------------------------------------------------------------------------
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

class DocumentService {
  private getCollectionRef(userId: string) {
    if (!userId) {
      throw new Error('User ID is required to access documents.');
    }
    return collection(firestore, 'users', userId, 'documents');
  }

  private async uploadImageToStorage(
    userId: string,
    fileUri: string,
    fileName?: string
  ): Promise<string | undefined> {
    if (!fileUri) return undefined;
    try {
      // Fetch file blob from local URI
      const response = await fetch(fileUri);
      const blob = await response.blob();

      const name = fileName || `doc_${Date.now()}.jpg`;
      const storageRef = ref(storage, `users/${userId}/documents/${Date.now()}_${name}`);

      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);
      return downloadUrl;
    } catch (err) {
      // Firebase Storage fallback: return localFileUri if remote upload fails
      return fileUri;
    }
  }

  public async addDocument(
    userId: string,
    docData: Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const colRef = this.getCollectionRef(userId);
    const now = new Date().toISOString();

    let storageUrl = docData.fileUrl;
    if (!storageUrl && docData.localFileUri) {
      storageUrl = await this.uploadImageToStorage(userId, docData.localFileUri, docData.fileName);
    }

    const payload = stripUndefined({
      ...docData,
      fileUrl: storageUrl || docData.localFileUri || undefined,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    const docRef = await addDoc(colRef, payload);
    return docRef.id;
  }

  public async getDocuments(userId: string): Promise<DocumentMetadata[]> {
    if (!userId) return [];
    const colRef = this.getCollectionRef(userId);
    const q = query(colRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        userId: data.userId || userId,
        documentType: data.documentType || data.category || 'Other',
        documentName: data.documentName || data.title || 'Untitled Document',
        documentNumber: data.documentNumber || '',
        issueDate: data.issueDate || '',
        expiryDate: data.expiryDate || '',
        localFileUri: data.localFileUri || data.fileUrl || '',
        fileUrl: data.fileUrl || data.localFileUri || '',
        fileName: data.fileName || '',
        mimeType: data.mimeType || '',
        fields: data.fields || undefined,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      } as DocumentMetadata;
    });
  }

  public async getDocumentById(
    userId: string,
    documentId: string
  ): Promise<DocumentMetadata | null> {
    if (!userId || !documentId) return null;
    const docRef = doc(firestore, 'users', userId, 'documents', documentId);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (!data) return null;
    return {
      id: snapshot.id,
      userId: data.userId || userId,
      documentType: data.documentType || data.category || 'Other',
      documentName: data.documentName || data.title || 'Untitled Document',
      documentNumber: data.documentNumber || '',
      issueDate: data.issueDate || '',
      expiryDate: data.expiryDate || '',
      localFileUri: data.localFileUri || data.fileUrl || '',
      fileUrl: data.fileUrl || data.localFileUri || '',
      fileName: data.fileName || '',
      mimeType: data.mimeType || '',
      fields: data.fields || undefined,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    } as DocumentMetadata;
  }

  public async updateDocument(
    userId: string,
    documentId: string,
    docData: Partial<Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt'>>
  ): Promise<void> {
    const docRef = doc(firestore, 'users', userId, 'documents', documentId);
    const now = new Date().toISOString();
    const payload = stripUndefined({
      ...docData,
      updatedAt: now,
    });
    await updateDoc(docRef, payload);
  }

  public async deleteDocument(
    userId: string,
    documentId: string
  ): Promise<void> {
    const docRef = doc(firestore, 'users', userId, 'documents', documentId);
    await deleteDoc(docRef);
  }

  public async getReminders(userId: string): Promise<ExpiryReminder[]> {
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
          if (daysRemaining < 0) {
            status = 'EXPIRED';
          } else if (daysRemaining <= 30) {
            status = 'EXPIRING_SOON';
          }

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
