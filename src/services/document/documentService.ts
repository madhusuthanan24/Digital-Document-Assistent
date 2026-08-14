import firestore from '@react-native-firebase/firestore';
import { DocumentMetadata, ExpiryReminder } from '../../types/document';

class DocumentService {
  private getCollectionRef(userId: string) {
    if (!userId) {
      throw new Error('User ID is required to access documents.');
    }
    return firestore().collection('users').doc(userId).collection('documents');
  }

  public async addDocument(
    userId: string,
    docData: Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const colRef = this.getCollectionRef(userId);
    const now = new Date().toISOString();
    const docRef = await colRef.add({
      ...docData,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    return docRef.id;
  }

  public async getDocuments(userId: string): Promise<DocumentMetadata[]> {
    if (!userId) return [];
    const colRef = this.getCollectionRef(userId);
    const snapshot = await colRef.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId || userId,
        documentType: data.documentType || data.category || 'Other',
        documentName: data.documentName || data.title || 'Untitled Document',
        documentNumber: data.documentNumber || '',
        issueDate: data.issueDate || '',
        expiryDate: data.expiryDate || '',
        localFileUri: data.localFileUri || data.fileUrl || '',
        fileName: data.fileName || '',
        mimeType: data.mimeType || '',
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
    const docRef = this.getCollectionRef(userId).doc(documentId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) return null;
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
      fileName: data.fileName || '',
      mimeType: data.mimeType || '',
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    } as DocumentMetadata;
  }

  public async updateDocument(
    userId: string,
    documentId: string,
    docData: Partial<Omit<DocumentMetadata, 'id' | 'userId' | 'createdAt'>>
  ): Promise<void> {
    const docRef = this.getCollectionRef(userId).doc(documentId);
    const now = new Date().toISOString();
    await docRef.update({
      ...docData,
      updatedAt: now,
    });
  }

  public async deleteDocument(
    userId: string,
    documentId: string
  ): Promise<void> {
    const docRef = this.getCollectionRef(userId).doc(documentId);
    await docRef.delete();
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
