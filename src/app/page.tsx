"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from '@ai-sdk/react';
import { createClient } from "@/lib/supabase/client";
import { toast } from "react-hot-toast";
import Sidebar from "@/components/Sidebar";
import MessageList from "@/components/MessageList";
import MessageInput from "@/components/MessageInput";
import { Conversation } from "@/types";


export default function Home() {

  const router = useRouter();
  const [input, setInput] = useState("");
  const [pastConversations, setPastConversations] = useState<Conversation[]>([]);
  const [isSidebarLoading, setIsSidebarLoading] = useState(false)
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [isEndingSession, setIsEndingSession] = useState(false)
  

  const { status, messages, sendMessage, setMessages } = useChat({
    // onFinish fires after every completed stream. We only want to re-fetch
    // the sidebar on the first exchange (messages.length === 2) to pick up
    // the AI-generated title, which gets written to the DB in the background.
    onFinish: () => {
      if (messages.length === 2) {
        fetchConversations()
      }      
    },
    onError: (error) => {
      toast.error(error.message)
    }
  });

  // null means we're in a fresh, unsaved chat state.
  // The conversation row only gets created when the user sends the first message.
  const [conversation_id, setConversation_id] = useState<string | null>(null);

  // Derived from pastConversations instead of a separate state variable.
  // This way it always stays in sync with the sidebar data automatically.
  const isConversationEnded = pastConversations.find(c => c.id === conversation_id)?.status === "ended"

  // Global check. Not just whether the current view is active, but whether
  // any active conversation exists for this user at all.
  // This is what gates the "New Reflection" button.
  const hasActiveConversation = !!pastConversations.find(c => c.status === "active")

  // Defined as a standalone function so it can be called from multiple places:
  // on mount, after creating a new conversation, after ending one, after deleting one.
  const fetchConversations = async () => {
    setIsSidebarLoading(true);
    const response = await fetch("/api/conversations", {
      method: "GET"        
    });
    const data = await response.json();
    setPastConversations(data.conversations ?? []);
    setIsSidebarLoading(false);
  }

  // Populate the sidebar on initial load.
  useEffect(() => {    
    fetchConversations()    
  }, [])


  const handleSelectConversation = async (id: string) => {
    setIsMessagesLoading(true);
    const response = await fetch(`/api/messages?conversation_id=${id}`, {
      method: "GET"
    });
    const data = await response.json();
    setInput("");

    // DB rows come back as { role, content }. The SDK expects a different shape:
    // each message needs an id and a parts array with { type, text }.
    const formattedMessages = data.messages.map((message: { role: string; content: string }) => {
      return {
        id: crypto.randomUUID(),
        role: message.role,
        parts: [{ type: "text", text: message.content }]
      }      
    })

    setMessages(formattedMessages);
    setConversation_id(id);
    setIsMessagesLoading(false);
  }

  const handleEndSession = async () => {
    try{
      setIsEndingSession(true);
      const response = await fetch(`/api/conversations?conversation_id=${conversation_id}`, {
        method: "PATCH"
      });

      if (!response.ok) {
        toast.error("Failed to end the reflection. Please try again.");
        return;
      }

      toast.success("Your reflection is being processed.");
      // Re-fetch so the sidebar and input area reflect the new "ended" status.
      fetchConversations();
    }
    catch (error) {
      console.error("Error ending session:", error);
      toast.error("An unexpected error occurred. Please try again.");
    }
    finally {
      // finally guarantees the spinner turns off whether the request succeeded or failed.
      setIsEndingSession(false);
    }
  }

  const handleDeleteConversation = async (id: string) => {
    // Native browser confirm, good enough for an MVP.
    if (!confirm("Are you sure you want to delete this reflection? This action cannot be undone.")) {
      return;
    }
    
    const response = await fetch(`/api/conversations?conversation_id=${id}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      toast.error("Failed to delete the conversation. Please try again.")
      return;
    } 

    // If the user deleted the currently active conversation, reset to a blank state.
    if (id === conversation_id) {
      handleNewChat();
    }
    fetchConversations();
  }

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Resets the UI to a blank state without navigating anywhere.
  // Setting conversation_id to null is what tells handleSendMessage
  // to create a new conversation row on the next send.
  const handleNewChat = () => {    
    setInput(""); 
    setConversation_id(null);
    setMessages([]);
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    // React state updates are async, if we used conversation_id directly below,
    // setConversation_id wouldn't have updated yet by the time we call sendMessage.
    // A local variable gives us the resolved ID to work with right now.
    let currentConversationId = conversation_id;

    // First message in a new chat, create the conversation row before sending anything.
    // We wait until here to create it, so we don't end up with empty
    // conversation rows if the user clicks "New Reflection" but never types anything.
    if (!currentConversationId) {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input })
      });

      const data = await response.json();
      currentConversationId = data.id;
      
      setConversation_id(data.id);
      fetchConversations();
    }

    setInput("");

    // input is read here before setInput("") takes effect, state updates are batched,
    // so input still holds the current value at this point in the function.
    await sendMessage({ text: input }, { body: { currentConversationId } });   
  };

  return (
    <div className="flex h-screen w-full bg-zinc-900 text-zinc-100">      
      <Sidebar 
        pastConversations={pastConversations}
        conversation_id={conversation_id}
        isSidebarLoading={isSidebarLoading}
        hasActiveConversation={hasActiveConversation}
        handleNewChat={handleNewChat}
        handleSelectConversation={handleSelectConversation}
        handleDeleteConversation={handleDeleteConversation}
        handleSignOut={handleSignOut}
      />
      <main className="flex-1 flex flex-col relative">
        
        <header className="h-16 border-b border-zinc-800 flex items-center px-8">
          <h1 className="font-medium">
            {pastConversations.find(c => c.id === conversation_id)?.title || "New Reflection"}
          </h1>
          { conversation_id && !isConversationEnded && (
            <button              
              disabled={ status === "submitted" || status === "streaming" || isEndingSession }
              onClick={handleEndSession}
              className="ml-auto px-4 py-1.5 bg-amber-800 rounded-full text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEndingSession ? (
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border-2 border-zinc-400 border-t-zinc-100 animate-spin" />
                  Ending...
                </span>
              ) : (
                "End Reflection"
              )}
            </button> 
            )}
        </header>
        <MessageList 
        messages={messages} 
        status={status} 
        />
        <MessageInput
          input={input}
          setInput={setInput}
          handleSendMessage={handleSendMessage}
          status={status}
          isConversationEnded={isConversationEnded}
        />
        {isMessagesLoading && (
            <div className="absolute inset-0 bg-zinc-800/70 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-zinc-600 border-t-zinc-200 animate-spin"></div>
            </div>
          )}
      </main>
    </div>  
  );
}
