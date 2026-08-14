/**
 * ManualCropScreen.tsx
 *
 * Full-screen interactive manual crop overlay built with React Native PanResponders.
 * Features:
 *   - 4 independently draggable corner handles (TL, TR, BL, BR)
 *   - Move whole selection area by dragging inside the crop rect
 *   - Darkened overlay outside the crop rect
 *   - Aspect-fit contain offset & scaling coordinate conversion
 *   - 90° rotation support with dynamic container adaptation
 *   - Reset, Rotate, Cancel, "Use Selection"
 *   - expo-image-manipulator integration for final pixel crop
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  LayoutChangeEvent,
} from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { theme } from '../../constants/theme';

export interface ManualCropResult {
  uri: string;
  width: number;
  height: number;
}

export interface ManualCropScreenProps {
  visible: boolean;
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  onCrop: (result: ManualCropResult) => void;
  onCancel: () => void;
}

const HANDLE_SIZE = 32;
const MIN_CROP_SIZE = 40;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ManualCropScreen: React.FC<ManualCropScreenProps> = ({
  visible,
  imageUri,
  imageWidth,
  imageHeight,
  onCrop,
  onCancel,
}) => {
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [rotation, setRotation] = useState<number>(0);
  const [isCropping, setIsCropping] = useState<boolean>(false);

  // Determine effective original image dimensions accounting for rotation
  const isRotated90 = rotation === 90 || rotation === 270;
  const effImgW = isRotated90 ? imageHeight : imageWidth;
  const effImgH = isRotated90 ? imageWidth : imageHeight;

  // Calculate contain scale and offset
  const containerW = containerSize.width;
  const containerH = containerSize.height;

  let scale = 1;
  let displayW = containerW;
  let displayH = containerH;
  let offsetX = 0;
  let offsetY = 0;

  if (containerW > 0 && containerH > 0 && effImgW > 0 && effImgH > 0) {
    scale = Math.min(containerW / effImgW, containerH / effImgH);
    displayW = effImgW * scale;
    displayH = effImgH * scale;
    offsetX = (containerW - displayW) / 2;
    offsetY = (containerH - displayH) / 2;
  }

  // Crop rect state in container coordinates
  const [cropRect, setCropRect] = useState<Rect>({
    x: offsetX,
    y: offsetY,
    width: displayW,
    height: displayH,
  });

  const cropRectRef = useRef<Rect>(cropRect);
  cropRectRef.current = cropRect;

  const startRectRef = useRef<Rect>(cropRect);

  // Initialize or reset crop rect when image/rotation/container changes
  const resetToFullImage = useCallback(() => {
    if (containerW > 0 && containerH > 0 && effImgW > 0 && effImgH > 0) {
      const s = Math.min(containerW / effImgW, containerH / effImgH);
      const dW = effImgW * s;
      const dH = effImgH * s;
      const oX = (containerW - dW) / 2;
      const oY = (containerH - dH) / 2;
      const newRect = { x: oX, y: oY, width: dW, height: dH };
      setCropRect(newRect);
      cropRectRef.current = newRect;
    }
  }, [containerW, containerH, effImgW, effImgH]);

  useEffect(() => {
    resetToFullImage();
  }, [resetToFullImage, rotation, imageUri]);

  // Container layout handler
  const handleContainerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  };

  // -------------------------------------------------------------------------
  // PanResponders for corner handles & body move
  // -------------------------------------------------------------------------
  const makeCornerPanResponder = (corner: 'tl' | 'tr' | 'bl' | 'br') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRectRef.current = { ...cropRectRef.current };
      },
      onPanResponderMove: (_, gs) => {
        const start = startRectRef.current;
        const dx = gs.dx;
        const dy = gs.dy;
        const minX = offsetX;
        const minY = offsetY;
        const maxX = offsetX + displayW;
        const maxY = offsetY + displayH;

        let nextX = start.x;
        let nextY = start.y;
        let nextW = start.width;
        let nextH = start.height;

        if (corner === 'tl') {
          const rawX = Math.min(Math.max(minX, start.x + dx), start.x + start.width - MIN_CROP_SIZE);
          const rawY = Math.min(Math.max(minY, start.y + dy), start.y + start.height - MIN_CROP_SIZE);
          nextW = start.x + start.width - rawX;
          nextH = start.y + start.height - rawY;
          nextX = rawX;
          nextY = rawY;
        } else if (corner === 'tr') {
          const rawY = Math.min(Math.max(minY, start.y + dy), start.y + start.height - MIN_CROP_SIZE);
          const rawW = Math.min(Math.max(MIN_CROP_SIZE, start.width + dx), maxX - start.x);
          nextH = start.y + start.height - rawY;
          nextY = rawY;
          nextW = rawW;
        } else if (corner === 'bl') {
          const rawX = Math.min(Math.max(minX, start.x + dx), start.x + start.width - MIN_CROP_SIZE);
          const rawH = Math.min(Math.max(MIN_CROP_SIZE, start.height + dy), maxY - start.y);
          nextW = start.x + start.width - rawX;
          nextX = rawX;
          nextH = rawH;
        } else if (corner === 'br') {
          nextW = Math.min(Math.max(MIN_CROP_SIZE, start.width + dx), maxX - start.x);
          nextH = Math.min(Math.max(MIN_CROP_SIZE, start.height + dy), maxY - start.y);
        }

        setCropRect({ x: nextX, y: nextY, width: nextW, height: nextH });
      },
    });

  const bodyPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      startRectRef.current = { ...cropRectRef.current };
    },
    onPanResponderMove: (_, gs) => {
      const start = startRectRef.current;
      const minX = offsetX;
      const minY = offsetY;
      const maxX = offsetX + displayW - start.width;
      const maxY = offsetY + displayH - start.height;

      const nextX = Math.min(Math.max(minX, start.x + gs.dx), maxX);
      const nextY = Math.min(Math.max(minY, start.y + gs.dy), maxY);

      setCropRect({ ...start, x: nextX, y: nextY });
    },
  });

  const tlPan = useRef(makeCornerPanResponder('tl')).current;
  const trPan = useRef(makeCornerPanResponder('tr')).current;
  const blPan = useRef(makeCornerPanResponder('bl')).current;
  const brPan = useRef(makeCornerPanResponder('br')).current;
  const bodyDrag = useRef(bodyPanResponder).current;

  // Rotate handler
  const handleRotate = () => {
    setRotation(r => (r + 90) % 360);
  };

  // -------------------------------------------------------------------------
  // Pixel coordinate conversion & crop execution
  // -------------------------------------------------------------------------
  const handleUseSelection = async () => {
    if (!imageUri || displayW <= 0 || displayH <= 0) return;
    setIsCropping(true);

    try {
      const current = cropRectRef.current;

      // 1. Calculate selection relative to displayed image inside container
      const relX = Math.max(0, current.x - offsetX);
      const relY = Math.max(0, current.y - offsetY);
      const relW = Math.min(displayW - relX, current.width);
      const relH = Math.min(displayH - relY, current.height);

      // 2. Convert display coordinates to image pixel coordinates
      const scaleX = effImgW / displayW;
      const scaleY = effImgH / displayH;

      const pixelX = Math.max(0, Math.round(relX * scaleX));
      const pixelY = Math.max(0, Math.round(relY * scaleY));
      const pixelW = Math.max(1, Math.min(Math.round(relW * scaleX), effImgW - pixelX));
      const pixelH = Math.max(1, Math.min(Math.round(relH * scaleY), effImgH - pixelY));

      console.log(`[CropScreen] Container: ${containerW}x${containerH}, Offset: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
      console.log(`[CropScreen] Display image: ${displayW.toFixed(1)}x${displayH.toFixed(1)}, Eff image: ${effImgW}x${effImgH}`);
      console.log(`[CropScreen] Display rect: x=${current.x.toFixed(1)}, y=${current.y.toFixed(1)}, w=${current.width.toFixed(1)}, h=${current.height.toFixed(1)}`);
      console.log(`[CropScreen] Pixel crop: originX=${pixelX}, originY=${pixelY}, width=${pixelW}, height=${pixelH}, rotation=${rotation}`);

      // 3. Execute pixel crop with expo-image-manipulator
      const actions: any[] = [];

      if (rotation > 0) {
        actions.push({ rotate: rotation });
      }

      actions.push({
        crop: {
          originX: pixelX,
          originY: pixelY,
          width: pixelW,
          height: pixelH,
        },
      });

      const manipResult = await manipulateAsync(imageUri, actions, {
        compress: 0.9,
        format: SaveFormat.JPEG,
      });

      onCrop({
        uri: manipResult.uri,
        width: manipResult.width || pixelW,
        height: manipResult.height || pixelH,
      });
    } catch (err: any) {
      console.error('[CropScreen] Crop error:', err);
      Alert.alert('Crop Error', err?.message || 'Could not crop the selected area. Please try again.');
    } finally {
      setIsCropping(false);
    }
  };

  if (!visible) return null;

  const { x: cx, y: cy, width: cw, height: ch } = cropRect;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBtn} onPress={onCancel}>
            <Text style={styles.headerBtnText}>✕ Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manual Crop</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={handleRotate}>
            <Text style={styles.headerBtnText}>↻ Rotate ({rotation}°)</Text>
          </TouchableOpacity>
        </View>

        {/* Interactive Canvas Area */}
        <View style={styles.canvasContainer} onLayout={handleContainerLayout}>
          {containerW > 0 && containerH > 0 ? (
            <>
              {/* Main Image */}
              <Image
                source={{ uri: imageUri }}
                style={[
                  styles.image,
                  {
                    left: offsetX,
                    top: offsetY,
                    width: displayW,
                    height: displayH,
                  },
                  rotation > 0 && { transform: [{ rotate: `${rotation}deg` }] },
                ]}
                resizeMode="stretch"
              />

              {/* 4 Dim Overlay Strips */}
              {/* Top */}
              <View style={[styles.dim, { left: 0, top: 0, right: 0, height: Math.max(0, cy) }]} />
              {/* Bottom */}
              <View style={[styles.dim, { left: 0, top: cy + ch, right: 0, bottom: 0 }]} />
              {/* Left */}
              <View style={[styles.dim, { left: 0, top: cy, width: Math.max(0, cx), height: ch }]} />
              {/* Right */}
              <View style={[styles.dim, { left: cx + cw, top: cy, right: 0, height: ch }]} />

              {/* Active Crop Rectangle Body */}
              <View
                style={[styles.cropBorder, { left: cx, top: cy, width: cw, height: ch }]}
                {...bodyDrag.panHandlers}
              >
                {/* Rule of Thirds Grid Lines */}
                <View style={[styles.gridLine, styles.gridH1]} />
                <View style={[styles.gridLine, styles.gridH2]} />
                <View style={[styles.gridLine, styles.gridV1]} />
                <View style={[styles.gridLine, styles.gridV2]} />
              </View>

              {/* 4 Draggable Corner Handles */}
              {/* Top-Left */}
              <View
                style={[styles.handle, { left: cx - HANDLE_SIZE / 2, top: cy - HANDLE_SIZE / 2 }]}
                {...tlPan.panHandlers}
              >
                <View style={[styles.handleCorner, styles.cornerTL]} />
              </View>

              {/* Top-Right */}
              <View
                style={[styles.handle, { left: cx + cw - HANDLE_SIZE / 2, top: cy - HANDLE_SIZE / 2 }]}
                {...trPan.panHandlers}
              >
                <View style={[styles.handleCorner, styles.cornerTR]} />
              </View>

              {/* Bottom-Left */}
              <View
                style={[styles.handle, { left: cx - HANDLE_SIZE / 2, top: cy + ch - HANDLE_SIZE / 2 }]}
                {...blPan.panHandlers}
              >
                <View style={[styles.handleCorner, styles.cornerBL]} />
              </View>

              {/* Bottom-Right */}
              <View
                style={[styles.handle, { left: cx + cw - HANDLE_SIZE / 2, top: cy + ch - HANDLE_SIZE / 2 }]}
                {...brPan.panHandlers}
              >
                <View style={[styles.handleCorner, styles.cornerBR]} />
              </View>
            </>
          ) : (
            <ActivityIndicator color={theme.colors.primary} size="large" />
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerSecondaryBtn} onPress={resetToFullImage}>
            <Text style={styles.footerSecondaryText}>↺ Reset</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.footerPrimaryBtn, isCropping && styles.btnDisabled]}
            onPress={handleUseSelection}
            disabled={isCropping}
          >
            {isCropping ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.footerPrimaryText}>✂ Use Selection</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#090D16',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  headerTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
  },
  headerBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerBtnText: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '600',
  },
  canvasContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#030712',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    position: 'absolute',
  },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  cropBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridH1: { left: 0, right: 0, top: '33.33%', height: 1 },
  gridH2: { left: 0, right: 0, top: '66.66%', height: 1 },
  gridV1: { top: 0, bottom: 0, left: '33.33%', width: 1 },
  gridV2: { top: 0, bottom: 0, left: '66.66%', width: 1 },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  handleCorner: {
    width: 20,
    height: 20,
    borderColor: '#2563EB',
    backgroundColor: 'transparent',
  },
  cornerTL: {
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTR: {
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBL: {
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBR: {
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  footer: {
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  footerSecondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  footerSecondaryText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  footerPrimaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    minWidth: 160,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  footerPrimaryText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
