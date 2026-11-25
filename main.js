const { app, BrowserWindow, dialog, ipcMain, globalShortcut } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');

const configDirectory = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
require('dotenv').config({ path: path.join(configDirectory, '.env') });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    kiosk: false, // Ubah ke true saat deployment di mesin booth agar terkunci penuh
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Shortcut darurat operator untuk menutup aplikasi: Ctrl + Shift + Q
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });
}

// Handler cetak otomatis tanpa dialog OS (Silent Print)
ipcMain.on('print-photostrip', async (event, payload) => {
  const reportPrintStatus = (status) => {
    if (!event.sender.isDestroyed()) {
      event.reply('print-status', status);
    }
  };
  const imageDataUrl = payload && payload.imageDataUrl;
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    reportPrintStatus({ success: false, errorType: 'invalid-image' });
    return;
  }

  let printers;
  try {
    printers = await mainWindow.webContents.getPrintersAsync();
  } catch (error) {
    reportPrintStatus({
      success: false,
      errorType: 'printer-discovery-failed',
      errorMessage: error.message,
    });
    return;
  }

  const isVirtualPrinter = (printer) =>
    /(pdf|onenote|fax|xps|print to file|save as)/i.test(`${printer.name} ${printer.displayName || ''}`);
  const physicalPrinters = printers.filter((printer) => !isVirtualPrinter(printer));
  const requestedPrinterName = typeof payload.printerName === 'string' ? payload.printerName.trim() : '';
  const printer = requestedPrinterName
    ? physicalPrinters.find((item) => item.name === requestedPrinterName)
    : physicalPrinters.find((item) => item.isDefault) || physicalPrinters[0];

  if (!printer) {
    reportPrintStatus({
      success: false,
      errorType: requestedPrinterName ? 'printer-not-found' : 'no-physical-printer',
      availablePrinters: printers.map((item) => item.displayName || item.name),
    });
    return;
  }

  const isLandscape = payload.orientation === 'landscape';
  const pageWidth = isLandscape ? '6in' : '4in';
  const pageHeight = isLandscape ? '4in' : '6in';
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
    },
  });
  let printCompleted = false;
  const completePrint = (status) => {
    if (printCompleted) return;
    printCompleted = true;
    reportPrintStatus(status);
    if (!printWindow.isDestroyed()) printWindow.close();
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          @page { margin: 0; size: ${pageWidth} ${pageHeight}; }
          html, body { width: ${pageWidth}; height: ${pageHeight}; margin: 0; padding: 0; }
          body { display: flex; justify-content: center; align-items: center; background: #fff; }
          img { width: auto; height: 100%; max-width: 100%; object-fit: contain; display: block; }
        </style>
      </head>
      <body>
        <img src="${imageDataUrl}" />
      </body>
    </html>
  `;

  printWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    completePrint({
      success: false,
      errorType: errorDescription || `load-error-${errorCode}`,
    });
  });
  printWindow.webContents.once('did-finish-load', () => {
    const printOptions = {
      silent: true,
      printBackground: true,
      deviceName: printer.name,
      copies: Math.max(1, Number(payload.copies) || 1),
      margins: { marginType: 'none' },
    };

    try {
      printWindow.webContents.print(printOptions, (success, errorType) => {
        completePrint({
          success,
          errorType: success ? null : errorType || 'printing-failed',
        });
      });
    } catch (error) {
      completePrint({ success: false, errorType: error.message || 'printing-failed' });
    }
  });

  printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent)).catch((error) => {
    completePrint({ success: false, errorType: error.message || 'print-window-load-failed' });
  });
});

const MAX_EMAIL_ZIP_BYTES = 18 * 1024 * 1024;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getZipBuffer(rawZipData) {
  let zipData = null;
  if (Buffer.isBuffer(rawZipData)) {
    zipData = rawZipData;
  } else if (rawZipData instanceof ArrayBuffer) {
    zipData = Buffer.from(rawZipData);
  } else if (ArrayBuffer.isView(rawZipData)) {
    zipData = Buffer.from(rawZipData.buffer, rawZipData.byteOffset, rawZipData.byteLength);
  }
  return zipData && zipData.length >= 4 && zipData.subarray(0, 2).toString('ascii') === 'PK'
    ? zipData
    : null;
}

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const from = (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const secureSetting = (process.env.SMTP_SECURE || '').trim().toLowerCase();

  if (!host || !from) {
    return { errorCode: 'email-not-configured' };
  }
  const validSecureSettings = ['true', 'false', '1', '0', 'yes', 'no'];
  if (
    !EMAIL_ADDRESS_PATTERN.test(from) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    Boolean(user) !== Boolean(pass) ||
    (secureSetting && !validSecureSettings.includes(secureSetting))
  ) {
    return { errorCode: 'email-config-invalid' };
  }

  const secure = secureSetting
    ? ['true', '1', 'yes'].includes(secureSetting)
    : port === 465;

  return {
    config: {
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {}),
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    },
    from,
  };
}

ipcMain.handle('save-photos-zip', async (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { success: false, errorCode: 'download-request-rejected' };
  }

  const zipData = getZipBuffer(payload && payload.zipData);
  if (!zipData) {
    return { success: false, errorCode: 'invalid-download-attachment' };
  }

  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Simpan paket foto SnapBox',
      defaultPath: path.join(app.getPath('downloads'), 'SnapBox_Foto_dan_GIF.zip'),
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, cancelled: true };

    await fs.writeFile(result.filePath, zipData);
    return { success: true };
  } catch (error) {
    console.error('[download] Local save failed:', error.code || error.name || 'unknown-error');
    return { success: false, errorCode: 'download-save-failed' };
  }
});

ipcMain.handle('send-photos-to-email', async (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { success: false, errorCode: 'email-request-rejected' };
  }

  const email = payload && typeof payload.email === 'string' ? payload.email.trim() : '';
  if (email.length > 254 || !EMAIL_ADDRESS_PATTERN.test(email)) {
    return { success: false, errorCode: 'invalid-email' };
  }

  const zipData = getZipBuffer(payload && payload.zipData);
  if (!zipData) {
    return { success: false, errorCode: 'invalid-email-attachment' };
  }
  if (zipData.length > MAX_EMAIL_ZIP_BYTES) {
    return { success: false, errorCode: 'email-attachment-too-large' };
  }

  const smtp = getSmtpConfig();
  if (smtp.errorCode) {
    return { success: false, errorCode: smtp.errorCode };
  }

  let transporter;
  try {
    transporter = nodemailer.createTransport(smtp.config);
    await transporter.sendMail({
      from: { name: 'SnapBox Kiosk', address: smtp.from },
      to: email,
      subject: 'Foto dan GIF sesi SnapBox kamu',
      text: 'Terima kasih sudah berfoto di SnapBox! Foto strip, hasil foto, dan animasi sesi kamu ada di lampiran ZIP.',
      attachments: [{
        filename: 'SnapBox_Foto_dan_GIF.zip',
        content: zipData,
        contentType: 'application/zip',
      }],
    });
    return { success: true };
  } catch (error) {
    console.error('[email] Delivery failed:', error.code || error.name || 'unknown-error');
    return { success: false, errorCode: 'email-send-failed' };
  } finally {
    if (transporter) transporter.close();
  }
});

app.whenReady().then(createWindow);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});