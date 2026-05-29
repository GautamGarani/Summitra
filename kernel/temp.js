// STANDARD SUPABASE IMPORTS
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

function safeNumber(value) {

    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : "NON_NUMERIC_DATA_DETECTED";
}

const allowedUsers = [
    "gautamgarani.cs@summitra",
    "admin@summitra",
    "tester@summitra"
];

serve(async (req) => {

    if (req.method === "OPTIONS") {

        return new Response("ok", {
            headers: corsHeaders,
        });
    }

    try {

        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") || "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
        );


        const body = await req.json();

        const userId = body?.userId;

        if (!userId) {

            return new Response(
                JSON.stringify({
                    error: "Missing user ID"
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json"
                    },
                    status: 400
                }
            );
        }

        if (!allowedUsers.includes(userId)) {

            return new Response(
                JSON.stringify({
                    error: "You are not eligible to use Mitraa diagnostics."
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json"
                    },
                    status: 403
                }
            );
        }


        const {
            data: rawSessions,
            error: sessionError
        } = await supabaseClient
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
            .eq("owner", userId)
            .order("session_id", {
                ascending: false
            })
            .limit(5);

        if (sessionError) {

            throw new Error(
                `Session fetch failed: ${sessionError.message}`
            );
        }

        if (!rawSessions || rawSessions.length === 0) {

            return new Response(
                JSON.stringify({
                    responseText:
                        "- **No posture telemetry exists yet.** Start a live monitoring session to generate analytics and AI diagnostics."
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json"
                    },
                    status: 200
                }
            );
        }

        const maskedTelemetry = rawSessions.map((s, idx) => ({

            virtual_record:
                `VIRTUAL_RECORD_${idx + 1}`,

            duration_minutes:
                safeNumber(
                    Math.round(
                        (Number(s.duration) || 0) / 60
                    )
                ),

            compliance:
                safeNumber(s.compliance),

            ergonomic_debt:
                safeNumber(s.ergonomic_debt),

            proprioception:
                safeNumber(s.proprio_score),

            violations: {

                lateral:
                    safeNumber(s.lateral_alerts),

                slouch:
                    safeNumber(s.slouch_alerts),

                multiple:
                    safeNumber(s.multiple_alerts),

                forward:
                    safeNumber(s.forward_alerts),
            }
        }));


        const apiKey =
            Deno.env.get("GEMINI_API_KEY");

        if (!apiKey) {

            throw new Error(
                "Missing GEMINI_API_KEY secret in Supabase Edge Function"
            );
        }

        const targetModelApi =
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const prompt = `
You are a posture analytics engine.

Return concise ergonomic diagnostics only.

Analyze the following posture telemetry data and generate EXACTLY 3 markdown bullet diagnostic statements.

STRICT REQUIREMENTS:
- Start every line with "-"
- Use markdown bold formatting
- Speak conversationally
- Be encouraging
- Focus on posture metrics and trends
- Mention compliance trends, posture violations, fatigue patterns, or telemetry irregularities
- Maximum 2 sentences per bullet
- Use understandable language
- If invalid telemetry values exist, mention telemetry irregularities
- Do NOT hallucinate values
- Each bullet must contain at least 20 words

Telemetry Data:
${JSON.stringify(maskedTelemetry, null, 2)}
`;

        // GEMINI REQUEST
        const rawInferenceChannel =
            await fetch(targetModelApi, {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    contents: [{

                        role: "user",

                        parts: [{

                            text: prompt
                        }]
                    }],

                    generationConfig: {

                        temperature: 0.2,

                        maxOutputTokens: 1200
                    }
                })
            });

        // HANDLE GEMINI FAILURE
        // READ BODY ONCE
        const rawText = await rawInferenceChannel.text();

        // HANDLE FAILURE
        if (!rawInferenceChannel.ok) {

            if (rawInferenceChannel.status === 429) {

                return new Response(
                    JSON.stringify({
                        responseText:
                            "- **AI diagnostics temporarily unavailable.** Free-tier Gemini quota exhausted. Please retry shortly."
                    }),
                    {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json"
                        },
                        status: 200
                    }
                );
            }

            throw new Error(
                `Gemini API Error: ${rawText}`
            );
        }

        // PARSE JSON
        let outputJson;

        try {

            outputJson = JSON.parse(rawText);

        } catch {

            throw new Error(
                `Invalid Gemini JSON Response: ${rawText}`
            );
        }

        // EXTRACT RESPONSE
        const cleanEvaluationString =
            outputJson?.candidates?.[0]
                ?.content?.parts?.[0]?.text
            ||
            "- **Analysis engine returned empty diagnostics.** Try refreshing analytics again.";

        // SUCCESS RESPONSE
        return new Response(

            JSON.stringify({
                responseText:
                    cleanEvaluationString
            }),

            {
                headers: {
                    ...corsHeaders,
                    "Content-Type":
                        "application/json"
                },

                status: 200
            }
        );

    } catch (error) {

        console.error(
            "EDGE FUNCTION FAILURE:",
            error
        );

        return new Response(

            JSON.stringify({
                error:
                    error.message ||
                    "Unknown server error"
            }),

            {
                headers: {
                    ...corsHeaders,
                    "Content-Type":
                        "application/json"
                },

                status: 500
            }
        );
    }
});