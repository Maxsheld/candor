# Candor README

Candor is a journaling app built around conversational reflection, continuity across sessions, and closure. It keeps track of who you are and what you've been working through.

The goal was to build something more deliberate: a place to think through something, close the session when you are done, and carry only the most useful context into the next reflection.

## Demo

- Loom walkthrough: Coming soon!

## Why I built it this way

A lot of AI chat products are designed to keep the conversation going forever. I wanted Candor to do the opposite.

Candor is built around the idea that reflection should eventually lead somewhere. That shaped a few decisions early on:

- only one active reflection can exist at a time
- ended sessions become read-only
- memory updates happen after the session, not during it
- the app uses structured memory and recent summaries instead of RAG

I originally considered using pgvector because I used it in my previous project. I ended up dropping it after realizing that this problem didn't need retrieval. Reflection is more chronological than semantic. Pulling in an isolated thought from months ago felt less useful than carrying forward a profile and a short recent history.

## How it works

![Candor Diagram](./diagram.png)

### 1. Auth and session handling

Route protection runs at the middleware level, so unauthorized access never reaches the page.

### 2. What happens when a message is sent

Once the first message is submitted, the app creates the conversation, stores the user message, and prepares the context for the model.

From there, the flow is straightforward:

- the user message is saved first
- the user's profile and recent session summaries are fetched in parallel
- that context is injected into the system prompt
- the assistant response streams back to the UI
- the assistant message is saved after the stream finishes

The title is generated separately in the background after the first message so the conversation can start immediately.

### 3. Memory model

Candor keeps continuity across sessions with two layers:

**Core profile**  
A structured JSON object stored in Supabase. This holds longer-term context like baseline identity, key insights, and unresolved commitments.

**Recent summaries**  
The app also fetches the three most recent session summaries using simple SQL ordering.

That combination gives the next reflection enough continuity to feel grounded without turning the system into a retrieval problem.

### 4. Ending a reflection

When the user clicks **End Reflection**, the conversation is marked as `ended`, the input is locked, and it becomes read-only.

That action also triggers an n8n webhook that handles the post-session memory processing in the background:

- one branch acts as a strict JSON state-manager. It reads the session's transcript and updates the user's profile based on hard rules.
- the other summarizes the transcript into a dense paragraph specifically written for the next session's AI instance.

This keeps the live chat responsive while still letting the app build memory over time.

## Tech stack

**Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Lucide, react-hot-toast, react-markdown

**AI layer:** Vercel AI SDK (streaming), Google Gemini Flash/Flash Lite (low latency on a free tier)

**Data and auth:** Supabase (PostgreSQL + Auth)

**Background processing:** n8n  (handles post-session memory updates)

## Tradeoffs and current limitations

This project was built as an MVP under free-tier constraints, so a few choices were intentional tradeoffs.

### Local n8n dependency for memory

The main one is memory processing.

Candor's post-session memory update currently depends on a locally running n8n workflow. I chose n8n because I was already familiar with it from my previous project, and because it was a better fit than trying to force a possibly longer background workflow through Vercel's free tier limits.

If n8n is not running, the core chat still works, but memory updates do not.

For production, I would move that workflow into a hosted background job setup.

### Background persistence after streaming

The assistant response is saved after the stream completes. That helps the interface stay responsive, but it also means persistence is not yet wrapped in a more durable retry system.

### Simple UI decisions

A few UI choices are intentionally basic. I kept those simple so I could spend more time on the conversation flow and memory architecture.

## What I learned

Most of this stack was new to me going into it. The learning curve was steep, and some parts took longer to understand than others. Building Candor required me to hard-stop a few times and go study properly until I felt comfortable to move forward again. That eventually became a great habit, and it made me start understanding what a tool is actually for before reaching for it, leading me to the biggest decision I had to make mid-project.

My original plan had three layers: core profile, recency, and RAG. The first two were straightforward, but RAG wasn't. I had a reasonable approach: treat each session summary as its own chunk, write tight retrieval instructions, and keep it from hallucinating connections that weren't there, but the harder problem was the trigger. The cleanest option was running every prompt through a lightweight model to decide if retrieval was necessary. That would have meant doubling API calls on a free tier, which wasn't viable. Keyword matching was an alternative, but felt rough and hard to justify.

After considerable frustration, I realized that my fundamentals were wrong. RAG can be useful when the system needs to retrieve context reliably. It's a "clean" problem with a "clean" solution. Human context isn't clean though, and Candor didn't need to dig for isolated fragments in order to have understanding over time.

## Local Setup

If you want to run Candor locally, you'll need a Supabase project, a Google Gemini API key, and a local instance of n8n.

**1. Clone the repo and install dependencies**
```bash
git clone https://github.com/Maxsheld/candor.git
cd candor
npm install
```

**2. Environment Variables**
Rename `.env.example` to `.env.local` and add your API keys.

**3. Database Setup (Supabase)**
Run the SQL script provided in `database.sql` in your Supabase SQL Editor. This will generate the `conversations`, `messages`, `user_profiles`, and `session_summaries` tables, along with the necessary RLS policies and the blank profile trigger.

**4. Background Agents (n8n)**
Import the `n8n-workflow.json` file into your local n8n instance. Add your Supabase and Gemini credentials to the n8n nodes, and activate the workflow. Copy the Production Webhook URL and paste it into your `.env.local` file as `N8N_WEBHOOK_URL`.

**5. Run the app**
```bash
npm run dev
```
