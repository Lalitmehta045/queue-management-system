import axios from 'axios';
import EventSource from 'eventsource';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const PRINTER_NAME = process.env.PRINTER_NAME || 'TSC TTP-244 Pro';
const PRINTER_TYPE = process.env.PRINTER_TYPE || 'TSPL'; // 'TSPL' or 'ESCPOS'
const PAIRING_CODE = process.env.PAIRING_CODE;
let PRINTER_ID = process.env.PRINTER_ID;
let DEVICE_SECRET = process.env.DEVICE_SECRET;

const CONFIG_PATH = path.join(__dirname, '../.printer-config.json');

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    PRINTER_ID = data.printerId || PRINTER_ID;
    DEVICE_SECRET = data.deviceSecret || DEVICE_SECRET;
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ printerId: PRINTER_ID, deviceSecret: DEVICE_SECRET }, null, 2));
}

async function pairPrinter() {
  if (!PAIRING_CODE) {
    console.error('No PRINTER_ID or PAIRING_CODE provided.');
    process.exit(1);
  }
  console.log(`Pairing printer with code ${PAIRING_CODE}...`);
  try {
    const res = await axios.post(`${API_URL}/printers/pair`, { pairingCode: PAIRING_CODE });
    PRINTER_ID = res.data.printerId;
    DEVICE_SECRET = res.data.deviceSecret;
    saveConfig();
    console.log(`Successfully paired! Printer ID: ${PRINTER_ID}`);
  } catch (err: any) {
    console.error('Failed to pair printer:', err.response?.data || err.message);
    process.exit(1);
  }
}

function generateTspl(payload: any): Buffer {
  const t = payload;
  const qrUrl = `http://localhost:3000/queue/${t.publicTokenId}`;
  
  const commands = [
    'SIZE 80 mm, 80 mm',
    'GAP 2 mm, 0 mm',
    'DIRECTION 1',
    'CLS',
    `TEXT 40,40,"3",0,1,1,"${t.organizationName}"`,
    `TEXT 40,80,"3",0,1,1,"Token: ${t.tokenNumber}"`,
    `TEXT 40,120,"2",0,1,1,"${t.departmentName} - ${t.serviceName}"`,
    `TEXT 40,160,"2",0,1,1,"Printed: ${new Date(t.printedAt).toLocaleString()}"`,
    `QRCODE 40,200,L,5,A,0,"${qrUrl}"`,
    'PRINT 1',
    ''
  ];
  return Buffer.from(commands.join('\r\n'), 'utf-8');
}

function generateEscPos(payload: any): Buffer {
  // A simple placeholder for ESC/POS commands
  // Usually you would use node-thermal-printer here
  const commands = [
    '\x1B\x40', // Init
    '\x1B\x61\x01', // Center
    `${payload.organizationName}\n`,
    `Token: ${payload.tokenNumber}\n`,
    `${payload.departmentName} - ${payload.serviceName}\n`,
    `Printed: ${new Date(payload.printedAt).toLocaleString()}\n\n`,
    '\x1D\x56\x41\x03', // Cut
  ];
  return Buffer.from(commands.join(''), 'utf-8');
}

async function printJob(jobId: string, payload: any) {
  console.log(`Processing job ${jobId}...`);
  try {
    // 1. Mark as CLAIMED
    await axios.patch(`${API_URL}/printers/${PRINTER_ID}/jobs/${jobId}`, 
      { status: 'CLAIMED' },
      { headers: { 'x-printer-secret': DEVICE_SECRET } }
    );

    // 2. Generate raw bytes based on printer type
    let rawBuffer: Buffer;
    if (PRINTER_TYPE === 'TSPL') {
      rawBuffer = generateTspl(payload);
    } else {
      rawBuffer = generateEscPos(payload);
    }

    // 3. Save to temp file
    const tempFile = path.join(__dirname, '../temp_print.bin');
    fs.writeFileSync(tempFile, rawBuffer);

    // 4. Print using PowerShell raw-print.ps1 helper securely using env variables
    const scriptPath = path.join(__dirname, '../raw-print.ps1');
    
    const psResult = spawnSync('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `& { . $env:SCRIPT_PATH; [RawPrinterHelper]::SendFileToPrinter($env:TARGET_PRINTER, $env:TEMP_FILE) }`
    ], {
      env: {
        ...process.env,
        SCRIPT_PATH: scriptPath,
        TARGET_PRINTER: PRINTER_NAME,
        TEMP_FILE: tempFile
      }
    });

    if (psResult.status !== 0) {
      throw new Error(`PowerShell print failed: ${psResult.stderr.toString()}`);
    }

    console.log(`Job ${jobId} printed to ${PRINTER_NAME}.`);

    // 5. Mark as PRINTED
    await axios.patch(`${API_URL}/printers/${PRINTER_ID}/jobs/${jobId}`, 
      { status: 'PRINTED' },
      { headers: { 'x-printer-secret': DEVICE_SECRET } }
    );

  } catch (err: any) {
    console.error(`Error processing job ${jobId}:`, err.message);
    try {
      await axios.patch(`${API_URL}/printers/${PRINTER_ID}/jobs/${jobId}`, 
        { status: 'FAILED', lastError: err.message },
        { headers: { 'x-printer-secret': DEVICE_SECRET } }
      );
    } catch (e) {
      // Ignore
    }
  }
}

async function startBridge() {
  loadConfig();
  if (!PRINTER_ID || !DEVICE_SECRET) {
    await pairPrinter();
  }

  console.log(`Bridge started. Target Printer: ${PRINTER_NAME} (${PRINTER_TYPE})`);

  async function fetchPendingJobs() {
    try {
      const res = await axios.get(`${API_URL}/printers/${PRINTER_ID}/jobs`, {
        headers: { 'x-printer-secret': DEVICE_SECRET }
      });
      for (const job of res.data) {
        await printJob(job.jobId, job.payload);
      }
    } catch (err: any) {
      console.error('Failed to fetch pending jobs:', err.message);
    }
  }

  // Initial fetch
  await fetchPendingJobs();

  // Connect to SSE
  const sseUrl = `${API_URL}/printers/${PRINTER_ID}/stream`;
  const es = new EventSource(sseUrl, {
    headers: { 'x-printer-secret': DEVICE_SECRET! }
  });

  es.onopen = async () => {
    console.log('Connected to print job stream. Fetching any missed jobs...');
    await fetchPendingJobs();
  };

  es.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.jobId && data.payload) {
      await printJob(data.jobId, data.payload);
    }
  };

  es.onerror = (err) => {
    console.error('SSE Error:', err);
  };

  // Status heartbeat
  setInterval(async () => {
    try {
      await axios.patch(`${API_URL}/printers/${PRINTER_ID}/health`, 
        { status: 'ONLINE' },
        { headers: { 'x-printer-secret': DEVICE_SECRET } }
      );
    } catch (err) {}
  }, 30000);
}

startBridge();
