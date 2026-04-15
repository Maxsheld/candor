import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages } from 'ai';
import { UNIVERSAL_SYSTEM_PROMPT } from '@/lib/prompts';
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    // currentConversationId is renamed to conversation_id on destructure for cleaner usage below.
    const { messages, currentConversationId: conversation_id } = await req.json();
    const supabase = await createClient();

    // getUser() validates the session token server-side — safer than trusting client-sent user data.
    const { data: { user }, error } = await supabase.auth.getUser();

    if (!user) {
      console.error("Supabase Error:", error);
      return new Response(JSON.stringify({ error: "Check your credentials" }), { status: 401 });
    }

    // .at(-1) accesses the last element of the array. Equivalent to messages[messages.length - 1].
    // We only need the last message because that's the one the user just sent.
    const last_message = messages.at(-1).parts[0].text

    // Save the user's message before streaming starts.
    const { data: messageData, error: messageError } = await supabase
      .from("messages")
      .insert({ "conversation_id": conversation_id, "content": last_message, "role": "user" })

    // Fetches the user's profile and recent session summaries in parallel to include in the system prompt context.
    const [{ data: profileData, error: profileError }, {data: summariesData, error: summariesError }] = await Promise.all([
      supabase.from("user_profiles").select("profile_json").eq("id", user.id).single(),
      supabase.from("session_summaries").select("summary_text").eq("user_id", user.id).order("created_at", { ascending: false }).limit(3)
    ])
  
    const summaries = !summariesData ? "No summaries provided" : summariesData.map(s => s.summary_text).join("\n")
    const profile = !profileData ? "No profile provided" : JSON.stringify(profileData.profile_json)
    
    const system_prompt = `
    ${UNIVERSAL_SYSTEM_PROMPT}

    **[USER PROFILE]**
    ${profile}

    ---

    **[PAST SESSION SUMMARIES]**
    ${summaries}
    `


    // convertToModelMessages transforms the Vercel AI SDK's UIMessage format into
    // the format the Gemini model expects. Must be awaited — returns a Promise.
    const modelMessages = await convertToModelMessages(messages);

    const result = await streamText({
      model: google('gemini-2.5-flash-lite'),
      messages: modelMessages,
      system: system_prompt
    });

    // Fire-and-forget: result.text resolves when the full stream is complete.
    // We don't await it here because we need to return the stream to the client immediately.
    // The AI message is saved to the DB in the background after streaming finishes.
    result.text.then(async text => {
      const { data, error } = await supabase
        .from("messages")
        .insert({ "conversation_id": conversation_id, "content": text, "role": "assistant" })

      console.log(error)
    })

    return result.toUIMessageStreamResponse();
    
  } catch (error) {
    console.error("API Route Error:", error);
    return new Response(JSON.stringify({ error: "Check server logs" }), { status: 500 });
  }
}