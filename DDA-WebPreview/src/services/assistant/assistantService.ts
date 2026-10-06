/**
 * assistantService.ts — Client API Service for AI Document Assistant
 */

import { getBackendBaseUrl, verifyBackendHealth } from '../network/networkConfig';

export { getBackendBaseUrl, verifyBackendHealth };

const API_BASE_URL = getBackendBaseUrl();

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  proposal?: CorrectionProposal | null;
  proposalStatus?: 'pending' | 'confirmed' | 'cancelled';
}

export interface CorrectionProposal {
  type: 'correction_proposal';
  field: string;
  currentValue: string;
  proposedValue: string;
  reason?: string;
  requiresConfirmation?: boolean;
}

export interface SendChatParams {
  userId: string;
  message: string;
  documentId?: string | null;
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
}

export async function sendChatMessage(params: SendChatParams): Promise<{
  reply: string;
  proposal?: CorrectionProposal | null;
}> {
  console.log('[ASSISTANT][CLIENT_BUILD] NVIDIA_NIM_V1');

  const { userId, message, documentId, conversationHistory } = params;
  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const requestUrl = `${getBackendBaseUrl()}/api/assistant/chat`;
  console.log(`[ASSISTANT][NETWORK] REQUEST_URL=${requestUrl} METHOD=POST`);
  console.log(`[NETWORK][CONFIG] target_url=${requestUrl}`);
  const reqStartTime = Date.now();

  console.log(`[ASSISTANT][DEBUG] request_id=${requestId}`);
  console.log(`[ASSISTANT][NVIDIA_TIMING] CLIENT_REQUEST_START request_id=${requestId}`);
  console.log(
    `[ASSISTANT][CLIENT] REQUEST_START request_id=${requestId} url=${requestUrl} timeout_ms=45000 message_len=${
      message ? message.length : 0
    } history_count=${Array.isArray(conversationHistory) ? conversationHistory.length : 0}`
  );
  console.log(`[ASSISTANT] REQUEST_URL: ${requestUrl}`);
  console.log(`[ASSISTANT] REQUEST_START: ${new Date(reqStartTime).toISOString()}`);

  const hostMatch = requestUrl.match(/^https?:\/\/([^/:]+)/);
  const urlHost = hostMatch ? hostMatch[1] : 'unknown';

  console.log(`[ASSISTANT_DIAG] request_start: ${new Date(reqStartTime).toISOString()}`);
  console.log(`[ASSISTANT_DIAG] URL_HOST: ${urlHost}`);
  console.log(`[ASSISTANT_DIAG] timeout_ms: 45000`);
  console.log(`[ASSISTANT_DIAG] request_mode: ${documentId ? 'document' : 'general'}`);
  console.log(`[ASSISTANT_DIAG] message_length: ${message ? message.length : 0}`);
  console.log(`[ASSISTANT_DIAG] has_document_id: ${Boolean(documentId)}`);
  console.log(`[ASSISTANT_DIAG] history_count: ${Array.isArray(conversationHistory) ? conversationHistory.length : 0}`);
  console.log(`[ASSISTANT_DIAG] has_image: false`);

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => {
          console.warn(`[ASSISTANT] REQUEST_ABORT: Timed out after 45 seconds`);
          controller.abort();
        }, 45000)
      : null;

    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        'x-request-id': requestId,
      },
      body: JSON.stringify({
        requestId,
        message,
        documentId: documentId || null,
        conversationHistory: conversationHistory || [],
      }),
      signal: controller?.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    const fetchResolvedTime = Date.now();
    const elapsedMs = fetchResolvedTime - reqStartTime;
    console.log(`[ASSISTANT][NVIDIA_TIMING] CLIENT_RESPONSE_RECEIVED request_id=${requestId} elapsed_ms=${elapsedMs} status=${res.status}`);
    console.log(`[ASSISTANT][CLIENT] FETCH_RESOLVED request_id=${requestId} status=${res.status} elapsed_ms=${elapsedMs}`);
    console.log(`[ASSISTANT] RESPONSE_RECEIVED: ${new Date(fetchResolvedTime).toISOString()}`);
    console.log(`[ASSISTANT] RESPONSE_STATUS: ${res.status}`);
    console.log(`[ASSISTANT] TOTAL_TIME_MS: ${elapsedMs}ms`);

    const responseText = await res.text();
    console.log(`[ASSISTANT][CLIENT] RESPONSE_BODY_RECEIVED request_id=${requestId} length=${responseText.length}`);

    let data: any = null;
    try {
      data = JSON.parse(responseText);
      console.log(`[ASSISTANT][CLIENT] JSON_PARSE_SUCCESS request_id=${requestId} keys=${Object.keys(data || {}).join(',')}`);
    } catch (parseErr: any) {
      console.error(`[ASSISTANT][CLIENT] JSON_PARSE_FAILED request_id=${requestId} error=${parseErr.message}`);
      return {
        reply: 'AI Assistant received an invalid response format. Please try again.',
      };
    }

    if (res.ok && data?.success) {
      console.log(`[ASSISTANT][CLIENT] SUCCESS request_id=${requestId} reply_length=${data.data?.reply?.length || 0}`);
      return {
        reply: data.data?.reply || 'I processed your request.',
        proposal: data.data?.proposal || null,
      };
    } else {
      console.warn(`[ASSISTANT][CLIENT] REQUEST_FAILED request_id=${requestId} status=${res.status} message=${data?.message}`);
      if (res.status === 403) {
        return {
          reply: 'Access Denied: You do not have permission to view or manage this document.',
        };
      }
      return {
        reply: data?.message || 'AI Assistant is temporarily unavailable. Please try again.',
      };
    }
  } catch (err: any) {
    const errTime = Date.now();
    const elapsed = errTime - reqStartTime;
    if (err?.name === 'AbortError') {
      console.warn(`[ASSISTANT][CLIENT] REQUEST_ABORTED request_id=${requestId} elapsed_ms=${elapsed}`);
      return {
        reply: 'AI Assistant request timed out. Please check your connection and try again.',
      };
    }
    console.warn(`[ASSISTANT][CLIENT] FETCH_ERROR request_id=${requestId} elapsed_ms=${elapsed} error=${err?.message}`);
    return {
      reply: 'AI Assistant is temporarily unavailable. Please try again.',
    };
  }
}

export async function confirmDocumentCorrection(
  userId: string,
  documentId: string,
  field: string,
  value: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/api/documents/${documentId}/correction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ field, value }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: `Field "${field}" updated successfully!` };
    } else {
      return { success: false, message: data.message || 'Could not update field' };
    }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Network error updating field' };
  }
}
