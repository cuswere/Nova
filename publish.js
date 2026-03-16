#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSoZVQ-s36NtRxydHagCtc3zbAf3pLmOKoYGa0533yyhebTL0Xuogz7FzunHMI6vVE2Xu_ZnCzuB4oM/pub?gid=0&single=true&output=csv";
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'opportunities.json');

// Parse CSV string into array of objects, handling quoted fields
function parseCSV(csvText) {
    function parseCSVRow(row) {
        const result = [];
        let current = '';
        let insideQuotes = false;
        
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            const nextChar = row[i + 1];
            
            if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === ',' && !insideQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }
    
    const rows = csvText.trim().split('\n');
    if (rows.length < 2) return [];
    
    const headers = parseCSVRow(rows[0]).map(h => h.toLowerCase());
    
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = parseCSVRow(rows[i]);
        if (values.length > 0 && values[0]) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            data.push(row);
        }
    }
    return data;
}

// Fetch CSV and save to JSON
async function publishOpportunities() {
    try {
        console.log('Fetching from Google Sheet...');
        const csvText = await new Promise((resolve, reject) => {
            function fetchWithRedirects(url) {
                https.get(url, (res) => {
                    // Handle redirects
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        fetchWithRedirects(res.headers.location);
                        return;
                    }
                    
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                }).on('error', reject);
            }
            fetchWithRedirects(CSV_URL);
        });
        
        const opportunities = parseCSV(csvText);
        
        // Create data directory if it doesn't exist
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        
        // Write to JSON file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(opportunities, null, 2));
        
        console.log(`✓ Published ${opportunities.length} opportunities to ${OUTPUT_FILE}`);
    } catch (error) {
        console.error('❌ Error publishing opportunities:', error.message);
        process.exit(1);
    }
}

publishOpportunities();
