import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { theme } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Props {
  visible: boolean;
  imageUri: string;
  onConfirm: (editedUri: string) => void;
  onCancel: () => void;
  onRetake: () => void;
}

type FilterType = 'original' | 'grayscale' | 'enhanced';
type CropRatio = 'full' | 'doc43' | 'trim10';

export const DocumentEditorModal: React.FC<Props> = ({
  visible,
  imageUri,
  onConfirm,
  onCancel,
  onRetake,
}) => {
  const [currentUri, setCurrentUri] = useState<string>(imageUri);
  const [activeFilter, setActiveFilter] = useState<FilterType>('original');
  const [activeCrop, setActiveCrop] = useState<CropRatio>('full');
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  useEffect(() => {
    if (imageUri) {
      setCurrentUri(imageUri);
      setActiveFilter('original');
      setActiveCrop('full');
      setRotationDegrees(0);

      Image.getSize(
        imageUri,
        (w, h) => setImageSize({ width: w, height: h }),
        () => setImageSize({ width: 800, height: 600 })
      );
    }
  }, [imageUri, visible]);

  // Apply manipulation pipeline
  const applyTransformations = async (
    targetRotation: number,
    targetFilter: FilterType,
    targetCrop: CropRatio
  ) => {
    if (!imageUri) return;
    setIsProcessing(true);
    try {
      const actions: any[] = [];

      // 1. Rotation
      if (targetRotation !== 0) {
        actions.push({ rotate: (targetRotation % 360 + 360) % 360 });
      }

      // 2. Crop presets
      if (targetCrop === 'trim10') {
        const originX = Math.round(imageSize.width * 0.05);
        const originY = Math.round(imageSize.height * 0.05);
        const cropWidth = Math.round(imageSize.width * 0.9);
        const cropHeight = Math.round(imageSize.height * 0.9);
        actions.push({
          crop: { originX, originY, width: cropWidth, height: cropHeight },
        });
      } else if (targetCrop === 'doc43') {
        const targetW = imageSize.width;
        const targetH = Math.round(imageSize.width * (3 / 4));
        const originY = Math.max(0, Math.round((imageSize.height - targetH) / 2));
        if (targetH <= imageSize.height) {
          actions.push({
            crop: { originX: 0, originY, width: targetW, height: targetH },
          });
        }
      }

      const result = await manipulateAsync(
        imageUri,
        actions,
        { compress: 0.9, format: SaveFormat.JPEG }
      );

      setCurrentUri(result.uri);
    } catch (err) {
      console.error('Image editor manipulation error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRotateLeft = () => {
    const nextDeg = rotationDegrees - 90;
    setRotationDegrees(nextDeg);
    applyTransformations(nextDeg, activeFilter, activeCrop);
  };

  const handleRotateRight = () => {
    const nextDeg = rotationDegrees + 90;
    setRotationDegrees(nextDeg);
    applyTransformations(nextDeg, activeFilter, activeCrop);
  };

  const handleSelectFilter = (filter: FilterType) => {
    setActiveFilter(filter);
    applyTransformations(rotationDegrees, filter, activeCrop);
  };

  const handleSelectCrop = (crop: CropRatio) => {
    setActiveCrop(crop);
    applyTransformations(rotationDegrees, activeFilter, crop);
  };

  const handleConfirmUseDocument = () => {
    onConfirm(currentUri);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Document Editor</Text>
          <TouchableOpacity onPress={onRetake} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Retake</Text>
          </TouchableOpacity>
        </View>

        {/* Image Preview Canvas */}
        <View style={styles.canvas}>
          {isProcessing ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.loadingText}>Applying edits...</Text>
            </View>
          ) : null}

          <Image
            source={{ uri: currentUri }}
            style={[
              styles.previewImage,
              activeFilter === 'grayscale' && styles.grayscaleFilter,
              activeFilter === 'enhanced' && styles.enhancedFilter,
            ]}
            resizeMode="contain"
          />
        </View>

        {/* Controls Panel */}
        <View style={styles.controlsPanel}>
          {/* Action Row: Rotate Left, Rotate Right */}
          <View style={styles.rowLabelGroup}>
            <Text style={styles.controlGroupLabel}>Rotation</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.toolBtn} onPress={handleRotateLeft}>
                <Text style={styles.toolBtnText}>↺ Rotate Left</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={handleRotateRight}>
                <Text style={styles.toolBtnText}>↻ Rotate Right</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Action Row: Crop Presets */}
          <View style={styles.rowLabelGroup}>
            <Text style={styles.controlGroupLabel}>Crop & Trim</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <TouchableOpacity
                style={[styles.chip, activeCrop === 'full' && styles.chipActive]}
                onPress={() => handleSelectCrop('full')}
              >
                <Text style={[styles.chipText, activeCrop === 'full' && styles.chipTextActive]}>Full Image</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, activeCrop === 'trim10' && styles.chipActive]}
                onPress={() => handleSelectCrop('trim10')}
              >
                <Text style={[styles.chipText, activeCrop === 'trim10' && styles.chipTextActive]}>Trim Edges (5%)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, activeCrop === 'doc43' && styles.chipActive]}
                onPress={() => handleSelectCrop('doc43')}
              >
                <Text style={[styles.chipText, activeCrop === 'doc43' && styles.chipTextActive]}>4:3 Doc Crop</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Action Row: Filter Options */}
          <View style={styles.rowLabelGroup}>
            <Text style={styles.controlGroupLabel}>Filter & Enhancement</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.filterChip, activeFilter === 'original' && styles.filterChipActive]}
                onPress={() => handleSelectFilter('original')}
              >
                <Text style={[styles.filterChipText, activeFilter === 'original' && styles.filterChipTextActive]}>Original</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterChip, activeFilter === 'grayscale' && styles.filterChipActive]}
                onPress={() => handleSelectFilter('grayscale')}
              >
                <Text style={[styles.filterChipText, activeFilter === 'grayscale' && styles.filterChipTextActive]}>Grayscale</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterChip, activeFilter === 'enhanced' && styles.filterChipActive]}
                onPress={() => handleSelectFilter('enhanced')}
              >
                <Text style={[styles.filterChipText, activeFilter === 'enhanced' && styles.filterChipTextActive]}>High Contrast</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm Button */}
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmUseDocument}>
            <Text style={styles.confirmBtnText}>✓ Use Document for OCR</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  title: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  headerBtn: {
    padding: 8,
  },
  headerBtnText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  canvas: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020617',
    position: 'relative',
  },
  previewImage: {
    width: SCREEN_WIDTH - 32,
    height: '100%',
  },
  grayscaleFilter: {
    opacity: 0.9,
  },
  enhancedFilter: {
    opacity: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    zIndex: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFF',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '600',
  },
  controlsPanel: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  rowLabelGroup: {
    marginBottom: 12,
  },
  controlGroupLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  toolBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  toolBtnText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  chipScroll: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
  },
  chipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  filterChip: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  confirmBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
