const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Papa = require('papaparse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Groq = require('groq');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// AI Providers configuration
let genAI = null;
let GeminiModel = null;
let openai = null;
let groqApiKey = null; // Store Groq API key for direct HTTP calls
let activeProvider = null; // 'gemini', 'openai', or 'groq'

// Store uploaded CSV data in memory
let currentData = null;
let dataColumns = [];

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Talking Rabbitt API is running' });
});

// Configure AI provider (Gemini, OpenAI, or Groq)
app.post('/api/configure', (req, res) => {
    const { apiKey, provider } = req.body;
    
    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
    }

    const selectedProvider = provider || 'gemini';
    
    if (selectedProvider === 'openai') {
        // Configure OpenAI
        openai = new OpenAI({ apiKey });
        activeProvider = 'openai';
        res.json({ success: true, message: 'OpenAI configured successfully', provider: 'openai' });
    } else if (selectedProvider === 'groq') {
        // Store Groq API key for direct HTTP calls (SDK has compatibility issues with Node 25)
        groqApiKey = apiKey;
        activeProvider = 'groq';
        res.json({ success: true, message: 'Groq configured successfully', provider: 'groq' });
    } else {
        // Configure Gemini (default)
        genAI = new GoogleGenerativeAI(apiKey);
        GeminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
        activeProvider = 'gemini';
        res.json({ success: true, message: 'Gemini configured successfully', provider: 'gemini' });
    }
});

// Get current AI provider status
app.get('/api/provider', (req, res) => {
    res.json({ 
        active: activeProvider !== null,
        provider: activeProvider
    });
});

// Upload CSV file
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    
    // Read and parse CSV
    fs.readFile(filePath, 'utf8', (err, csvData) => {
        if (err) {
            return res.status(500).json({ error: 'Error reading file' });
        }

        Papa.parse(csvData, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                currentData = results.data;
                dataColumns = results.meta.fields || [];
                
                // Clean up uploaded file
                fs.unlink(filePath, () => {});
                
                res.json({
                    success: true,
                    columns: dataColumns,
                    rowCount: currentData.length,
                    preview: currentData.slice(0, 5)
                });
            },
            error: function(error) {
                res.status(500).json({ error: 'Error parsing CSV: ' + error.message });
            }
        });
    });
});

// Get current data info
app.get('/api/data', (req, res) => {
    if (!currentData) {
        return res.json({ hasData: false });
    }
    res.json({
        hasData: true,
        columns: dataColumns,
        rowCount: currentData.length,
        preview: currentData.slice(0, 10)
    });
});

// Conversational Query Endpoint
app.post('/api/query', async (req, res) => {
    const { question } = req.body;

    if (!activeProvider) {
        return res.status(400).json({ error: 'AI not configured. Please provide API key.' });
    }

    if (!currentData) {
        return res.json({ 
            answer: 'No data uploaded. Please upload a CSV file first.',
            visualization: null 
        });
    }

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        // Create context from the data
        const dataContext = JSON.stringify({
            columns: dataColumns,
            sampleData: currentData.slice(0, 20),
            totalRows: currentData.length
        });

        // Build the prompt for the LLM
        const prompt = `You are a data analyst assistant for "Talking Rabbitt" - a conversational intelligence tool.
        
The user has uploaded a CSV file with the following columns: ${dataColumns.join(', ')}.
The dataset has ${currentData.length} rows.

Here's a sample of the data:
${JSON.stringify(currentData.slice(0, 20), null, 2)}

The user is asking: "${question}"

Your task:
1. Analyze the data to answer the question
2. If the question asks for a specific metric, calculate it from the data
3. If the question asks for comparisons, provide them with numbers
4. Determine if a visualization would help (answer YES or NO)
5. If visualization would help, specify the type: "bar", "line", "pie", or "table"

Respond in JSON format:
{
  "answer": "Your detailed answer with specific numbers from the data",
  "visualization": {
    "type": "bar|line|pie|table",
    "title": "Chart title",
    "labels": ["label1", "label2", ...],
    "values": [value1, value2, ...]
  }
}

If no visualization is needed, set visualization to null.
IMPORTANT: Only use data from the provided dataset. Do not make up numbers.`;

        let responseText;
        
        if (activeProvider === 'openai') {
            // Use OpenAI
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            });
            responseText = completion.choices[0].message.content;
        } else if (activeProvider === 'groq') {
            // Use Groq via direct HTTP API call (SDK has compatibility issues with Node 25)
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
            const groqData = await groqResponse.json();
            
            if (groqData.error) {
                throw new Error(groqData.error.message || 'Groq API error');
            }
            
            if (!groqData.choices || !groqData.choices[0]) {
                throw new Error('Invalid Groq API response');
            }
            
            responseText = groqData.choices[0].message.content;
        } else {
            // Use Gemini with retry logic
            const maxRetries = 3;
            let lastError;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const result = await GeminiModel.generateContent(prompt);
                    responseText = result.response.text();
                    break;
                } catch (error) {
                    lastError = error;
                    if (error.status === 429) {
                        // Rate limited - wait and retry with exponential backoff
                        const waitTime = Math.pow(2, attempt) * 1000;
                        console.log(`Rate limited. Waiting ${waitTime}ms before retry ${attempt}/${maxRetries}`);
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
        
        // Extract JSON from the response
        let response;
        try {
            // Try to parse the response as JSON
            response = JSON.parse(responseText);
        } catch (parseError) {
            // If it's not pure JSON, try to extract JSON from the text
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                response = JSON.parse(jsonMatch[0]);
            } else {
                // Fallback: return the text as the answer
                response = {
                    answer: responseText,
                    visualization: null
                };
            }
        }
        
        res.json({
            success: true,
            answer: response.answer,
            visualization: response.visualization
        });

    } catch (error) {
        console.error('Error processing query:', error);
        res.status(500).json({ error: 'Error processing query: ' + error.message });
    }
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
        { Region: "West", Product: "Electronics", Quarter: "Q2", Revenue: 65000, Units: 210 },
        { Region: "North", Product: "Clothing", Quarter: "Q2", Revenue: 30000, Units: 420 },
        { Region: "South", Product: "Clothing", Quarter: "Q2", Revenue: 34000, Units: 480 },
        { Region: "East", Product: "Clothing", Quarter: "Q2", Revenue: 27000, Units: 380 },
        { Region: "West", Product: "Clothing", Quarter: "Q2", Revenue: 38000, Units: 540 }
    ];
    
    currentData = sampleData;
    dataColumns = ['Region', 'Product', 'Quarter', 'Revenue', 'Units'];
    
    res.json({
        success: true,
        columns: dataColumns,
        rowCount: sampleData.length,
        preview: sampleData
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🤖 Talking Rabbitt API running on http://localhost:${PORT}`);
});

