/**
 * AssistantScreen.tsx — AI Document Assistant Screen
 *
 * Full-featured interactive AI Chatbot Screen.
 * Supports General Chat & Document-Specific Chat.
 * Renders inline Correction Proposal cards with explicit user confirmation.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { theme } from '../../constants/theme';
import {
  sendChatMessage,
  confirmDocumentCorrection,
  ChatMessage,
  CorrectionProposal,
} from '../../services/assistant/assistantService';

export interface AssistantScreenProps {
  navigation: any;
  route: {
    params?: {
      documentId?: string;
      documentType?: string;
      documentName?: string;
      extractedFields?: Record<string, string>;
    };
  };
}

export const AssistantScreen: React.FC<AssistantScreenProps> = ({ navigation, route }) => {
  const { user } = useAuth();
  const params = route?.params || {};
  const { documentId, documentType, documentName } = params;

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const initialWelcome: ChatMessage = {
    id: 'msg_welcome',
    role: 'assistant',
    content: documentId
      ? `Hi! I'm your AI Document Assistant. I'm ready to help you with your "${documentName || documentType || 'Document'}". Ask me anything about extracted details, missing fields, or request corrections!`
      : "Hi! I'm your AI Document Assistant. I can help you understand your documents, answer questions about extracted information, identify documents, and help correct document details.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  const [messages, setMessages] = useState<ChatMessage[]>([initialWelcome]);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages, isLoading]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;
    setErrorMsg(null);

    const userText = inputMessage.trim();
    setInputMessage('');

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setIsLoading(true);

    const conversationHistory = newHistory.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const response = await sendChatMessage({
      userId: user?.uid || 'guest_user',
      message: userText,
      documentId: documentId || null,
      conversationHistory,
    });

    setIsLoading(false);

    if (response.reply) {
      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: response.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        proposal: response.proposal || null,
        proposalStatus: response.proposal ? 'pending' : undefined,
      };
      setMessages(prev => [...prev, aiMsg]);
    } else {
      setErrorMsg('AI Assistant is temporarily unavailable. Please try again.');
    }
  };

  const handleCancelCorrection = (messageId: string) => {
    setMessages(prev =>
      prev.map(m => (m.id === messageId ? { ...m, proposalStatus: 'cancelled' } : m))
    );
  };

  const handleConfirmCorrection = async (messageId: string, proposal: CorrectionProposal) => {
    if (!documentId) {
      Alert.alert('Error', 'No active document context to apply update.');
      return;
    }

    setIsLoading(true);
    const res = await confirmDocumentCorrection(
      user?.uid || 'guest_user',
      documentId,
      proposal.field,
      proposal.proposedValue
    );
    setIsLoading(false);

    if (res.success) {
      setMessages(prev =>
        prev.map(m => (m.id === messageId ? { ...m, proposalStatus: 'confirmed' } : m))
      );
      Alert.alert('Success', res.message);
    } else {
      Alert.alert('Error', res.message || 'Could not update document.');
    }
  };

  const renderMessageItem = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubbleContainer, isUser ? styles.userBubbleContainer : styles.aiBubbleContainer]}>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.aiMessageText]}>
            {item.content}
          </Text>
          <Text style={[styles.timestampText, isUser ? styles.userTimestampText : styles.aiTimestampText]}>
            {item.timestamp}
          </Text>
        </View>

        {/* Correction Proposal Card */}
        {item.proposal && item.role === 'assistant' && (
          <View style={styles.proposalCard}>
            <View style={styles.proposalHeader}>
              <Text style={styles.proposalBadge}>⚡ Correction Requested</Text>
            </View>
            <Text style={styles.proposalText}>
              <Text style={{ fontWeight: 'bold' }}>Field:</Text> {item.proposal.field}
            </Text>
            <Text style={styles.proposalText}>
              <Text style={{ fontWeight: 'bold' }}>Current value:</Text>{' '}
              <Text style={{ textDecorationLine: 'line-through' }}>{item.proposal.currentValue || '(none)'}</Text>
            </Text>
            <Text style={styles.proposalText}>
              <Text style={{ fontWeight: 'bold' }}>New value:</Text>{' '}
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{item.proposal.proposedValue}</Text>
            </Text>

            {item.proposalStatus === 'confirmed' ? (
              <View style={styles.statusBannerSuccess}>
                <Text style={styles.statusBannerText}>✅ Update Confirmed & Saved to Database</Text>
              </View>
            ) : item.proposalStatus === 'cancelled' ? (
              <View style={styles.statusBannerCancelled}>
                <Text style={styles.statusBannerText}>❌ Correction Cancelled (Database Untouched)</Text>
              </View>
            ) : (
              <View style={styles.proposalActions}>
                <TouchableOpacity
                  style={[styles.proposalBtn, styles.proposalBtnCancel]}
                  onPress={() => handleCancelCorrection(item.id)}
                >
                  <Text style={styles.proposalBtnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.proposalBtn, styles.proposalBtnConfirm]}
                  onPress={() => handleConfirmCorrection(item.id, item.proposal!)}
                >
                  <Text style={styles.proposalBtnTextConfirm}>Confirm Update</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>AI Document Assistant</Text>
          {documentName ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              📄 Context: {documentName}
            </Text>
          ) : (
            <Text style={styles.headerSubtitle}>🤖 General Help Mode</Text>
          )}
        </View>
      </View>

      {/* Error notification banner */}
      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      {/* Chat Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessageItem}
        contentContainerStyle={styles.chatListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.loadingText}>AI Assistant is thinking…</Text>
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder={documentName ? `Ask about ${documentName}...` : "Ask a question about documents..."}
          placeholderTextColor={theme.colors.textMuted}
          value={inputMessage}
          onChangeText={setInputMessage}
          onSubmitEditing={handleSendMessage}
          returnKeyType="send"
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputMessage.trim() || isLoading) && styles.sendButtonDisabled]}
          onPress={handleSendMessage}
          disabled={!inputMessage.trim() || isLoading}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    elevation: 2,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 10,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: '600',
    marginTop: 1,
  },
  errorBanner: {
    backgroundColor: '#FFF5F5',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#FEB2B2',
  },
  errorBannerText: {
    color: '#C53030',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  chatListContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  messageBubbleContainer: {
    marginBottom: 16,
    maxWidth: '85%',
  },
  userBubbleContainer: {
    alignSelf: 'flex-end',
  },
  aiBubbleContainer: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    padding: 14,
    borderRadius: 16,
    elevation: 1,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderBottomRightRadius: 2,
  },
  aiBubble: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: 2,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  aiMessageText: {
    color: theme.colors.textPrimary,
  },
  timestampText: {
    fontSize: 10,
    marginTop: 6,
    textAlign: 'right',
  },
  userTimestampText: {
    color: '#E2E8F0',
  },
  aiTimestampText: {
    color: theme.colors.textMuted,
  },
  proposalCard: {
    marginTop: 10,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    elevation: 2,
  },
  proposalHeader: {
    marginBottom: 8,
  },
  proposalBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DD6B20',
    backgroundColor: '#FEEBC8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  proposalText: {
    fontSize: 13,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  proposalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 8,
  },
  proposalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  proposalBtnCancel: {
    backgroundColor: '#EDF2F7',
  },
  proposalBtnConfirm: {
    backgroundColor: theme.colors.primary,
  },
  proposalBtnTextCancel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
  },
  proposalBtnTextConfirm: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statusBannerSuccess: {
    marginTop: 8,
    backgroundColor: '#C6F6D5',
    padding: 8,
    borderRadius: 6,
  },
  statusBannerCancelled: {
    marginTop: 8,
    backgroundColor: '#FED7D7',
    padding: 8,
    borderRadius: 6,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    color: '#22543D',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: '#F1F5F9',
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 13,
    color: theme.colors.textMuted,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F1F5F9',
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 14,
    color: theme.colors.textPrimary,
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#A0AEC0',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
