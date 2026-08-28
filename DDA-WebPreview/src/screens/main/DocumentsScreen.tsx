import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Image,
  Dimensions,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { readAsStringAsync, writeAsStringAsync, EncodingType, cacheDirectory, downloadAsync, StorageAccessFramework } from 'expo-file-system/legacy';
import { theme } from '../../constants/theme';
import { documentService } from '../../services/document/documentService';
import { DocumentCategory, DocumentMetadata } from '../../types/document';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useAuth } from '../../context/AuthContext';

const { width } = Dimensions.get('window');

export const DocumentsScreen: React.FC = () => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Detail & Edit Modal State
  const [selectedDoc, setSelectedDoc] = useState<DocumentMetadata | null>(null);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editType, setEditType] = useState<DocumentCategory>('Other');
  const [editNumber, setEditNumber] = useState<string>('');
  const [editIssueDate, setEditIssueDate] = useState<string>('');
  const [editExpiryDate, setEditExpiryDate] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Large Image Preview State
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const categories = [
    { label: 'All', value: 'ALL' },
    { label: 'Aadhaar', value: 'Aadhaar' },
    { label: 'PAN', value: 'PAN' },
    { label: 'Voter ID', value: 'VoterID' },
    { label: 'Passport', value: 'Passport' },
    { label: 'Licence', value: 'DrivingLicence' },
    { label: 'Vehicle RC', value: 'VehicleRC' },
    { label: 'Insurance', value: 'Insurance' },
    { label: 'Educational', value: 'EducationalCertificate' },
    { label: 'Other', value: 'Other' },
  ];

  const fetchDocs = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await documentService.getDocuments(user.uid);
      setDocuments(data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load documents.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      fetchDocs();
    }, [fetchDocs])
  );

  const handleOpenDocDetails = (doc: DocumentMetadata) => {
    setSelectedDoc(doc);
    setEditName(doc.documentName);
    setEditType(doc.documentType);
    setEditNumber(doc.documentNumber);
    setEditIssueDate(doc.issueDate || '');
    setEditExpiryDate(doc.expiryDate || '');
    setIsEditMode(false);
  };

  const handleCloseModal = () => {
    setSelectedDoc(null);
    setIsEditMode(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedDoc || !user?.uid) return;
    if (!editName.trim()) {
      Alert.alert('Validation Error', 'Document Name is required.');
      return;
    }

    setIsSaving(true);
    try {
      await documentService.updateDocument(user.uid, selectedDoc.id, {
        documentName: editName.trim(),
        documentType: editType,
        documentNumber: editNumber.trim(),
        issueDate: editIssueDate.trim(),
        expiryDate: editExpiryDate.trim(),
      });

      Alert.alert('Success', 'Document updated successfully.');
      handleCloseModal();
      fetchDocs();
    } catch (err: any) {
      Alert.alert('Update Failed', err?.message || 'Could not update document.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDoc = (doc: DocumentMetadata) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete "${doc.documentName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user?.uid) return;
            try {
              await documentService.deleteDocument(user.uid, doc.id);
              Alert.alert('Deleted', 'Document deleted successfully.');
              handleCloseModal();
              fetchDocs();
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Could not delete document.');
            }
          },
        },
      ]
    );
  };

  // Helper to convert any image source (http/https remote or file://) to a Base64 Data URL for PDF HTML embedding
  const getImageBase64DataUrl = async (imageUri: string): Promise<string | null> => {
    try {
      let localPath = imageUri;

      if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
        const tempName = `temp_pdf_${Date.now()}.jpg`;
        const cachePath = `${cacheDirectory}${tempName}`;
        const downloadRes = await downloadAsync(imageUri, cachePath);
        localPath = downloadRes.uri;
      }

      const base64 = await readAsStringAsync(localPath, {
        encoding: EncodingType.Base64,
      });

      return `data:image/jpeg;base64,${base64}`;
    } catch (err) {
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // PDF Export & Native Sharing Logic
  // ---------------------------------------------------------------------------

  const buildDynamicPdfRows = (doc: DocumentMetadata): string => {
    const rows: { label: string; value: string }[] = [];

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

    if (doc.fields && typeof doc.fields === 'object') {
      Object.entries(doc.fields).forEach(([key, val]) => {
        if (val && typeof val === 'string' && val.trim()) {
          const formattedLabel = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();

          const exists = rows.some(r => r.label.toLowerCase() === formattedLabel.toLowerCase());
          if (!exists) {
            rows.push({ label: formattedLabel, value: val.trim() });
          }
        }
      });
    }

    return rows
      .map(r => `<tr><th>${r.label}</th><td>${r.value}</td></tr>`)
      .join('\n            ');
  };

  const generatePdfFile = async (doc: DocumentMetadata): Promise<string> => {
    console.log(`[PDF Log 1] Generating PDF for: ${doc.documentName}`);

    // Prioritize cropped image path over original raw image
    const rawImageSource = doc.croppedImagePath || doc.localFileUri || doc.fileUrl;
    console.log(`[PDF Log 1.1] Resolved Cropped Image Source: ${rawImageSource || 'None'}`);

    let base64ImageDataUrl: string | null = null;

    if (rawImageSource) {
      base64ImageDataUrl = await getImageBase64DataUrl(rawImageSource);
      console.log(`[PDF Log 1.2] Base64 image status: ${base64ImageDataUrl ? 'Converted' : 'Failed'}`);
    }

    const dynamicTableRows = buildDynamicPdfRows(doc);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${doc.documentName}</title>
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 30px; color: #1e293b; }
            .header { border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 20px; }
            .title { font-size: 24px; font-weight: bold; color: #1e3a8a; margin: 0; }
            .subtitle { font-size: 14px; color: #64748b; margin-top: 4px; }
            .table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 25px; }
            .table th, .table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
            .table th { background-color: #f8fafc; font-size: 13px; color: #475569; width: 35%; }
            .table td { font-size: 14px; font-weight: 500; }
            .image-container { text-align: center; margin-top: 20px; page-break-inside: avoid; }
            .doc-image { max-width: 100%; max-height: 450px; border-radius: 8px; border: 1px solid #cbd5e1; margin-top: 10px; }
            .footer { margin-top: 30px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">${doc.documentName}</h1>
            <div class="subtitle">Type: ${doc.documentType} | Digital Document Assistant</div>
          </div>

          <table class="table">
            ${dynamicTableRows}
          </table>

          ${base64ImageDataUrl ? `
            <div class="image-container">
              <h3 style="color: #1e3a8a; font-size: 14px;">CROPPED DOCUMENT IMAGE</h3>
              <img src="${base64ImageDataUrl}" class="doc-image" />
            </div>
          ` : ''}

          <div class="footer">
            Generated securely by Digital Document Assistant • ${new Date().toLocaleDateString()}
          </div>
        </body>
      </html>
    `;

    console.log('[PDF Log 1.3] Calling Print.printToFileAsync for binary PDF');
    const { uri } = await Print.printToFileAsync({ html: htmlContent });
    console.log(`[PDF Log 1.4] Binary PDF generated successfully at URI: ${uri}`);
    return uri;
  };

  const handleSavePdf = async () => {
    if (!selectedDoc) return;
    console.log(`[PDF Log 2] handleSavePdf triggered for: ${selectedDoc.documentName}`);
    setIsExporting(true);

    try {
      const pdfPromise = generatePdfFile(selectedDoc);
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('PDF generation timed out after 15 seconds.')), 15000)
      );

      const pdfUri = await Promise.race([pdfPromise, timeoutPromise]);
      console.log(`[PDF Log 2.1] PDF URI generated for save: ${pdfUri}`);

      const sanitizedDocNumber = (selectedDoc.documentNumber || 'Document').replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedDocType = selectedDoc.documentType.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${sanitizedDocType}_${sanitizedDocNumber}.pdf`;

      if (Platform.OS === 'android' && StorageAccessFramework) {
        try {
          console.log('[PDF Log 2.2] Requesting StorageAccessFramework directory permissions');
          const saf = StorageAccessFramework;
          const permissions = await saf.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            console.log('[PDF Log 2.3] Directory permissions granted. Writing file.');
            const base64Data = await readAsStringAsync(pdfUri, { encoding: EncodingType.Base64 });
            const newFileUri = await saf.createFileAsync(
              permissions.directoryUri,
              fileName,
              'application/pdf'
            );
            await writeAsStringAsync(newFileUri, base64Data, { encoding: EncodingType.Base64 });
            console.log(`[PDF Log 2.4] PDF saved successfully via SAF: ${newFileUri}`);
            Alert.alert('PDF Saved', `PDF saved successfully as "${fileName}".`);
            return;
          }
        } catch (safErr: any) {
          console.warn(`[PDF Log 2.5] SAF Save fallback: ${safErr?.message}`);
        }
      }

      if (await Sharing.isAvailableAsync()) {
        console.log('[PDF Log 2.6] Using Sharing dialog to save PDF');
        await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', dialogTitle: `Save ${fileName}` });
        Alert.alert('PDF Saved', 'PDF file ready and saved successfully.');
      } else {
        Alert.alert('PDF Saved', `PDF file generated successfully at ${pdfUri}`);
      }
    } catch (err: any) {
      console.error('[PDF Log 2.7] handleSavePdf error:', err);
      Alert.alert('Save PDF Failed', err?.message || 'Could not save PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSharePdf = async () => {
    if (!selectedDoc) return;
    console.log(`[PDF Log 3] handleSharePdf triggered for: ${selectedDoc.documentName}`);
    setIsExporting(true);

    try {
      const pdfPromise = generatePdfFile(selectedDoc);
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('PDF generation timed out after 15 seconds.')), 15000)
      );

      const pdfUri = await Promise.race([pdfPromise, timeoutPromise]);
      console.log(`[PDF Log 3.1] PDF URI generated for sharing: ${pdfUri}`);

      if (await Sharing.isAvailableAsync()) {
        console.log('[PDF Log 3.2] Launching native Share sheet with mimeType application/pdf');
        await Sharing.shareAsync(pdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share ${selectedDoc.documentName} PDF`,
          UTI: 'com.adobe.pdf',
        });
        console.log('[PDF Log 3.3] Share sheet launched successfully');
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.error('[PDF Log 3.4] handleSharePdf error:', err);
      if (err?.message !== 'User cancelled') {
        Alert.alert('Unable to Share PDF', err?.message || 'Could not share PDF.');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareImage = async () => {
    if (!selectedDoc) return;
    const imageSource = selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri;
    if (!imageSource) {
      Alert.alert('No Image', 'No image file is attached to this document.');
      return;
    }

    try {
      let localPath = imageSource;
      if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
        const cachePath = `${cacheDirectory}share_${Date.now()}.jpg`;
        const downloadRes = await downloadAsync(imageSource, cachePath);
        localPath = downloadRes.uri;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localPath, {
          mimeType: 'image/jpeg',
          dialogTitle: `Share ${selectedDoc.documentName} Image`,
        });
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err: any) {
      Alert.alert('Share Image Failed', err?.message || 'Could not share image.');
    }
  };

  const filteredDocs = documents.filter((doc) => {
    const matchesCategory =
      selectedCategory === 'ALL' || doc.documentType === selectedCategory;
    const matchesSearch =
      doc.documentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.documentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.documentNumber &&
        doc.documentNumber.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  if (isLoading) {
    return <LoadingIndicator message="Loading personal vault..." />;
  }

  return (
    <View style={styles.container}>
      {/* Search Header */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, type, or number..."
          placeholderTextColor={theme.colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.clearIcon}>✖</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category Filter Chips */}
      <View style={styles.chipWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => setSelectedCategory(cat.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[styles.chipText, isSelected && styles.chipTextSelected]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Error state */}
      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity onPress={fetchDocs} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Main List */}
      <ScrollView contentContainerStyle={styles.listContent}>
        {filteredDocs.length === 0 ? (
          <EmptyState
            icon="📂"
            title="No Documents Found"
            description={
              searchQuery
                ? `No documents matching "${searchQuery}"`
                : 'No documents saved under this category yet.'
            }
          />
        ) : (
          filteredDocs.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => handleOpenDocDetails(doc)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{doc.documentType}</Text>
                </View>
                <Text style={styles.dateText}>
                  {doc.issueDate ? `Issued: ${doc.issueDate}` : 'Secured'}
                </Text>
              </View>
              <Text style={styles.cardTitle}>{doc.documentName}</Text>
              <Text style={styles.cardNumber}>
                {doc.documentNumber || (doc.fileName ? `File: ${doc.fileName}` : 'Saved in Vault')}
              </Text>
              {doc.expiryDate ? (
                <Text style={styles.expiryText}>
                  Expires: <Text style={styles.expiryDate}>{doc.expiryDate}</Text>
                </Text>
              ) : null}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Document Details & Edit Modal */}
      <Modal
        visible={!!selectedDoc}
        animationType="slide"
        transparent={true}
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isEditMode ? 'Edit Document' : 'Document Details'}
              </Text>
              <TouchableOpacity onPress={handleCloseModal}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedDoc ? (
              <ScrollView style={styles.modalBody}>
                {!isEditMode ? (
                  // Read-Only Detail View
                  <View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Document Name</Text>
                      <Text style={styles.detailValue}>{selectedDoc.documentName}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Document Type</Text>
                      <Text style={styles.detailValue}>{selectedDoc.documentType}</Text>
                    </View>

                    {selectedDoc.documentNumber ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Document Number</Text>
                        <Text style={styles.detailValue}>{selectedDoc.documentNumber}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.name ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Holder Name</Text>
                        <Text style={styles.detailValue}>{selectedDoc.name}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.fatherName ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Father / Relative Name</Text>
                        <Text style={styles.detailValue}>{selectedDoc.fatherName}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.gender ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Gender</Text>
                        <Text style={styles.detailValue}>{selectedDoc.gender}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.dateOfBirth ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Date of Birth</Text>
                        <Text style={styles.detailValue}>{selectedDoc.dateOfBirth}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.address ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Address</Text>
                        <Text style={styles.detailValue}>{selectedDoc.address}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.issueDate ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Issue Date</Text>
                        <Text style={styles.detailValue}>{selectedDoc.issueDate}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.expiryDate ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Expiry Date</Text>
                        <Text style={styles.detailValue}>{selectedDoc.expiryDate}</Text>
                      </View>
                    ) : null}

                    {/* Display All Saved Dynamic Fields */}
                    {selectedDoc.fields && Object.keys(selectedDoc.fields).length > 0 ? (
                      <View style={styles.fieldsSection}>
                        <Text style={styles.fieldsSectionTitle}>Extracted Information</Text>
                        {Object.entries(selectedDoc.fields).map(([k, v]) => (
                          <View key={k} style={styles.detailRow}>
                            <Text style={styles.detailLabel}>{k.replace(/_/g, ' ')}</Text>
                            <Text style={styles.detailValue}>{v}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {/* Cropped Document Image Preview */}
                    {(selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri) ? (
                      <View style={styles.imagePreviewSection}>
                        <Text style={styles.fieldsSectionTitle}>Document Image</Text>
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => setPreviewImageUri(selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri || null)}
                        >
                          <Image
                            source={{ uri: selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri }}
                            style={styles.docPreviewImage}
                            resizeMode="cover"
                          />
                          <Text style={styles.tapToEnlarge}>Tap to view full screen</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {/* Actions: Save PDF, Share PDF, Share Image, Edit, Delete */}
                    <View style={styles.modalActionStack}>
                      <View style={styles.buttonRow}>
                        <Button
                          title="📥 Download PDF"
                          onPress={handleSavePdf}
                          isLoading={isExporting}
                          variant="primary"
                          style={{ flex: 1, marginRight: 4 }}
                        />
                        <Button
                          title="📤 Share PDF"
                          onPress={handleSharePdf}
                          isLoading={isExporting}
                          variant="outlined"
                          style={{ flex: 1, marginHorizontal: 4 }}
                        />
                        <Button
                          title="🖼️ Share Image"
                          onPress={handleShareImage}
                          variant="outlined"
                          style={{ flex: 1, marginLeft: 4 }}
                        />
                      </View>

                      <View style={[styles.buttonRow, { marginTop: 10 }]}>
                        <Button
                          title="✏️ Edit Info"
                          onPress={() => setIsEditMode(true)}
                          variant="outlined"
                          style={{ flex: 1, marginRight: 6 }}
                        />
                        <Button
                          title="🗑️ Delete"
                          onPress={() => handleDeleteDoc(selectedDoc)}
                          variant="outlined"
                          style={{ flex: 1, marginLeft: 6 }}
                        />
                      </View>
                    </View>
                  </View>
                ) : (
                  // Edit Form View
                  <View>
                    <Input
                      label="Document Name"
                      value={editName}
                      onChangeText={setEditName}
                      placeholder="e.g. Voter ID Card"
                    />

                    <Text style={styles.fieldLabel}>Document Type</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      {(['Aadhaar', 'PAN', 'VoterID', 'Passport', 'DrivingLicence', 'VehicleRC', 'Insurance', 'EducationalCertificate', 'Other'] as DocumentCategory[]).map((cat) => (
                        <TouchableOpacity
                          key={cat}
                          style={[
                            styles.chip,
                            editType === cat && styles.chipSelected,
                          ]}
                          onPress={() => setEditType(cat)}
                        >
                          <Text style={[styles.chipText, editType === cat && styles.chipTextSelected]}>
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    <Input
                      label="Document Number"
                      value={editNumber}
                      onChangeText={setEditNumber}
                      placeholder="e.g. XXXX-XXXX-1234"
                    />

                    <Input
                      label="Issue Date (Optional)"
                      value={editIssueDate}
                      onChangeText={setEditIssueDate}
                      placeholder="YYYY-MM-DD"
                    />

                    <Input
                      label="Expiry Date (Optional)"
                      value={editExpiryDate}
                      onChangeText={setEditExpiryDate}
                      placeholder="YYYY-MM-DD"
                    />

                    <View style={styles.modalActions}>
                      <Button
                        title="Save Changes"
                        onPress={handleSaveEdit}
                        isLoading={isSaving}
                        variant="primary"
                        style={{ flex: 1, marginRight: 8 }}
                      />
                      <Button
                        title="Cancel"
                        onPress={() => setIsEditMode(false)}
                        variant="outlined"
                        style={{ flex: 1, marginLeft: 8 }}
                      />
                    </View>
                  </View>
                )}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Full Screen Image Preview Modal */}
      <Modal
        visible={!!previewImageUri}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <View style={styles.fullImageOverlay}>
          <TouchableOpacity
            style={styles.closeFullImageBtn}
            onPress={() => setPreviewImageUri(null)}
          >
            <Text style={styles.closeFullImageText}>✕ Close</Text>
          </TouchableOpacity>
          {previewImageUri ? (
            <Image
              source={{ uri: previewImageUri }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    margin: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: theme.colors.textPrimary,
  },
  clearIcon: {
    fontSize: 14,
    color: theme.colors.textMuted,
  },
  chipWrapper: {
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.xs,
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#FFF',
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    padding: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 13,
  },
  retryBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  categoryBadge: {
    backgroundColor: 'rgba(30, 58, 138, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  dateText: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  cardNumber: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  expiryText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 6,
  },
  expiryDate: {
    color: theme.colors.warning,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    paddingBottom: theme.spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  closeBtn: {
    fontSize: 20,
    color: theme.colors.textMuted,
    padding: 4,
  },
  modalBody: {
    padding: theme.spacing.md,
  },
  detailRow: {
    marginVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 6,
  },
  detailLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textTransform: 'capitalize',
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 6,
  },
  fieldsSection: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm + 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fieldsSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  imagePreviewSection: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  docPreviewImage: {
    width: '100%',
    height: 200,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: 4,
  },
  tapToEnlarge: {
    fontSize: 11,
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '600',
  },
  modalActionStack: {
    marginTop: theme.spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  fullImageOverlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeFullImageBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  closeFullImageText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  fullScreenImage: {
    width: width,
    height: '80%',
  },
});
