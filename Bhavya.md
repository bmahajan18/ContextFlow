# ContextFlow (a.k.a. Talking Rabbitt) — The Story Behind the Code

> **"What if Excel could talk back?"**
>
> That's essentially the question this project answers. ContextFlow is a conversational intelligence tool that lets you upload a CSV file, ask it questions in plain English, and get back both answers *and* visualizations. No SQL. No pivot tables. Just you, your data, and an AI that actually understands what you're asking.

---

## The Big Picture: What Are We Building Here?

Imagine you're a sales manager staring at a spreadsheet with 10,000 rows. You want to know: *"Which region had the highest revenue in Q1?"* Normally, you'd filter columns, write a SUMIF formula, maybe build a chart. It takes 10 minutes if you're fast, 30 if you get the formula wrong (and you will).

Now imagine just typing that question into a chat box and getting the answer in 3 seconds, complete with a bar chart.

**That's ContextFlow.**

It's not just a wrapper around ChatGPT. It's a deliberately architected pipeline that:
1. Takes your raw CSV data
2. Parses and structures it
3. Sends it to a Large Language Model (LLM) with carefully crafted instructions
4. Gets back a structured JSON response with both a text answer *and* chart data
5. Renders that instantly in your browser

Think of it like having a data analyst intern who never sleeps, never gets formulas wrong, and draws charts faster than you can blink.

---

## The Architecture: How the Pieces Fit Together

Our system has three layers, like a sandwich (a very nerdy sandwich):

```
┌─────────────────────────────────────┐
│         FRONTEND (Browser)          │
│  HTML + CSS + Vanilla JavaScript    │
│  Chart.js for visualizations        │
└─────────────┬───────────────────────┘
              │ HTTP requests (fetch)
┌─────────────▼───────────────────────┐
│         BACKEND (Node.js)           │
│  Express.js server                  │
│  Multer for file uploads            │
│  PapaParse for CSV parsing          │
└─────────────┬───────────────────────┘
              │ API calls
┌─────────────▼───────────────────────┐
│      AI PROVIDERS (LLMs)            │
│  Google Gemini  │  OpenAI  │  Groq  │
└─────────────────────────────────────┘
```

### The Frontend: The Face of the Operation

**File: `public/index.html`, `public/app.js`, `public/styles.css`**

This is what users see and touch. It's intentionally simple — no React, no Vue, no build step. Just vanilla HTML, CSS, and JavaScript. Why? Because for an MVP, every layer of complexity you add is a layer of things that can break. We chose to keep it lean.

The frontend handles:
- **API Configuration**: Users pick their AI provider (Gemini, OpenAI, or Groq) and paste in their API key
- **File Upload**: Drag-and-drop CSV upload via a hidden `<input type="file">` element (styled to look like a button)
- **Question Input**: A chat-like input where you type natural language questions
- **Results Display**: Shows the AI's answer and renders charts using **Chart.js**

The UI has a dark, glassmorphism aesthetic — those frosted glass cards with blurred backgrounds. It looks modern and professional without requiring a design team.

### The Backend: The Brain's Secretary

**File: `server.js`**

This is where the magic happens. It's an **Express.js** server that acts as the middleman between the user and the AI. Think of it like a really smart secretary who:
- Takes your documents (CSV files)
- Organizes them neatly
- Writes a detailed memo to the expert (the LLM)
- Translates the expert's response back into something you can understand

**Key responsibilities:**

1. **File Handling with Multer**: When you upload a CSV, Multer saves it temporarily to the `uploads/` folder. It's like a temporary inbox for documents.

2. **CSV Parsing with PapaParse**: PapaParse reads the CSV and converts it into a JavaScript array of objects. If your CSV has headers like `Region, Product, Revenue`, PapaParse gives you `[{Region: "North", Product: "Electronics", Revenue: 45000}, ...]`. This is *crucial* because we need structured data to send to the AI.

3. **AI Provider Management**: The server can talk to three different LLMs:
   - **Google Gemini** (default) — fast, cheap, generous rate limits
   - **OpenAI GPT-4o-mini** — high quality, well-known
   - **Groq (Llama 3.3)** — blazing fast inference

4. **Prompt Engineering**: This is where the real art lives. We don't just send the raw data and hope for the best. We craft a detailed prompt that tells the AI exactly what its job is, what format to respond in, and what not to do (like making up numbers — LLMs are notorious hallucinators).

5. **Response Parsing**: The AI returns a JSON string (in theory). We parse it, extract the answer and visualization data, and send it back to the frontend.

### The Data Flow: A Journey of a Question

Let's trace what happens when you ask: *"Which region had the highest revenue?"*

```
1. You type the question in the browser
        ↓
2. Frontend sends POST /api/query { question: "Which region..." }
        ↓
3. Backend checks: Is AI configured? Is there data uploaded?
        ↓
4. Backend builds the prompt:
   "You are a data analyst assistant...
   Columns: Region, Product, Quarter, Revenue, Units
   Sample data: [16 rows of JSON]
   User is asking: 'Which region had the highest revenue?'
   Respond in JSON format with answer and visualization..."
        ↓
5. Backend sends prompt to the active LLM (e.g., Gemini)
        ↓
6. LLM thinks, then returns:
   {
     "answer": "West had the highest revenue at $61,000 in Q1...",
     "visualization": {
       "type": "bar",
       "title": "Revenue by Region",
       "labels": ["North", "South", "East", "West"],
       "values": [73000, 87000, 65000, 96000]
     }
   }
        ↓
7. Backend parses JSON, sends it to frontend
        ↓
8. Frontend displays the text answer
        ↓
9. Frontend sees visualization data, calls renderChart()
        ↓
10. Chart.js draws a beautiful bar chart
```

The entire round trip takes 2-5 seconds. Not bad for something that would take a human several minutes!

---

## The Codebase: What's Where

```
ContextFlow/
│
├── server.js              # The Express backend — heart of the system
├── package.json           # Node.js dependencies and scripts
├── vercel.json            # Deployment configuration for Vercel
├── README.md              # Project description (says "rabbittAI")
├── TODO.md                # Development log — bugs found and fixed
│
├── public/                # Frontend files (served as static assets)
│   ├── index.html         # Main UI — the glassmorphism interface
│   ├── app.js             # Frontend logic — API calls, chart rendering
│   └── styles.css         # Dark theme, glassmorphism, animations
│
├── data/                  # Sample data storage
│   └── sample-sales.csv   # Demo dataset for users to try
│
└── uploads/               # Temporary file storage (gitignored)
    └── [temporary CSVs during upload]
```

### How the Files Talk to Each Other

- **`index.html`** loads **`styles.css`** (for looks) and **`app.js`** (for behavior)
- **`app.js`** makes `fetch()` calls to **`server.js`** endpoints like `/api/upload`, `/api/query`, `/api/configure`
- **`server.js`** serves the `public/` folder as static files and handles API routes
- **`server.js`** talks to external AI APIs (Gemini, OpenAI, Groq) over the internet
- **`vercel.json`** tells Vercel how to route requests — API calls go to `server.js`, everything else goes to `public/`

---

## Technologies Used & Why We Chose Them

### 1. Express.js
**The choice:** The most popular Node.js web framework.
**Why:** It's minimal, well-documented, and has middleware for everything. We needed a server fast, not a server with opinions. Express lets you build exactly what you need without fighting the framework.

### 2. Vanilla JavaScript (No Frontend Framework)
**The choice:** No React, Vue, or Angular. Just plain JS.
**Why:** This is an MVP. Adding a frontend framework means adding a build step, a bundler, more dependencies, and more things that can break. For a single-page app with three main interactions (upload, ask, display), vanilla JS is more than enough. It's also instantly deployable — no `npm run build` needed.

### 3. Chart.js
**The choice:** A JavaScript charting library.
**Why:** It supports bar, line, pie, and more chart types out of the box. It's canvas-based, so charts are crisp and responsive. Most importantly, it's dead simple to use — create a canvas, pass in data and config, done. The AI decides what type of chart to render, and Chart.js makes it happen.

### 4. PapaParse
**The choice:** A robust CSV parser.
**Why:** CSV files are deceptively tricky. Quotes, commas inside fields, line breaks — PapaParse handles all the edge cases. It also parses directly in the browser or Node.js, which means we can validate files client-side if we wanted to (we do it server-side for security).

### 5. Multer
**The choice:** File upload middleware for Express.
**Why:** Handling file uploads manually in Node.js is painful. Multer makes it a one-liner: `upload.single('file')`. It handles multipart form data, saves files to disk, and gives you metadata like filename and size.

### 6. Three AI Providers (Gemini, OpenAI, Groq)
**The choice:** Support multiple LLMs instead of betting on one.
**Why:** 
- **Redundancy:** If one API is down, users can switch to another
- **Cost optimization:** Gemini has a generous free tier; Groq is cheap and fast; OpenAI is the gold standard
- **User preference:** Some users already have API keys for one provider
- **Future-proofing:** The AI landscape changes weekly. Being provider-agnostic is smart engineering.

---

## The Bugs We Ran Into (And How We Fixed Them)

### Bug #1: The Broken File Upload

**The symptom:** Users selected a CSV file, but nothing happened. No data loaded, no error message.

**The detective work:** Looking at `handleFileUpload()` in `app.js`, we were trying to send the file directly in the fetch request body. But HTTP requests need files to be wrapped in a `FormData` object — you can't just chuck a raw file into a `fetch()` call and expect the server to understand it.

**The fix:**
```javascript
// BEFORE (broken):
const response = await fetch('/api/upload', {
    method: 'POST',
    body: file  // ❌ Nope, servers don't understand raw File objects
});

// AFTER (fixed):
const formData = new FormData();
formData.append('file', file);
const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData  // ✅ Properly encoded multipart form data
});
```

**The lesson:** File uploads are one of those things that seem simple but have a specific protocol (multipart/form-data). Always use `FormData` for file uploads in the browser. Always.

---

### Bug #2: The Missing Provider Selection

**The symptom:** The UI only had a text input for the API key, but no way to choose between Gemini, OpenAI, or Groq. Users were stuck with whatever the default was.

**The detective work:** The backend already supported all three providers, but the frontend UI was incomplete. It was like building a car with three gears but only installing one gear shift.

**The fix:** Added radio buttons for provider selection in `index.html`:
```html
<div class="provider-select">
    <label>
        <input type="radio" name="provider" value="gemini" checked />
        <span>Google Gemini</span>
    </label>
    <label>
        <input type="radio" name="provider" value="openai" />
        <span>OpenAI</span>
    </label>
    <label>
        <input type="radio" name="provider" value="groq" />
        <span>Groq</span>
    </label>
</div>
```

And wired it up in `app.js` to read the selected provider and validate API keys based on format:
- Gemini keys start with `AIzaSy`
- OpenAI keys start with `sk-`
- Groq keys start with `gsk_`

**The lesson:** Build the UI and backend in parallel. It's easy to build a powerful backend and forget that users need buttons to access those features. Also, input validation (checking key prefixes) catches user errors before they waste an API call.

---

### Bug #3: The Groq SDK Compatibility Crisis

**The symptom:** When users selected Groq as their provider, the server crashed with a cryptic error about the Groq SDK not being compatible with Node.js 25.

**The detective work:** The Groq npm package (`groq`) had compatibility issues with newer Node.js versions. This is actually pretty common — SDKs lag behind Node releases. We were importing and using the SDK like this:
```javascript
const Groq = require('groq');
const groq = new Groq({ apiKey });
```

But the SDK's internal code was using features or APIs that Node 25 had changed or deprecated.

**The fix:** Bypass the SDK entirely and use direct HTTP API calls with `fetch`. Groq's API is OpenAI-compatible, so the endpoint and request format are identical:
```javascript
// Instead of using the SDK:
const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    })
});
```

**The lesson:** SDKs are conveniences, not requirements. When an SDK breaks, remember that it's just making HTTP calls under the hood. If you understand the API's request/response format, you can always fall back to direct HTTP calls. This is a crucial skill — never let a broken SDK block your entire feature.

Also: we still keep `groq` in `package.json` in case they fix the compatibility issue, but we don't actually use the imported module. It's a harmless dependency.

---

### Bug #4: The Gemini Rate Limiting

**The symptom:** Intermittent 429 errors (rate limiting) when using Gemini, especially during testing when making rapid queries.

**The detective work:** Google's Gemini API has rate limits. When you hit them, you get a 429 HTTP status. If you don't handle this gracefully, the user just sees a generic "Error processing query" message.

**The fix:** Implemented retry logic with exponential backoff:
```javascript
const maxRetries = 3;
for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
        const result = await GeminiModel.generateContent(prompt);
        responseText = result.response.text();
        break; // Success! Exit the loop.
    } catch (error) {
        if (error.status === 429) {
            // Wait 2s, then 4s, then 8s before retrying
            const waitTime = Math.pow(2, attempt) * 1000;
            console.log(`Rate limited. Waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
            throw error; // Non-retryable error, bail out
        }
    }
}
```

**The lesson:** External APIs will fail. Networks are unreliable, services rate-limit, and servers hiccup. Always build retry logic for API calls, especially for paid or rate-limited services. Exponential backoff (waiting 2x longer each time) is the standard approach because it gives the server breathing room while still retrying promptly.

---

### Bug #5: The JSON Parsing Roulette

**The symptom:** Sometimes the AI would return perfectly valid JSON. Other times, it would wrap JSON in markdown code blocks (```json...```) or add explanatory text around it. Our strict `JSON.parse()` would throw errors.

**The detective work:** LLMs are non-deterministic. Even with `response_format: { type: "json_object" }`, they occasionally add fluff. We needed a more robust parsing strategy.

**The fix:** Multi-layer parsing with graceful fallbacks:
```javascript
try {
    // First, try direct JSON parse
    response = JSON.parse(responseText);
} catch (parseError) {
    // Second, try to extract JSON from markdown or text
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        response = JSON.parse(jsonMatch[0]);
    } else {
        // Final fallback: just show the raw text
        response = {
            answer: responseText,
            visualization: null
        };
    }
}
```

**The lesson:** Never trust an LLM to format output exactly as you specify. Always have parsing fallbacks. The markdown-code-block wrapping is so common that you should basically always handle it. And always have a "break glass" fallback that shows the raw response rather than crashing.

---

## Deployment: Getting It Live

We deployed on **Vercel** using the `vercel.json` configuration:
```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" },
    { "src": "public/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "server.js" },
    { "src": "/(.*)", "dest": "/public/$1" }
  ]
}
```

**Why Vercel?** It's free for hobby projects, has excellent Node.js support, and deploys from Git in seconds. The routing config ensures that `/api/*` requests hit our Express server while everything else serves static files from `public/`.

**Live URL:** https://rabbitai-roan.vercel.app

---

## Lessons Learned: The Meta-Skills

### 1. Build the Simplest Thing That Could Possibly Work

We didn't use React. We didn't use TypeScript. We didn't use a database. We used in-memory storage for the CSV data, which means it resets when the server restarts. For an MVP, that's fine. The goal is to validate that people want to talk to their data, not to build a production-grade data warehouse.

**Engineering principle:** Start with a skateboard, not a car. If people want to go faster, they'll tell you.

### 2. Provider-Agnostic Architecture Pays Off

Supporting three AI providers from day one felt like over-engineering. But when the Groq SDK broke, users could instantly switch to Gemini or OpenAI. When Gemini rate-limits kicked in during a demo, we switched to Groq. Being provider-agnostic isn't just flexibility — it's risk mitigation.

**Analogy:** It's like having three different chargers for your phone. Seems excessive until you're at an airport and only one type of outlet is available.

### 3. Prompt Engineering Is Half the Battle

The quality of answers depends entirely on the prompt. Our prompt isn't just "here's data, answer this question." It explicitly tells the AI:
- Its persona ("You are a data analyst assistant")
- The tool's name ("Talking Rabbitt")
- The constraints ("Only use data from the provided dataset")
- The output format (strict JSON schema)
- When to visualize ("Determine if a visualization would help")

**Lesson:** LLMs are like very smart interns — they'll do amazing work if you give them clear instructions, and confuse themselves if you don't.

### 4. Always Validate User Inputs

We validate API keys by checking their prefix before making any API calls:
```javascript
if (provider === 'gemini' && !apiKey.startsWith('AIzaSy')) {
    alert('Invalid Gemini API key');
    return;
}
```

This catches typos and copy-paste errors immediately, saving wasted API calls and confusing error messages.

### 5. Error Handling Should Be Graceful, Not Silent

When the AI fails, we don't just show "Error." We show the specific error message. When no visualization is needed, we hide the chart container and show a friendly message. When data isn't uploaded, we tell the user exactly what to do next.

**Good error messages are a feature, not an afterthought.**

### 6. The "Table" Visualization Hack

Chart.js doesn't have a native table visualization. But the AI sometimes determines a table would be best. Our solution? Render it as a horizontal bar chart (`indexAxis: 'y'`). It's not perfect, but it's a clever workaround that keeps the UI consistent without adding a new library.

**Lesson:** Sometimes a "good enough" hack is better than a perfect solution that requires another dependency.

### 7. CSS Glassmorphism Is Surprisingly Easy

The frosted glass effect in our UI comes from just three CSS properties:
```css
background: rgba(255, 255, 255, 0.1);
backdrop-filter: blur(10px);
border: 1px solid rgba(255, 255, 255, 0.1);
```

It looks premium but costs nothing in performance. Little UI details like this make a project feel polished.

---

## Potential Pitfalls & How to Avoid Them

### Pitfall #1: In-Memory Data Storage
**Current state:** CSV data is stored in a `currentData` variable in memory.
**The risk:** If the server restarts (which happens on every redeploy on Vercel), the data is gone. Multiple users would also overwrite each other's data.
**The fix for production:** Use a proper database (PostgreSQL, MongoDB) or at least Redis for session storage. Each user should have an isolated data session.

### Pitfall #2: Sending All Data to the LLM
**Current state:** We send 20 rows of sample data in every prompt.
**The risk:** Large CSVs would exceed token limits or become expensive. The AI might also get confused by too much data.
**The fix for production:** Implement smart sampling (send diverse rows, not just the first 20), or do server-side aggregation before sending to the AI. Better yet, let the AI generate code (like SQL or Python) that runs against the full dataset locally.

### Pitfall #3: No Authentication
**Current state:** Anyone with the URL can use the app and burn through your API keys.
**The risk:** API keys are exposed to the client (they're sent in POST requests), and there's no user authentication.
**The fix for production:** Move API key management to the server side with user accounts, or implement OAuth. Never let API keys live in the browser for a production app.

### Pitfall #4: No Input Sanitization
**Current state:** User questions are sent directly to the LLM.
**The risk:** Prompt injection attacks where users trick the AI into ignoring instructions.
**The fix for production:** Sanitize inputs, use system prompts that are harder to override, and consider using structured output schemas more strictly.

---

## How Good Engineers Think (Applied Here)

### They Ask "What Could Go Wrong?"
Every API call has error handling. Every JSON parse has a fallback. Every provider has a backup. Good engineers don't just write the happy path — they write the path for when things inevitably break.

### They Optimize for Debugging
Notice the `console.log()` statements in the retry logic? Those aren't accidents. They're breadcrumbs. When something fails in production, you need visibility. Good logging is like leaving a trail of breadcrumbs — when you get lost, you can find your way back.

### They Keep Dependencies Minimal
We have 8 dependencies. We could have had 30. Each dependency is a liability — it can break, have security vulnerabilities, or become unmaintained. We only added what we needed: Express for the server, Multer for uploads, PapaParse for CSVs, and three AI SDKs (one of which we don't even use directly).

### They Build for the User, Not for the Resume
A React app with TypeScript, Redux, and GraphQL would look impressive on a resume. But it would take 3x longer to build and be 3x harder to debug. We chose vanilla JS because it was the right tool for the job. Good engineers pick boring technology that works over exciting technology that might not.

---

## The Name Game: From Talking Rabbitt to ContextFlow

Notice the inconsistency? The `package.json` says "talking-rabbit-mvp". The `README.md` says "rabbittAI". The HTML title says "ContextFlow". The footer says "Talking Rabbitt".

This is actually a common startup journey. You build something, give it a cute name (Talking Rabbitt 🐰), then realize you need something more professional for the portfolio (ContextFlow). The branding evolved, but the code still has traces of the old name.

**Lesson:** Don't let perfect branding block shipping. You can rebrand later. The code doesn't care what you call it.

---

## Final Thoughts

ContextFlow is a textbook example of a pragmatic MVP. It solves a real problem (data analysis is hard), uses the right tools for the job (no over-engineering), handles real-world issues (rate limits, SDK bugs, parsing errors), and delivers genuine value (answers + charts from natural language).

The codebase isn't perfect — it has hardcoded sample data, in-memory storage, and mixed branding — but it *works*. And working code that solves a problem is infinitely better than perfect code that never ships.

**The ultimate lesson:** Build small, build fast, handle errors gracefully, and always have a backup plan. Whether it's an AI provider, a parsing strategy, or a career move — redundancy and resilience win every time.

Now go talk to some data. 🐰📊

