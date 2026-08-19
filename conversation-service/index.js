// ============================================================================
// MITRAA — SECURE SUPABASE AI CONVERSATIONAL CHAT SERVICE
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL =
    Deno.env.get("SUPABASE_URL") || "";

const SUPABASE_ANON_KEY =
    Deno.env.get("SUPABASE_ANON_KEY") || "";

const GROQ_API_KEY =
    Deno.env.get("GROQ_API_KEY") || "";

const GROQ_ENDPOINT =
    "https://api.groq.com/openai/v1/chat/completions";

const MODEL =
    "openai/gpt-oss-120b";

// ============================================================================
// CORS
// ============================================================================

const allowedOrigins = [
    "https://summitra-smartopia.vercel.app",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
];

function getCorsHeaders(req) {
    const origin = req.headers.get("Origin");
    const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : "null";
    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

// ============================================================================
// RESPONSE HELPER
// ============================================================================

function jsonResponse(req, body, status = 200) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                ...getCorsHeaders(req),
                "Content-Type": "application/json"
            }
        }
    );
}

// ============================================================================
// TELEMETRY SANITIZATION
// ============================================================================

function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : "NON_NUMERIC_DATA_DETECTED";
}

// ============================================================================
// BUILD AI TELEMETRY CONTEXT
// ============================================================================

function buildTelemetryContext(sessions) {
    const chronological = [...sessions].reverse();
    return chronological.map((session, index) => ({
        record: `SESSION_${index + 1}`,
        duration_minutes: safeNumber(Math.round((Number(session.duration) || 0) / 60)),
        compliance: safeNumber(session.compliance),
        ergonomic_debt: safeNumber(session.ergonomic_debt),
        proprioception: safeNumber(session.proprio_score),
        violations: {
            lateral: safeNumber(session.lateral_alerts),
            forward: safeNumber(session.forward_alerts),
            slouch: safeNumber(session.slouch_alerts),
            multiple: safeNumber(session.multiple_alerts)
        }
    }));
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(telemetry, action) {
    let telemetryContext = "No posture telemetry is available yet. The user has not recorded any sessions.";
    if (telemetry && telemetry.length > 0) {
        telemetryContext = JSON.stringify(telemetry, null, 2);
    }

    return `
You are Mitraa, the posture intelligence assistant inside the Summitra wellness platform.
You help the authenticated user understand their posture telemetry, build better ergonomic habits, and answer wellness or health questions.

USER TELEMETRY DATA:
${telemetryContext}

STRICT INSTRUCTIONS:
1. CUSTOMER IDENTITY & SECURITY:
   - Never expose database details, Supabase configurations, user IDs, raw UUIDs, emails, API keys, or backend secrets.
   - Do not refer to internal record names like "SESSION_1" in user facing text; talk about sessions generally (e.g. "your last session", "a session from earlier").
2. CONVERSATIONAL FLEXIBILITY:
   - You can handle greetings, platform questions, general posture/ergonomic advice, and general conversation.
   - If the user asks general questions, answer them using your general knowledge without forcing telemetry references.
   - If the user asks about their specific posture metrics, compliance, or violations, refer to the USER TELEMETRY DATA provided above. If they have no telemetry, guide them to start a live session to begin tracking.
3. SEMANTIC CLARITY:
   - Compliance represents the user's posture-performance score (higher is better).
   - Proprioception represents posture-awareness (higher is better).
   - Ergonomic debt represents estimated recovery time (lower is better).
   - If compliance is 0 OR proprioception is 40, explain that the session was stopped during calibration, and invite them to perform a full monitoring session.
4. MEDICAL DISCLAIMER:
   - Posture metrics are for wellness guidance and do not constitute a medical diagnosis. Never diagnose the user.
5. FORMATTING:
   - Respond in professional, clean markdown. Keep your conversational answers concise and structured.
   - Use bullet points, bold text, or lists when explaining metrics to make it easy to scan.
`;
}

// ============================================================================
// GROQ REQUEST
// ============================================================================

async function askGroq(systemPrompt, messagesArray) {
    const messages = [
        {
            role: "system",
            content: systemPrompt
        },
        ...messagesArray
    ];

    const response = await fetch(
        GROQ_ENDPOINT,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL,
                messages: messages,
                temperature: 0.3,
                max_completion_tokens: 2000,
                reasoning_effort: "low"
            })
        }
    );

    const rawText = await response.text();

    console.log("Groq HTTP status:", response.status);

    if (!response.ok) {
        console.error("GROQ API ERROR:", response.status, rawText);
        if (response.status === 429) {
            return { rateLimited: true };
        }
        throw new Error(`Groq API Error: ${rawText}`);
    }

    let result;
    try {
        result = JSON.parse(rawText);
    } catch {
        throw new Error("Groq returned invalid JSON");
    }

    const choice = result?.choices?.[0];
    if (!choice || !choice.message) {
        throw new Error("Groq returned empty completion");
    }

    let text = choice.message.content;
    if (Array.isArray(text)) {
        text = text.map(part => typeof part === "string" ? part : part?.text || "").join("").trim();
    }

    if (typeof text !== "string" || !text.trim()) {
        const fallback = choice?.text || result?.output_text;
        if (typeof fallback === "string" && fallback.trim()) {
            text = fallback.trim();
        } else {
            throw new Error("Groq returned empty response");
        }
    }

    return {
        rateLimited: false,
        text: text.trim()
    };
}

// ============================================================================
// MAIN EDGE FUNCTION
// ============================================================================

serve(async (req) => {
    // CORS PREFLIGHT
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            status: 200,
            headers: getCorsHeaders(req)
        });
    }

    // METHOD VALIDATION
    if (req.method !== "POST") {
        return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    try {
        // ENVIRONMENT VALIDATION
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error("Supabase environment variables are not configured");
        }
        if (!GROQ_API_KEY) {
            throw new Error("Missing GROQ_API_KEY secret");
        }

        // AUTHORIZATION HEADER
        const authorization = req.headers.get("Authorization");
        if (!authorization || !authorization.startsWith("Bearer ")) {
            return jsonResponse(req, { error: "Unauthorized: missing Bearer token" }, 401);
        }

        // USER-SCOPED SUPABASE CLIENT
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: {
                headers: { Authorization: authorization }
            }
        });

        // VERIFY AUTHENTICATED USER
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            console.error("AUTHENTICATION ERROR:", authError?.message || "No authenticated user");
            return jsonResponse(req, { error: "Unauthorized: invalid or expired session" }, 401);
        }

        // PARSE REQUEST
        let body;
        try {
            body = await req.json();
        } catch {
            return jsonResponse(req, { error: "Invalid JSON request" }, 400);
        }

        // EXTRACT QUERY OR HISTORY WITH STRICT INPUT LIMITATION & SANITIZATION
        let messagesPayload = [];
        if (Array.isArray(body?.messages)) {
            // Strict security limitation: limit history to the last 15 messages to prevent payload inflation / DoS attacks.
            const slicedMessages = body.messages.slice(-15);
            messagesPayload = slicedMessages
                .filter(m => typeof m?.content === "string" && m.content.trim().length > 0)
                .map(m => ({
                    role: m.role === "assistant" ? "assistant" : "user",
                    content: String(m.content).trim().slice(0, 4000)
                }));
            
            if (messagesPayload.length === 0) {
                return jsonResponse(req, { error: "Messages array must contain non-empty message strings" }, 400);
            }
        } else if (typeof body?.message === "string" && body.message.trim()) {
            messagesPayload = [{ role: "user", content: body.message.trim().slice(0, 4000) }];
        } else {
            return jsonResponse(req, { error: "Either a non-empty 'messages' array or a non-empty 'message' string is required" }, 400);
        }

        // FETCH AUTHENTICATED USER'S SESSIONS (UP TO 10)
        const { data: sessions, error: sessionError } = await supabase
            .from("sessions")
            .select(`
                duration,
                compliance,
                proprio_score,
                ergonomic_debt,
                lateral_alerts,
                forward_alerts,
                slouch_alerts,
                multiple_alerts
            `)
            .eq("user_id", user.id)
            .order("session_id", { ascending: false })
            .limit(10);

        if (sessionError) {
            console.error("SESSION QUERY ERROR:", sessionError);
            throw new Error(`Session fetch failed: ${sessionError.message}`);
        }

        // BUILD AI CONTEXT
        const telemetry = sessions && sessions.length > 0 ? buildTelemetryContext(sessions) : [];

        // RUN AI CONVERSATION
        const systemPrompt = buildSystemPrompt(telemetry, "conversational");
        const result = await askGroq(systemPrompt, messagesPayload);

        // RATE LIMIT CHECK
        if (result.rateLimited) {
            return jsonResponse(req, {
                responseText: "Mitraa is temporarily unavailable because the AI service has reached its quota. Please try again shortly."
            }, 200);
        }

        // SUCCESS
        return jsonResponse(req, {
            responseText: result.text,
            telemetrySessions: telemetry.length
        }, 200);

    } catch (error) {
        console.error("CONVERSATION SERVICE FAILURE:", error);
        return jsonResponse(req, {
            error: error instanceof Error ? error.message : "Unknown server error"
        }, 500);
    }
});
