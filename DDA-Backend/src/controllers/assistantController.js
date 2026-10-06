/**
 * assistantController.js — DDA AI Assistant Backend Controller
 *
 * Dedicated NVIDIA NIM integration for AI Document Assistant.
 * Uses ASSISTANT_NVIDIA_API_KEY exclusively.
 * NVIDIA OCR and document extraction pipelines remain completely independent and untouched.
 */

const prisma = require('../db');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const SYSTEM_PROMPT = `You are the AI Document Assistant for Digital Document Assistant (DDA).
Your purpose is to help users understand, verify, navigate, and manage information associated with ANY type of document.

SUPPORTED DOCUMENTS:
You understand all kinds of documents, including but not limited to:
- Identity & Government: Aadhaar, PAN card, Passport, Voter ID, Driving Licence, Vehicle RC, Ration card
- Financial: Bank statements, passbooks, cheques, credit cards, insurance policies, tax filings (ITR)
- Invoices & Receipts: Utility bills (electricity, water, gas), GST invoices, purchase receipts
- Education & Work: College degree/diploma certificates, marks cards, transcripts, offer letters, payslips, experience certificates
- Legal & Real Estate: Sale deeds, rental agreements, affidavits, contracts
- Any Custom Document: You dynamically evaluate fields and structure for any uploaded or discussed document.

CORE CAPABILITIES & RULES:
1. Dynamic Document Understanding:
   - Identify documentType from context or user description.
   - Accurately determine requiredFields, optionalFields, missingFields, and additionalFields for any document.
   - When asked what fields a document should contain, provide a clear, concise bulleted list of essential fields.
   - When asked which fields are missing from a document, compare the provided extracted fields against the expected fields for that document type.
2. Ground Truth & Accuracy:
   - NEVER fabricate, invent, or guess names, document numbers, dates of birth, addresses, or other private values.
   - Use the provided document context when answering questions about a user's document.
   - If a specific field or value was not detected or is absent in the document context, explicitly say:
     "That information was not detected in the document."
   - Never claim an action or database modification was completed unless the application confirmed it.
3. Concise & Fast Responses:
   - Keep answers helpful, concise, well-structured, and direct.
   - For greetings (e.g. "Hi", "Hello"), give a brief, friendly 1-2 sentence welcome offering document help.
   - For document procedures (e.g. updating an Aadhaar name or applying for a duplicate PAN), provide clear, step-by-step guidance.
   - Output ONLY the direct final response for the user. Never include scratchpads, reasoning notes, draft steps, or thought traces.
4. Document Correction Proposals:
   - If the user requests to update, fix, or change a document field (e.g. "My name is wrong, change it to MADHU", "Fix my DOB to 01/01/1995", "The PAN number should be ABCDE1234F"), you MUST include a JSON block formatted exactly like this inside your response:

\`\`\`json
{
  "type": "correction_proposal",
  "field": "<field_name>",
  "currentValue": "<current_value>",
  "proposedValue": "<new_value>",
  "reason": "User requested correction",
  "requiresConfirmation": true
}
\`\`\`

   - Valid field_name options: name, documentNumber, fatherName, gender, address, dateOfBirth, issueDate, expiryDate, documentType, documentName, or any relevant field key.
   - Do NOT modify the database automatically; corrections require explicit user confirmation via the proposal.`;

const DEFAULT_NVIDIA_MODEL = 'meta/llama-3.2-11b-vision-instruct';
const NVIDIA_CHAT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Formats conversation messages for NVIDIA Chat Completions API.
 */
function prepareChatMessages(systemPrompt, history, currentMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  if (Array.isArray(history)) {
    const recent = history.slice(-6);
    for (const msg of recent) {
      if (msg.role && msg.content && String(msg.content).trim()) {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: String(msg.content).trim(),
        });
      }
    }
  }

  messages.push({
    role: 'user',
    content: currentMessage.trim(),
  });

  return messages;
}

/**
 * Calls NVIDIA NIM Chat Completions API with dedicated ASSISTANT_NVIDIA_API_KEY.
 */
async function callNvidiaChatApi(apiKey, model, messages, options = {}) {
  const timeoutMs = options.timeoutMs || 40000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 800,
    };

    const res = await fetch(NVIDIA_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Process Chat Message
 * POST /api/assistant/chat
 */
const processChatMessage = async (req, res) => {
  const reqReceivedTime = Date.now();
  const requestId = req.headers['x-request-id'] || req.body?.requestId || ('srv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

  console.log(`[ASSISTANT_PROVIDER] NVIDIA`);
  console.log(`[ASSISTANT_REQUEST] /api/assistant/chat`);
  console.log(`[ASSISTANT][SERVER] REQUEST_RECEIVED request_id=${requestId}`);

  try {
    const userId = req.user?.userId || req.user?.id || req.headers['x-user-id'];
    const { message, documentId, conversationHistory = [] } = req.body;

    if (!userId) {
      return errorResponse(res, 'Authentication required', 401);
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return errorResponse(res, 'Message is required', 400);
    }

    let documentContextStr = '';
    let docObj = null;

    if (documentId) {
      docObj = await prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!docObj) {
        return errorResponse(res, 'Document not found', 404);
      }

      if (docObj.userId !== userId) {
        console.warn(`[SECURITY] Unauthorized document chat attempt by user ${userId} on document ${documentId}`);
        return errorResponse(res, 'Access denied: You do not own this document', 403);
      }

      let fieldsObj = {};
      if (docObj.fields) {
        try {
          fieldsObj = typeof docObj.fields === 'string' ? JSON.parse(docObj.fields) : docObj.fields;
        } catch {
          fieldsObj = {};
        }
      }

      const contextData = {
        documentId: docObj.id,
        documentType: docObj.documentType,
        documentName: docObj.documentName,
        extractedFields: {
          documentNumber: docObj.documentNumber || fieldsObj.documentNumber || fieldsObj.panNumber || fieldsObj.aadhaarNumber || null,
          name: docObj.name || fieldsObj.name || null,
          fatherName: docObj.fatherName || fieldsObj.fatherName || null,
          gender: docObj.gender || fieldsObj.gender || null,
          address: docObj.address || fieldsObj.address || null,
          dateOfBirth: docObj.dateOfBirth || fieldsObj.dateOfBirth || fieldsObj.dob || null,
          issueDate: docObj.issueDate || fieldsObj.issueDate || null,
          expiryDate: docObj.expiryDate || fieldsObj.expiryDate || null,
          ...fieldsObj,
        },
      };

      documentContextStr = '\n\nCURRENT DOCUMENT CONTEXT:\n' + JSON.stringify(contextData, null, 2);
    }

    // Read dedicated ASSISTANT_NVIDIA_API_KEY and sanitize any surrounding quotes
    const rawKey = process.env.ASSISTANT_NVIDIA_API_KEY || '';
    const apiKey = rawKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      console.warn('[ASSISTANT] ASSISTANT_NVIDIA_API_KEY is not configured in backend environment.');
      return errorResponse(res, 'AI Assistant is not configured. Please set ASSISTANT_NVIDIA_API_KEY in backend.', 500);
    }

    const model = (process.env.ASSISTANT_NVIDIA_MODEL || '').trim() || DEFAULT_NVIDIA_MODEL;
    const systemPromptWithContext = SYSTEM_PROMPT + documentContextStr;
    const messages = prepareChatMessages(systemPromptWithContext, conversationHistory, message);

    console.log('[ASSISTANT_NVIDIA] REQUEST_RECEIVED');
    console.log(`[ASSISTANT_NVIDIA] MODEL=${model}`);

    const nvidiaReqStart = Date.now();
    console.log(`[ASSISTANT][NVIDIA_CHAT] REQUEST_START request_id=${requestId} model=${model}`);
    console.log('[ASSISTANT_NVIDIA] NVIDIA_REQUEST_START');

    let nvidiaRes;
    try {
      nvidiaRes = await callNvidiaChatApi(apiKey, model, messages, { timeoutMs: 40000 });
    } catch (apiErr) {
      const errElapsed = Date.now() - nvidiaReqStart;
      console.error(`[ASSISTANT][NVIDIA_CHAT] API Call Exception (+${errElapsed}ms):`, apiErr.message);
      console.log(`[ASSISTANT_NVIDIA] NVIDIA_RESPONSE_STATUS=0`);
      console.log(`[ASSISTANT_NVIDIA] NVIDIA_RESPONSE_TIME_MS=${errElapsed}`);
      console.log(`[ASSISTANT_NVIDIA] NVIDIA_RESPONSE_SUCCESS=false`);
      const backendStatus = apiErr.name === 'AbortError' ? 504 : 502;
      console.log(`[ASSISTANT_NVIDIA] BACKEND_RESPONSE_STATUS=${backendStatus}`);
      if (apiErr.name === 'AbortError') {
        return errorResponse(res, 'AI Assistant request timed out. Please try again.', 504);
      }
      return errorResponse(res, 'AI Assistant network error. Please try again.', 502);
    }

    const responseReceivedTime = Date.now();
    const elapsedMs = responseReceivedTime - nvidiaReqStart;
    console.log(`[ASSISTANT][NVIDIA_CHAT] RESPONSE_RECEIVED status=${nvidiaRes.status} elapsed_ms=${elapsedMs}`);
    console.log(`[ASSISTANT_NVIDIA] NVIDIA_RESPONSE_STATUS=${nvidiaRes.status}`);
    console.log(`[ASSISTANT_NVIDIA] NVIDIA_RESPONSE_TIME_MS=${elapsedMs}`);
    console.log(`[ASSISTANT_NVIDIA] NVIDIA_RESPONSE_SUCCESS=${nvidiaRes.ok}`);

    if (!nvidiaRes.ok) {
      const errStatus = nvidiaRes.status;
      let errDetail = 'NVIDIA API Error';
      try {
        const errText = await nvidiaRes.text();
        const j = JSON.parse(errText);
        errDetail = (typeof j.error === 'string' ? j.error : j.error?.message) || j.message || errText.substring(0, 150);
      } catch {}
      console.warn(`[ASSISTANT][NVIDIA_CHAT] Request failed (HTTP ${errStatus}): ${errDetail}`);

      let userErrorMsg = 'AI Assistant is temporarily busy. Please try again.';
      if (errStatus === 401 || errStatus === 403) {
        userErrorMsg = 'AI Assistant authentication failed. Please verify your NVIDIA API key.';
      } else if (errStatus === 404) {
        userErrorMsg = 'Configured NVIDIA model was not found. Please verify available models.';
      } else if (errStatus === 429) {
        userErrorMsg = 'NVIDIA AI rate limit reached. Please wait a moment and try again.';
      } else if (errStatus >= 500) {
        userErrorMsg = 'NVIDIA AI service is temporarily unavailable. Please try again shortly.';
      }

      const totalDuration = Date.now() - reqReceivedTime;
      console.log(`[ASSISTANT][NVIDIA_CHAT] TOTAL_TIME_MS=${totalDuration}`);
      console.log(`[ASSISTANT_NVIDIA] BACKEND_RESPONSE_STATUS=${errStatus}`);
      return errorResponse(res, userErrorMsg, errStatus);
    }

    const nvidiaData = await nvidiaRes.json();
    let rawReply = '';
    if (nvidiaData?.choices?.[0]?.message?.content) {
      rawReply = nvidiaData.choices[0].message.content;
    } else {
      rawReply = 'I could not generate a reply.';
    }

    // Extract JSON correction proposal if present
    let proposal = null;
    const jsonMatch = rawReply.match(/```json\s*([\s\S]*?)\s*```/) || rawReply.match(/(\{[\s\S]*?"type"\s*:\s*"correction_proposal"[\s\S]*?\})/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.type === 'correction_proposal' && parsed.field && parsed.proposedValue) {
          proposal = parsed;
        }
      } catch (jsonErr) {
        console.warn('[ASSISTANT] Failed to parse proposal JSON:', jsonErr.message);
      }
    }

    // Clean reply text (remove thought blocks, markdown code fences, and raw json proposal blocks)
    let cleanReply = rawReply
      .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
      .replace(/```json[\s\S]*?```/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\{[\s\S]*?"type"\s*:\s*"correction_proposal"[\s\S]*?\}/g, '')
      .trim();

    if (!cleanReply && proposal) {
      cleanReply = `I have created a correction proposal to update your document's ${proposal.field} to "${proposal.proposedValue}". Please review and confirm the change below.`;
    }

    const totalDuration = Date.now() - reqReceivedTime;
    console.log(`[ASSISTANT][NVIDIA_CHAT] TOTAL_TIME_MS=${totalDuration}`);
    console.log(`[ASSISTANT][SERVER] RESPONSE_SENT request_id=${requestId} status=200 elapsed_ms=${totalDuration}`);
    console.log('[ASSISTANT_NVIDIA] BACKEND_RESPONSE_STATUS=200');

    return successResponse(res, {
      reply: cleanReply,
      proposal,
      documentId: documentId || null,
    }, 'Chat response generated');

  } catch (error) {
    const errTime = Date.now();
    const elapsed = errTime - reqReceivedTime;
    console.error(`[ASSISTANT][NVIDIA_CHAT] ERROR (+${elapsed}ms):`, error.message);
    console.log(`[ASSISTANT][NVIDIA_CHAT] TOTAL_TIME_MS=${elapsed}`);
    console.log('[ASSISTANT_NVIDIA] BACKEND_RESPONSE_STATUS=500');
    return errorResponse(res, 'AI Assistant is temporarily unavailable. Please try again.', 500);
  }
};

module.exports = {
  processChatMessage,
};
