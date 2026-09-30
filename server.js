const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const { parseUploadedFile } = require('./fileParser');

// Load environment variables from .env.local if present, otherwise .env
const envLocalPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) {
    require('dotenv').config({ path: envLocalPath });
} else {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Configure multer for file uploads (memoryStorage for Vercel serverless)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE }
});

// AI Providers configuration
let genAI = null;
let GeminiModel = null;
let openai = null;
let groqApiKey = null;
let activeProvider = null; // 'gemini', 'openai', or 'groq'

// Preferred Gemini Model
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

/**
 * Dynamically fetches active models from Groq API for a given API key.
 */
async function getActiveGroqModels(apiKey) {
    const fallbackList = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "llama3-8b-8192"];
    try {
        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            const json = await response.json();
            if (json && Array.isArray(json.data) && json.data.length > 0) {
                const chatModels = json.data
                    .map(m => m.id)
                    .filter(id => id && !/whisper|guard|embed|speech|audio/i.test(id));
                
                if (chatModels.length > 0) {
                    console.log('🤖 Discovered active Groq models:', chatModels);
                    return chatModels;
                }
            }
        }
    } catch (e) {
        console.error('Dynamic Groq model lookup warning:', e.message);
    }
    return fallbackList;
}

// Auto-configure from environment variables on startup
const startupGeminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
const startupOpenaiKey = process.env.OPENAI_API_KEY;
const startupGroqKey = process.env.GROQ_API_KEY;

if (startupGeminiKey) {
    genAI = new GoogleGenerativeAI(startupGeminiKey);
    GeminiModel = genAI.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
    activeProvider = 'gemini';
    console.log('🤖 Google Gemini auto-configured from environment variables.');
} else if (startupOpenaiKey) {
    openai = new OpenAI({ apiKey: startupOpenaiKey });
    activeProvider = 'openai';
    console.log('🤖 OpenAI auto-configured from environment variables.');
} else if (startupGroqKey) {
    groqApiKey = startupGroqKey;
    activeProvider = 'groq';
    console.log('🤖 Groq auto-configured from environment variables.');
}

// Store uploaded file state & conversation history in memory
let currentFileState = null;
let conversationHistory = [];

// Helper to generate executive summary & smart questions
function generateExecutiveSummary(fileInfo) {
    if (fileInfo.fileType === 'tabular') {
        const numCols = fileInfo.columns.length;
        const numRows = fileInfo.rowCount;
        const sampleColNames = fileInfo.columns.slice(0, 4).join(', ');
        
        return {
            summary: `Loaded dataset **${fileInfo.fileName}** with **${numRows} rows** and **${numCols} columns** (${sampleColNames}). Ready for instant analytical queries and chart visualization.`,
            keyMetrics: [
                `Total Rows: ${numRows}`,
                `Total Columns: ${numCols}`,
                `Columns: ${fileInfo.columns.join(', ')}`
            ],
            suggestedQuestions: [
                `Which ${fileInfo.columns[0] || 'item'} has the highest ${fileInfo.columns[fileInfo.columns.length - 1] || 'value'}?`,
                `Show breakdown of ${fileInfo.columns[1] || 'category'} by ${fileInfo.columns[fileInfo.columns.length - 1] || 'metrics'}`,
                `What is the total and average across all rows?`
            ]
        };
    } else if (fileInfo.fileType === 'document') {
        const wordCount = fileInfo.wordCount || 0;
        const snippet = fileInfo.documentText ? fileInfo.documentText.slice(0, 250).replace(/\s+/g, ' ') : '';
        
        return {
            summary: `Parsed document **${fileInfo.fileName}** containing approx **${wordCount.toLocaleString()} words**. Document context loaded into AI memory.`,
            keyMetrics: [
                `Word Count: ${wordCount.toLocaleString()} words`,
                fileInfo.metaInfo && fileInfo.metaInfo.pageCount ? `Pages: ${fileInfo.metaInfo.pageCount}` : `Format: ${fileInfo.format.toUpperCase()}`,
                fileInfo.metaInfo && fileInfo.metaInfo.slideCount ? `Slides: ${fileInfo.metaInfo.slideCount}` : `Category: Document`
            ],
            suggestedQuestions: [
                `Summarize the top 3 key takeaways of this document`,
                `What are the critical metrics, dates, or findings mentioned?`,
                `Provide an executive briefing based on this file`
            ]
        };
    } else if (fileInfo.fileType === 'image') {
        return {
            summary: `Uploaded image **${fileInfo.fileName}** (${fileInfo.imageMimeType}). Multimodal computer vision analysis ready.`,
            keyMetrics: [
                `Image Format: ${fileInfo.imageMimeType}`,
                `File Name: ${fileInfo.fileName}`,
                `Capability: Computer Vision & OCR`
            ],
            suggestedQuestions: [
                `Describe everything shown in this image in detail`,
                `Extract all visible text and numbers from this image`,
                `Analyze any chart, table, or diagram in this image`
            ]
        };
    }
    
    return {
        summary: `File **${fileInfo.fileName}** uploaded successfully.`,
        keyMetrics: [`File Name: ${fileInfo.fileName}`],
        suggestedQuestions: [`Summarize main contents`, `Extract key insights`]
    };
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'ContextFlow API is running' });
});

// Configure AI provider
app.post('/api/configure', async (req, res) => {
    const { apiKey, provider } = req.body;
    
    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
    }

    const selectedProvider = provider || 'gemini';
    
    if (selectedProvider === 'openai') {
        openai = new OpenAI({ apiKey });
        activeProvider = 'openai';
        res.json({ success: true, message: 'OpenAI configured successfully', provider: 'openai' });
    } else if (selectedProvider === 'groq') {
        try {
            const models = await getActiveGroqModels(apiKey);
            groqApiKey = apiKey;
            activeProvider = 'groq';
            res.json({ 
                success: true, 
                message: `Groq configured successfully (Active model: ${models[0]})`, 
                provider: 'groq' 
            });
        } catch (groqErr) {
            res.status(200).json({ success: false, error: 'Failed to validate Groq API key: ' + groqErr.message });
        }
    } else {
        try {
            const testGenAI = new GoogleGenerativeAI(apiKey);
            const testModel = testGenAI.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
            await testModel.generateContent('Reply with the single word: OK');

            genAI = testGenAI;
            GeminiModel = testModel;
            activeProvider = 'gemini';
            res.json({ success: true, message: 'Gemini configured successfully', provider: 'gemini' });
        } catch (error) {
            console.error('Gemini configuration validation failed:', error);
            const status = error.status;
            let message = 'Failed to validate your Gemini API key. Please check it and try again.';
            if (status === 400) {
                message = 'The Gemini API key appears to be invalid or the model is not accessible. Check your key in Google AI Studio.';
            } else if (status === 401 || status === 403) {
                message = 'The Gemini API key is unauthorized. Check your key in Google AI Studio.';
            } else if (status === 404) {
                message = 'The specified Gemini model is not available for your API key.';
            } else if (status === 429) {
                message = 'Gemini API rate limit reached. Please try again in a moment.';
            }
            return res.status(200).json({ success: false, error: message });
        }
    }
});

// Get current AI provider status
app.get('/api/provider', (req, res) => {
    res.json({ 
        active: activeProvider !== null,
        provider: activeProvider
    });
});

// Upload file (CSV, Excel, PDF, Word, Slides, iWork, Images, Text)
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const requestedFormat = req.body.format || 'auto';
        const fileInfo = await parseUploadedFile(req.file, requestedFormat);
        currentFileState = fileInfo;
        conversationHistory = []; // Reset conversation history on new file upload

        const execSummary = generateExecutiveSummary(fileInfo);

        res.json({
            success: true,
            fileType: fileInfo.fileType,
            format: fileInfo.format,
            fileName: fileInfo.fileName,
            columns: fileInfo.columns || [],
            rowCount: fileInfo.rowCount || 0,
            wordCount: fileInfo.wordCount || 0,
            metaInfo: fileInfo.metaInfo || {},
            previewText: fileInfo.documentText ? fileInfo.documentText.slice(0, 300) : '',
            imageMimeType: fileInfo.imageMimeType || null,
            executiveSummary: execSummary
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Error processing file: ' + error.message });
    }
});

// Centralized error handler for multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: 'File too large. Maximum allowed size is 10MB. Please upload a smaller file.'
            });
        }
        return res.status(400).json({
            success: false,
            error: 'Upload error: ' + err.message
        });
    }
    if (err && err.status === 413) {
        return res.status(413).json({
            success: false,
            error: 'File too large. Maximum allowed size is 10MB. Please upload a smaller file.'
        });
    }
    next(err);
});

// Get current data / file info & Executive Summary
app.get('/api/data', (req, res) => {
    if (!currentFileState) {
        return res.json({ hasData: false });
    }

    const execSummary = generateExecutiveSummary(currentFileState);

    res.json({
        hasData: true,
        fileType: currentFileState.fileType,
        format: currentFileState.format,
        fileName: currentFileState.fileName,
        columns: currentFileState.columns || [],
        rowCount: currentFileState.rowCount || 0,
        wordCount: currentFileState.wordCount || 0,
        metaInfo: currentFileState.metaInfo || {},
        previewText: currentFileState.documentText ? currentFileState.documentText.slice(0, 300) : '',
        imageMimeType: currentFileState.imageMimeType || null,
        executiveSummary: execSummary
    });
});

// Conversational Query Endpoint with Threaded Conversation Support
app.post('/api/query', async (req, res) => {
    const { question } = req.body;

    if (!activeProvider) {
        return res.status(400).json({ error: 'AI not configured. Please provide API key.' });
    }

    if (!currentFileState) {
        return res.json({ 
            answer: 'No file uploaded. Please upload a file (CSV, PDF, Word, Presentation, Image, etc.) first.',
            visualization: null 
        });
    }

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        let prompt = '';
        let isImageInput = currentFileState.fileType === 'image';

        // Build recent conversation history snippet
        const historyText = conversationHistory.length > 0
            ? "\nRecent Conversation History:\n" + conversationHistory.slice(-4).map(h => `Q: "${h.question}"\nA: "${h.answer}"`).join("\n\n") + "\n\n"
            : "";

        if (currentFileState.fileType === 'tabular') {
            prompt = `You are a data analyst assistant for "ContextFlow" - a conversational intelligence tool.
        
The user uploaded a tabular file "${currentFileState.fileName}" (${currentFileState.format.toUpperCase()}) with columns: ${currentFileState.columns.join(', ')}.
Total dataset rows: ${currentFileState.rowCount}.

Dataset Sample:
${JSON.stringify(currentFileState.data.slice(0, 30), null, 2)}
${historyText}
Current User Question: "${question}"

Your task:
1. Analyze the data (and consider prior conversation context if applicable) to answer the question thoroughly.
2. If the question asks for metrics or comparisons, derive them directly from the dataset.
3. Determine if a visual chart would help (YES or NO).
4. If a visualization helps, specify: "type" ("bar", "line", "pie", or "table"), "title", "labels" array, and "values" array.

Respond in JSON format:
{
  "answer": "Your detailed response with specific numbers/insights",
  "visualization": {
    "type": "bar|line|pie|table",
    "title": "Chart Title",
    "labels": ["Label1", "Label2"],
    "values": [10, 20]
  }
}

If no visualization is needed, set "visualization": null.`;

        } else if (currentFileState.fileType === 'document') {
            const maxChars = 20000;
            const docSnippet = currentFileState.documentText.slice(0, maxChars);

            prompt = `You are an AI document intelligence assistant for "ContextFlow".

The user uploaded document "${currentFileState.fileName}" (${currentFileState.format.toUpperCase()}). Word Count: ${currentFileState.wordCount}.

Document Content:
"""
${docSnippet}
"""
${historyText}
Current User Question: "${question}"

Your task:
1. Thoroughly read and analyze the document content to answer the user's question.
2. Provide clear, accurate, and structured insights based strictly on the document text.
3. If the answer contains quantifiable data, metrics, or key comparison points, provide a visualization.

Respond strictly in JSON format:
{
  "answer": "Your comprehensive answer based on the document content",
  "visualization": {
    "type": "bar|line|pie|table",
    "title": "Chart Title",
    "labels": ["Label1", "Label2"],
    "values": [10, 20]
  }
}

If no visualization applies, set "visualization": null.`;

        } else if (currentFileState.fileType === 'image') {
            prompt = `You are a vision intelligence AI for "ContextFlow".

The user uploaded an image file "${currentFileState.fileName}".
${historyText}
Current User Question: "${question}"

Your task:
1. Analyze the image in detail to answer the user's question.
2. Describe objects, text, charts, diagrams, or key visual elements as requested.
3. If applicable, extract metrics or data points into a chart visualization.

Respond strictly in JSON format:
{
  "answer": "Your detailed explanation and visual analysis of the image",
  "visualization": {
    "type": "bar|line|pie|table",
    "title": "Visual Breakdown",
    "labels": ["Label1", "Label2"],
    "values": [10, 20]
  }
}

If no visualization applies, set "visualization": null.`;
        }

        let responseText;
        
        if (activeProvider === 'openai') {
            let messagesContent;
            if (isImageInput) {
                messagesContent = [
                    { type: "text", text: prompt },
                    { 
                        type: "image_url", 
                        image_url: { 
                            url: `data:${currentFileState.imageMimeType};base64,${currentFileState.imageBase64}` 
                        } 
                    }
                ];
            } else {
                messagesContent = prompt;
            }

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: messagesContent }],
                response_format: { type: "json_object" }
            });
            responseText = completion.choices[0].message.content;

        } else if (activeProvider === 'groq') {
            const groqModels = await getActiveGroqModels(groqApiKey);
            let lastGroqError;
            
            for (const modelId of groqModels) {
                try {
                    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${groqApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: modelId,
                            messages: [{ role: "user", content: prompt }],
                            response_format: { type: "json_object" }
                        })
                    });
                    const groqData = await groqResponse.json();
                    
                    if (groqData.error) {
                        const errMsg = groqData.error.message || '';
                        if (/decommissioned|not exist|deprecated|access|invalid/i.test(errMsg)) {
                            lastGroqError = errMsg;
                            continue;
                        }
                        throw new Error(errMsg || 'Groq API error');
                    }
                    
                    if (groqData.choices && groqData.choices[0]) {
                        responseText = groqData.choices[0].message.content;
                        break;
                    }
                } catch (err) {
                    lastGroqError = err.message;
                }
            }
            
            if (!responseText) {
                throw new Error(lastGroqError || 'Groq API request failed across active models.');
            }

        } else {
            // Gemini (default)
            let contents;
            if (isImageInput) {
                const imagePart = {
                    inlineData: {
                        data: currentFileState.imageBase64,
                        mimeType: currentFileState.imageMimeType
                    }
                };
                contents = [prompt, imagePart];
            } else {
                contents = prompt;
            }

            const maxRetries = 3;
            let lastError;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const result = await GeminiModel.generateContent(contents);
                    responseText = result.response.text();
                    break;
                } catch (error) {
                    lastError = error;
                    if (error.status === 429) {
                        const waitTime = Math.pow(2, attempt) * 1000;
                        console.log(`Gemini rate limited. Waiting ${waitTime}ms before retry ${attempt}/${maxRetries}`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    } else {
                        throw error;
                    }
                }
            }
            
            if (!responseText && lastError) {
                throw lastError;
            }
        }
        
        // Parse JSON response
        let response;
        try {
            response = JSON.parse(responseText);
        } catch (parseError) {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                response = JSON.parse(jsonMatch[0]);
            } else {
                response = {
                    answer: responseText,
                    visualization: null
                };
            }
        }
        
        // Store conversation history for multi-turn chat
        conversationHistory.push({
            question,
            answer: response.answer,
            visualization: response.visualization,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            answer: response.answer,
            visualization: response.visualization,
            conversationHistory
        });

    } catch (error) {
        console.error('Error processing query:', error);
        let errorMessage = error.message || 'Unknown error';
        if (error.status) {
            if (error.status === 400) {
                errorMessage = 'Invalid request to the AI provider. Check your API key or model permissions.';
            } else if (error.status === 401 || error.status === 403) {
                errorMessage = 'The AI provider rejected the API key. Please re-configure your API key.';
            } else if (error.status === 404) {
                errorMessage = 'The requested AI model is not available. Try another provider or check your API key.';
            } else if (error.status === 429) {
                errorMessage = 'Rate limit exceeded by the AI provider. Please try again in a moment.';
            }
        }
        res.status(500).json({ error: 'Error processing query: ' + errorMessage });
    }
});

// Clear conversation history
app.post('/api/clear-history', (req, res) => {
    conversationHistory = [];
    res.json({ success: true, message: 'Conversation history cleared' });
});

// Get sample data for demo
app.get('/api/sample-data', (req, res) => {
    const sampleData = [
        { Region: "North", Product: "Electronics", Quarter: "Q1", Revenue: 45000, Units: 150 },
        { Region: "South", Product: "Electronics", Quarter: "Q1", Revenue: 52000, Units: 180 },
        { Region: "East", Product: "Electronics", Quarter: "Q1", Revenue: 38000, Units: 120 },
        { Region: "West", Product: "Electronics", Quarter: "Q1", Revenue: 61000, Units: 200 },
        { Region: "North", Product: "Clothing", Quarter: "Q1", Revenue: 28000, Units: 400 },
        { Region: "South", Product: "Clothing", Quarter: "Q1", Revenue: 32000, Units: 450 },
        { Region: "East", Product: "Clothing", Quarter: "Q1", Revenue: 25000, Units: 350 },
        { Region: "West", Product: "Clothing", Quarter: "Q1", Revenue: 35000, Units: 500 },
        { Region: "North", Product: "Electronics", Quarter: "Q2", Revenue: 48000, Units: 160 },
        { Region: "South", Product: "Electronics", Quarter: "Q2", Revenue: 55000, Units: 190 },
        { Region: "East", Product: "Electronics", Quarter: "Q2", Revenue: 42000, Units: 140 },
        { Region: "West", Product: "Electronics", Quarter: "Q2", Revenue: 65000, Units: 210 }
    ];
    
    currentFileState = {
        fileType: 'tabular',
        format: 'csv',
        fileName: 'Sample_Sales_Data.csv',
        data: sampleData,
        columns: ['Region', 'Product', 'Quarter', 'Revenue', 'Units'],
        rowCount: sampleData.length
    };
    conversationHistory = [];
    
    const execSummary = generateExecutiveSummary(currentFileState);

    res.json({
        success: true,
        fileType: 'tabular',
        format: 'csv',
        fileName: 'Sample_Sales_Data.csv',
        columns: currentFileState.columns,
        rowCount: sampleData.length,
        preview: sampleData,
        executiveSummary: execSummary
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🤖 ContextFlow API running on http://localhost:${PORT}`);
    });
}

// Export for serverless environments (Vercel)
module.exports = app;
