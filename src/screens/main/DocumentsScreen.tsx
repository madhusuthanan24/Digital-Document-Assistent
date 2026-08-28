import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  Modal,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import { documentService } from '../../services/document/documentService';
import { DocumentCategory, DocumentMetadata } from '../../types/document';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useAuth } from '../../context/AuthContext';
import { pdfService } from '../../services/pdf/pdfService';

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

  // PDF Action States
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [isSharingPdf, setIsSharingPdf] = useState<boolean>(false);

  // Image load error tracking
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  const categories = [
    { label: 'All', value: 'ALL' },
    { label: 'Aadhaar', value: 'Aadhaar' },
    { label: 'PAN', value: 'PAN' },
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
      console.log('[Vault] Loading document list');
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
    console.log(`[Vault] Loading document: ${doc.documentName}`);
    console.log(`[Vault] Loading document image: ${doc.id}`);
    setSelectedDoc(doc);
    setEditName(doc.documentName);
    setEditType(doc.documentType);
    setEditNumber(doc.documentNumber || '');
    setEditIssueDate(doc.issueDate || '');
    setEditExpiryDate(doc.expiryDate || '');
    setIsEditMode(false);
  };

  const handleCloseModal = () => {
    setSelectedDoc(null);
    setIsEditMode(false);
  };

  const handleDownloadPdf = async (doc: DocumentMetadata) => {
    setIsDownloadingPdf(true);
    try {
      const savedPath = await pdfService.downloadPdfToDevice(doc);
      Alert.alert(
        'PDF Saved Successfully',
        `The document PDF has been downloaded and saved to your device!\n\nLocation: ${savedPath}`,
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      Alert.alert('Unable to Generate PDF', err?.message || 'Could not download PDF.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleSharePdf = async (doc: DocumentMetadata) => {
    setIsSharingPdf(true);
    try {
      await pdfService.sharePdf(doc);
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        Alert.alert('Unable to Share PDF', err?.message || 'Could not share PDF.');
      }
    } finally {
      setIsSharingPdf(false);
    }
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
    return <LoadingIndicator message="Loading document vault..." />;
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
          filteredDocs.map((doc) => {
            const imageUrl = documentService.getDocumentImageUrl(doc.id, doc.imagePath, doc.localFileUri, doc.croppedImagePath);
            const hasError = imageErrorMap[doc.id];

            return (
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

                {/* Cropped Document Image Preview in Card */}
                {imageUrl && !hasError ? (
                  <View style={styles.cardImageContainer}>
                    <Image
                      source={{
                        uri: imageUrl,
                        headers: user?.uid ? { 'x-user-id': user.uid } : undefined,
                      }}
                      style={styles.cardImage}
                      resizeMode="cover"
                      onError={() =>
                        setImageErrorMap((prev) => ({ ...prev, [doc.id]: true }))
                      }
                    />
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })
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
                    {/* Cropped Document Image Preview in Modal */}
                    {documentService.getDocumentImageUrl(selectedDoc.id, selectedDoc.imagePath, selectedDoc.localFileUri, selectedDoc.croppedImagePath) ? (
                      <View style={styles.modalImageWrapper}>
                        <Image
                          source={{
                            uri: documentService.getDocumentImageUrl(selectedDoc.id, selectedDoc.imagePath, selectedDoc.localFileUri, selectedDoc.croppedImagePath),
                            headers: user?.uid ? { 'x-user-id': user.uid } : undefined,
                          }}
                          style={styles.modalImage}
                          resizeMode="contain"
                        />
                      </View>
                    ) : null}

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Document Name</Text>
                      <Text style={styles.detailValue}>{selectedDoc.documentName}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Type</Text>
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

                    {/* Render all dynamic AI-extracted fields */}
                    {selectedDoc.fields && typeof selectedDoc.fields === 'object'
                      ? Object.entries(selectedDoc.fields).map(([key, val]) => {
                          if (!val || typeof val !== 'string' || !val.trim()) return null;
                          const formattedLabel = key
                            .replace(/([A-Z])/g, ' $1')
                            .replace(/_/g, ' ')
                            .replace(/^\w/, c => c.toUpperCase())
                            .trim();

                          // Avoid repeating standard fields already shown above
                          const lower = formattedLabel.toLowerCase();
                          if (
                            lower === 'document name' ||
                            lower === 'document type' ||
                            lower === 'type' ||
                            lower === 'document number' ||
                            lower === 'name' ||
                            lower === 'holder name' ||
                            lower === 'father name' ||
                            lower === 'father / relative name' ||
                            lower === 'gender' ||
                            lower === 'date of birth' ||
                            lower === 'address' ||
                            lower === 'issue date' ||
                            lower === 'expiry date'
                          ) {
                            return null;
                          }

                          return (
                            <View key={key} style={styles.detailRow}>
                              <Text style={styles.detailLabel}>{formattedLabel}</Text>
                              <Text style={styles.detailValue}>{val.trim()}</Text>
                            </View>
                          );
                        })
                      : null}

                    {/* PDF Actions */}
                    <View style={styles.pdfActionsRow}>
                      <Button
                        title={isDownloadingPdf ? 'Saving...' : '📥 Download PDF'}
                        onPress={() => handleDownloadPdf(selectedDoc)}
                        isLoading={isDownloadingPdf}
                        variant="primary"
                        style={{ flex: 1, marginRight: 6 }}
                      />
                      <Button
                        title={isSharingPdf ? 'Sharing...' : '📤 Share PDF'}
                        onPress={() => handleSharePdf(selectedDoc)}
                        isLoading={isSharingPdf}
                        variant="outlined"
                        style={{ flex: 1, marginLeft: 6 }}
                      />
                    </View>

                    {/* Edit & Delete Actions */}
                    <View style={styles.modalActionsRow}>
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
                ) : (
                  // Edit Form View
                  <View>
                    <Input
                      label="Document Name"
                      value={editName}
                      onChangeText={setEditName}
                      placeholder="e.g. Aadhaar Card"
                    />

                    <Text style={styles.fieldLabel}>Document Type</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      {(['Aadhaar', 'PAN', 'Passport', 'DrivingLicence', 'VehicleRC', 'Insurance', 'EducationalCertificate', 'Other'] as DocumentCategory[]).map((cat) => (
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

                    <View style={styles.modalActionsRow}>
                      <Button
                        title="Save Changes"
                        onPress={handleSaveEdit}
                        isLoading={isSaving}
                        variant="primary"
                        style={{ flex: 1, marginRight: 6 }}
                      />
                      <Button
                        title="Cancel"
                        onPress={() => setIsEditMode(false)}
                        variant="outlined"
                        style={{ flex: 1, marginLeft: 6 }}
                      />
                    </View>
                  </View>
                )}
              </ScrollView>
            ) : null}
          </View>
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
    height: 48,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchIcon: {
    fontSize: 18,
    marginRight: theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
  },
  clearIcon: {
    fontSize: 14,
    color: theme.colors.textMuted,
    padding: theme.spacing.xs,
  },
  chipWrapper: {
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
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
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  chipTextSelected: {
    color: theme.colors.onPrimary,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: theme.spacing.md,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 13,
    flex: 1,
  },
  retryBtn: {
    backgroundColor: theme.colors.error,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: theme.radius.xs,
  },
  retryText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 12,
  },
  listContent: {
    padding: theme.spacing.md,
    paddingTop: 0,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  categoryBadge: {
    backgroundColor: 'rgba(30, 58, 138, 0.1)',
    paddingHorizontal: theme.spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: theme.radius.xs,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  dateText: {
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  cardNumber: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  expiryText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  expiryDate: {
    fontWeight: '700',
    color: theme.colors.warning,
  },

  // Card & Modal Image Container
  cardImageContainer: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#0F172A',
  },
  cardImage: {
    width: '100%',
    height: 140,
  },
  modalImageWrapper: {
    width: '100%',
    height: 220,
    backgroundColor: '#090D16',
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    maxHeight: '85%',
    padding: theme.spacing.lg,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.xs,
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
    marginBottom: theme.spacing.xs,
  },
  detailRow: {
    marginBottom: theme.spacing.md,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 6,
  },
  pdfActionsRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  modalActionsRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.xs,
  },
});
