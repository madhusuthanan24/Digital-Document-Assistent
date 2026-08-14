import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const ScanScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>📷 Scan Document</Text>

      <Text style={styles.text}>
        Web Preview Mode
      </Text>

      <Text style={styles.text}>
        Camera, Document Picker and OCR are disabled in the browser preview.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  text: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
});
