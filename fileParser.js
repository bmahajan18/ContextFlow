const Papa = require('papaparse');
const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const heicConvert = require('heic-convert');

/**
 * Parses uploaded file buffer based on format/extension/mimetype.
 * Returns structured result:
 * {
 *   fileType: 'tabular' | 'document' | 'image',
 *   format: string, // 'csv', 'excel', 'pdf', 'word', 'slides', 'iwork', 'image', 'text'
 *   fileName: string,
 *   // Tabular data fields:
 *   data: Array<Object>,
 *   columns: Array<String>,
 *   rowCount: number,
 *   // Document data fields:
 *   documentText: string,
 *   wordCount: number,
 *   metaInfo: Object,
 *   // Image data fields:
 *   imageBase64: string,
 *   imageMimeType: string
 * }
 */
async function parseUploadedFile(file, requestedFormat = 'auto') {
    const originalName = file.originalname || 'uploaded_file';
    const ext = (originalName.split('.').pop() || '').toLowerCase();
    const mimeType = file.mimetype || '';
    const buffer = file.buffer;

    let format = requestedFormat;
    if (!format || format === 'auto') {
        format = detectFormat(ext, mimeType);
    }

    switch (format) {
        case 'csv':
            return parseCSV(buffer, originalName);

        case 'excel':
            return parseExcel(buffer, originalName);

        case 'pdf':
            return await parsePDF(buffer, originalName);

        case 'word':
            return await parseWord(buffer, originalName);

        case 'slides':
            return await parseSlides(buffer, originalName);

        case 'iwork':
        case 'pages':
        case 'keynote':
        case 'numbers':
            return await parseIWork(buffer, originalName, ext);

        case 'image':
        case 'heic':
            return await parseImage(buffer, originalName, ext, mimeType);

        case 'text':
            return parseText(buffer, originalName, ext);

        default:
            // Fallback auto detection if specific format failed or unknown
            return await autoParse(buffer, originalName, ext, mimeType);
    }
}

function detectFormat(ext, mimeType) {
    if (['csv', 'tsv'].includes(ext) || mimeType.includes('csv')) return 'csv';
    if (['xlsx', 'xls'].includes(ext) || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'excel';
    if (ext === 'pdf' || mimeType.includes('pdf')) return 'pdf';
    if (['docx', 'doc'].includes(ext) || mimeType.includes('word')) return 'word';
    if (['pptx', 'ppt'].includes(ext) || mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'slides';
    if (['pages', 'key', 'numbers'].includes(ext)) return 'iwork';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'].includes(ext) || mimeType.includes('image/')) return 'image';
    return 'text';
}

function parseCSV(buffer, fileName) {
    const str = buffer.toString('utf8');
    const results = Papa.parse(str, { header: true, skipEmptyLines: true });
    const data = results.data || [];
    const columns = results.meta.fields || (data.length > 0 ? Object.keys(data[0]) : []);
    
    return {
        fileType: 'tabular',
        format: 'csv',
        fileName,
        data,
        columns,
        rowCount: data.length
    };
}

function parseExcel(buffer, fileName) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = xlsx.utils.sheet_to_json(worksheet) || [];
    const columns = data.length > 0 ? Object.keys(data[0]) : [];

    return {
        fileType: 'tabular',
        format: 'excel',
        fileName,
        data,
        columns,
        rowCount: data.length,
        metaInfo: { sheetNames: workbook.SheetNames }
    };
}

async function parsePDF(buffer, fileName) {
    try {
        const pdfData = await pdfParse(buffer);
        const text = (pdfData.text || '').trim();
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        
        return {
            fileType: 'document',
            format: 'pdf',
            fileName,
            documentText: text,
            wordCount,
            metaInfo: {
                pageCount: pdfData.numpages || 1,
                info: pdfData.info || {}
            }
        };
    } catch (err) {
        throw new Error(`Failed to parse PDF file: ${err.message}`);
    }
}

async function parseWord(buffer, fileName) {
    try {
        const result = await mammoth.extractRawText({ buffer });
        const text = (result.value || '').trim();
        const wordCount = text.split(/\s+/).filter(Boolean).length;

        return {
            fileType: 'document',
            format: 'word',
            fileName,
            documentText: text,
            wordCount,
            metaInfo: {}
        };
    } catch (err) {
        throw new Error(`Failed to parse Word document: ${err.message}`);
    }
}

async function parseSlides(buffer, fileName) {
    try {
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles = [];
        
        zip.forEach((relativePath) => {
            if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
                slideFiles.push(relativePath);
            }
        });

        // Sort slide files numerically (slide1.xml, slide2.xml...)
        slideFiles.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/) || [0], 10);
            const numB = parseInt(b.match(/\d+/) || [0], 10);
            return numA - numB;
        });

        let slideTexts = [];
        for (let i = 0; i < slideFiles.length; i++) {
            const xmlContent = await zip.file(slideFiles[i]).async('string');
            // Extract text inside XML tags
            const textContent = xmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (textContent) {
                slideTexts.push(`--- Slide ${i + 1} ---\n${textContent}`);
            }
        }

        const documentText = slideTexts.join('\n\n');
        const wordCount = documentText.split(/\s+/).filter(Boolean).length;

        return {
            fileType: 'document',
            format: 'slides',
            fileName,
            documentText: documentText || `Presentation file uploaded (${slideFiles.length} slides)`,
            wordCount,
            metaInfo: { slideCount: slideFiles.length }
        };
    } catch (err) {
        return {
            fileType: 'document',
            format: 'slides',
            fileName,
            documentText: `Presentation file: ${fileName}`,
            wordCount: 0,
            metaInfo: { slideCount: 1 }
        };
    }
}

async function parseIWork(buffer, fileName, ext) {
    try {
        const zip = await JSZip.loadAsync(buffer);
        // Check for QuickLook preview PDF inside Apple iWork format (.pages, .key, .numbers)
        const previewPdf = zip.file('QuickLook/Preview.pdf') || zip.file('preview.pdf');
        
        if (previewPdf) {
            const pdfBuffer = await previewPdf.async('nodebuffer');
            const parsedPdf = await parsePDF(pdfBuffer, fileName);
            return {
                ...parsedPdf,
                format: 'iwork',
                metaInfo: { ...parsedPdf.metaInfo, iWorkType: ext }
            };
        }

        // If no Preview.pdf, extract readable strings from zip entries
        let extractedTexts = [];
        const files = Object.keys(zip.files);
        for (const filename of files) {
            if (filename.endsWith('.xml') || filename.endsWith('.txt') || filename.endsWith('.plist')) {
                const text = await zip.files[filename].async('string');
                const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (cleaned.length > 20) {
                    extractedTexts.push(cleaned);
                }
            }
        }

        const documentText = extractedTexts.join('\n\n');
        const wordCount = documentText.split(/\s+/).filter(Boolean).length;

        return {
            fileType: 'document',
            format: 'iwork',
            fileName,
            documentText: documentText || `Apple ${ext.toUpperCase()} document: ${fileName}`,
            wordCount,
            metaInfo: { iWorkType: ext }
        };
    } catch (err) {
        return {
            fileType: 'document',
            format: 'iwork',
            fileName,
            documentText: `Apple ${ext.toUpperCase()} document: ${fileName}`,
            wordCount: 0,
            metaInfo: { iWorkType: ext }
        };
    }
}

async function parseImage(buffer, fileName, ext, mimeType) {
    let finalBuffer = buffer;
    let finalMime = mimeType || 'image/png';

    if (ext === 'heic' || ext === 'heif' || mimeType.includes('heic')) {
        try {
            finalBuffer = await heicConvert({
                buffer: buffer,
                format: 'JPEG',
                quality: 0.9
            });
            finalMime = 'image/jpeg';
        } catch (heicErr) {
            console.error('HEIC conversion warning:', heicErr.message);
        }
    } else if (ext === 'jpg' || ext === 'jpeg') {
        finalMime = 'image/jpeg';
    } else if (ext === 'webp') {
        finalMime = 'image/webp';
    } else if (ext === 'png') {
        finalMime = 'image/png';
    }

    const imageBase64 = finalBuffer.toString('base64');
    
    return {
        fileType: 'image',
        format: 'image',
        fileName,
        imageBase64,
        imageMimeType: finalMime,
        metaInfo: {
            originalFormat: ext,
            sizeBytes: buffer.length
        }
    };
}

function parseText(buffer, fileName, ext) {
    const text = buffer.toString('utf8').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return {
        fileType: 'document',
        format: 'text',
        fileName,
        documentText: text,
        wordCount,
        metaInfo: { extension: ext }
    };
}

async function autoParse(buffer, fileName, ext, mimeType) {
    const detected = detectFormat(ext, mimeType);
    if (detected === 'csv') return parseCSV(buffer, fileName);
    if (detected === 'excel') return parseExcel(buffer, fileName);
    if (detected === 'pdf') return await parsePDF(buffer, fileName);
    if (detected === 'word') return await parseWord(buffer, fileName);
    if (detected === 'slides') return await parseSlides(buffer, fileName);
    if (detected === 'iwork') return await parseIWork(buffer, fileName, ext);
    if (detected === 'image') return await parseImage(buffer, fileName, ext, mimeType);
    return parseText(buffer, fileName, ext);
}

module.exports = {
    parseUploadedFile,
    detectFormat
};
