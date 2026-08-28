/**
 * pdfService.ts
 *
 * Generates, downloads, and shares exportable PDF document files containing BOTH
 * document metadata (dynamically rendered from the stored PostgreSQL/Prisma record)
 * and the actual stored cropped document image.
 */

import { Share, Platform } from 'react-native';
import { DocumentMetadata } from '../../types/document';
import { documentService } from '../document/documentService';

// Helper to convert local file:// or HTTP image URI to Base64 Data URL for HTML embedding
async function getImageAsBase64(imageUri: string, headers?: Record<string, string>): Promise<string | null> {
  console.log(`[PDF Log 1] Converting image to Base64 Data URL: ${imageUri}`);
  try {
    if (imageUri.startsWith('file://')) {
      const RNFS = require('react-native-fs');
      const cleanPath = imageUri.replace('file://', '');
      const exists = await RNFS.exists(cleanPath);
      if (!exists) {
        console.warn(`[PDF Log 1.1] Image file does not exist at path: ${cleanPath}`);
        return null;
      }
      const b64 = await RNFS.readFile(cleanPath, 'base64');
      console.log('[PDF Log 1.2] Local image successfully converted to Base64');
      return `data:image/jpeg;base64,${b64}`;
    }

    const resp = await fetch(imageUri, { headers });
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        console.log('[PDF Log 1.3] Remote image successfully converted to Base64');
        resolve(dataUrl);
      };
      reader.onerror = (e) => {
        console.warn('[PDF Log 1.4] Remote image load error:', e);
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (err: any) {
    console.warn(`[PDF Log 1.5] Image loading exception: ${err?.message}`);
    return null;
  }
}

class PdfService {
  /**
   * Helper function to dynamically construct table rows from non-empty document record fields.
   */
  private buildDynamicRows(doc: DocumentMetadata): string {
    const rows: { label: string; value: string }[] = [];

    // Core identification fields
    rows.push({ label: 'Document Name', value: doc.documentName });
    rows.push({ label: 'Type', value: doc.documentType });

    if (doc.documentNumber && doc.documentNumber.trim()) {
      rows.push({ label: 'Document Number', value: doc.documentNumber.trim() });
    }
    if (doc.name && doc.name.trim()) {
      rows.push({ label: 'Holder Name', value: doc.name.trim() });
    }
    if (doc.fatherName && doc.fatherName.trim()) {
      rows.push({ label: 'Father / Relative Name', value: doc.fatherName.trim() });
    }
    if (doc.gender && doc.gender.trim()) {
      rows.push({ label: 'Gender', value: doc.gender.trim() });
    }
    if (doc.dateOfBirth && doc.dateOfBirth.trim()) {
      rows.push({ label: 'Date of Birth', value: doc.dateOfBirth.trim() });
    }
    if (doc.address && doc.address.trim()) {
      rows.push({ label: 'Address', value: doc.address.trim() });
    }
    if (doc.issueDate && doc.issueDate.trim()) {
      rows.push({ label: 'Issue Date', value: doc.issueDate.trim() });
    }
    if (doc.expiryDate && doc.expiryDate.trim()) {
      rows.push({ label: 'Expiry Date', value: doc.expiryDate.trim() });
    }

    // Dynamic OCR / AI-extracted key-value pairs
    if (doc.fields && typeof doc.fields === 'object') {
      Object.entries(doc.fields).forEach(([key, val]) => {
        if (val && typeof val === 'string' && val.trim()) {
          const formattedLabel = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();

          // Avoid duplicating already-added fields
          const exists = rows.some(r => r.label.toLowerCase() === formattedLabel.toLowerCase());
          if (!exists) {
            rows.push({ label: formattedLabel, value: val.trim() });
          }
        }
      });
    }

    return rows
      .map(r => `<tr><td class="label">${r.label}</td><td class="value">${r.value}</td></tr>`)
      .join('\n    ');
  }

  /**
   * Generate a PDF document incorporating AI-extracted document details and actual cropped image.
   */
  public async generateDocumentPdf(doc: DocumentMetadata): Promise<string> {
    console.log(`[PDF Log 2] Starting PDF generation for document: ${doc.documentName} (ID: ${doc.id})`);

    // Prioritize cropped image path over raw original image
    const imageUri = doc.croppedImagePath || doc.imagePath || doc.localFileUri;
    const imageUrl = imageUri ? documentService.getDocumentImageUrl(doc.id, doc.imagePath, doc.localFileUri, doc.croppedImagePath) : null;

    console.log(`[PDF Log 2.1] Resolved Cropped Image Target: ${imageUrl || 'None'}`);

    const base64Image = imageUrl
      ? await getImageAsBase64(imageUrl, doc.userId ? { 'x-user-id': doc.userId } : undefined)
      : null;

    const dynamicTableRows = this.buildDynamicRows(doc);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${doc.documentName}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #111827; background: #FFF; }
    .header { text-align: center; border-bottom: 2px solid #2563EB; padding-bottom: 12px; margin-bottom: 20px; }
    .title { font-size: 22px; font-weight: bold; color: #1E40AF; text-transform: uppercase; margin: 0; }
    .subtitle { font-size: 13px; color: #4B5563; margin-top: 4px; }
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .details-table td { padding: 9px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; }
    .label { font-weight: bold; color: #374151; width: 35%; text-transform: uppercase; font-size: 11px; }
    .value { font-weight: 600; color: #111827; }
    .image-container { text-align: center; margin-top: 20px; padding: 12px; border: 1px solid #D1D5DB; border-radius: 8px; background: #F9FAFB; }
    .doc-img { max-width: 100%; max-height: 440px; height: auto; object-fit: contain; border-radius: 6px; border: 1px solid #CBD5E1; }
    .footer { text-align: center; font-size: 11px; color: #9CA3AF; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">Digital Document Assistant</div>
    <div class="subtitle">${doc.documentType} — ${doc.documentName}</div>
  </div>

  <table class="details-table">
    ${dynamicTableRows}
  </table>

  ${base64Image ? `
    <div class="image-container">
      <div style="font-size: 12px; font-weight: bold; color: #1E40AF; margin-bottom: 8px;">CROPPED DOCUMENT IMAGE</div>
      <img src="${base64Image}" class="doc-img" alt="Cropped Document Image" />
    </div>
  ` : ''}

  <div class="footer">
    Generated securely by Digital Document Assistant • ${new Date().toLocaleDateString()}
  </div>
</body>
</html>
`;

    console.log('[PDF Log 2.2] Dynamic HTML Template successfully constructed');

    // Attempt printing via expo-print if available, fallback to react-native-fs
    try {
      const ExpoPrint = require('expo-print');
      if (ExpoPrint && ExpoPrint.printToFileAsync) {
        console.log('[PDF Log 2.3] Utilizing expo-print.printToFileAsync for binary PDF generation');
        const fileResult = await ExpoPrint.printToFileAsync({ html: htmlContent });
        console.log(`[PDF Log 2.4] Binary PDF generated via expo-print at URI: ${fileResult.uri}`);
        return fileResult.uri;
      }
    } catch (expoErr) {
      console.warn('[PDF Log 2.5] expo-print fallback triggered:', expoErr);
    }

    const RNFS = require('react-native-fs');
    const fileName = `document_${doc.id}_${Date.now()}.html`;
    const pdfPath = `${RNFS.CachesDirectoryPath}/${fileName}`;

    await RNFS.writeFile(pdfPath, htmlContent, 'utf8');

    console.log(`[PDF Log 2.6] PDF HTML document generated at path: ${pdfPath}`);
    const pdfUri = `file://${pdfPath}`;
    return pdfUri;
  }

  /**
   * Save generated PDF to Android accessible directory with 15s timeout guard.
   */
  public async downloadPdfToDevice(doc: DocumentMetadata): Promise<string> {
    console.log(`[PDF Log 3] Download PDF initiated for document: ${doc.documentName}`);

    const pdfPromise = this.generateDocumentPdf(doc);
    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('PDF generation timed out after 15 seconds. Please try again.')), 15000)
    );

    const tempPdfUri = await Promise.race([pdfPromise, timeoutPromise]);
    console.log(`[PDF Log 3.1] PDF URI generated for save: ${tempPdfUri}`);

    const RNFS = require('react-native-fs');
    const cleanSourcePath = tempPdfUri.replace('file://', '');

    const sanitizedName = doc.documentName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const isHtml = tempPdfUri.endsWith('.html');
    const ext = isHtml ? '.html' : '.pdf';
    const fileName = `${sanitizedName}_${Date.now()}${ext}`;

    const downloadDir = RNFS.DownloadDirectoryPath || RNFS.DocumentDirectoryPath;
    const targetPath = `${downloadDir}/${fileName}`;

    try {
      console.log(`[PDF Log 3.2] Copying file to target destination: ${targetPath}`);
      await RNFS.copyFile(cleanSourcePath, targetPath);
      console.log(`[PDF Log 3.3] File successfully copied to target: ${targetPath}`);
      return `file://${targetPath}`;
    } catch (err: any) {
      console.warn(`[PDF Log 3.4] Direct copy failed, falling back to temp file: ${err?.message}`);
      return tempPdfUri;
    }
  }

  /**
   * Share generated PDF using native share sheet.
   */
  public async sharePdf(doc: DocumentMetadata): Promise<void> {
    console.log(`[PDF Log 4] Share PDF initiated for document: ${doc.documentName}`);

    const tempPdfUri = await this.generateDocumentPdf(doc);
    console.log(`[PDF Log 4.1] Generated PDF URI for sharing: ${tempPdfUri}`);

    try {
      const ExpoSharing = require('expo-sharing');
      if (ExpoSharing && ExpoSharing.shareAsync) {
        console.log('[PDF Log 4.2] Invoking expo-sharing.shareAsync with mimeType application/pdf');
        await ExpoSharing.shareAsync(tempPdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share ${doc.documentName} PDF`,
          UTI: 'com.adobe.pdf',
        });
        console.log('[PDF Log 4.3] Native share dialog completed');
        return;
      }
    } catch (expoShareErr) {
      console.warn('[PDF Log 4.4] expo-sharing fallback:', expoShareErr);
    }

    console.log('[PDF Log 4.5] Invoking React Native core Share sheet');
    await Share.share(
      Platform.OS === 'ios'
        ? { url: tempPdfUri, title: doc.documentName }
        : { message: `Document PDF: ${doc.documentName}\n${tempPdfUri}`, url: tempPdfUri, title: doc.documentName }
    );
    console.log('[PDF Log 4.6] Core Share sheet invoked');
  }
}

export const pdfService = new PdfService();
