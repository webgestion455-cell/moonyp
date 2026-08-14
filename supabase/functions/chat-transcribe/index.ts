// Speech-to-Text via Lovable AI Gateway (openai/gpt-4o-transcribe)
// The client sends multipart/form-data with `file` (audio blob).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const inbound = await req.formData();
    const file = inbound.get("file");
    if (!(file instanceof File) && !(file instanceof Blob)) {
      throw new Error("Missing `file` field");
    }
    const outbound = new FormData();
    outbound.append("model", "openai/gpt-4o-transcribe");
    // Name defaults to .wav to avoid Safari-mp4 mismatch on the client
    outbound.append("file", file, (file as File).name ?? "recording.wav");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outbound,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return new Response(JSON.stringify({ error: `STT failed: ${res.status} ${txt}` }), {
        status: res.status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const json = await res.json();
    return new Response(JSON.stringify({ text: json.text ?? "", language: json.language ?? null }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
