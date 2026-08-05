import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

// Initialize Resend
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function startServer() {
  const app = express();
  if (process.env.K_SERVICE) process.env.PORT = '3000';
  const PORT = parseInt(process.env.PORT || '3000');

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Mock Database (In-Memory for Prototype)
  const db = {
    users: [
      { id: 1, nip: '123456', name: 'Admin User', email: 'admin@puskesmas.com', role: 'admin', password: 'password', office: 'Kantor Induk', group: 'Superadmin' },
      { id: 2, nip: '654321', name: 'Regular User', email: 'user@puskesmas.com', role: 'user', password: 'password', office: 'Pustu A' },
    ],
    employees: [
      { id: '1', name: 'Admin User', nip: '123456', office: 'Kantor Induk', email: 'admin@puskesmas.com', gender: 'Laki-laki', cluster: 'Klaster 1', unit: 'Manajemen' },
      { id: '2', name: 'Regular User', nip: '654321', office: 'Pustu A', email: 'user@puskesmas.com', gender: 'Perempuan', cluster: 'Klaster 2', unit: 'Pustu' }
    ],
    attendance: [],
    locations: [
      { id: 1, name: 'Kantor Induk', lat: -7.250445, lng: 112.768845, radius: 300 },
    ],
    settings: {
      appName: 'Si Abon ELite App',
      companyName: 'Puskesmas Sehat',
      headName: 'Dr. Budi Santoso',
      address: 'Jl. Kesehatan No. 1, Kota Sehat',
      mainLocation: '-7.250445, 112.768845',
      tolerance: 25,
    }
  };

  // Google Spreadsheet Setup
  let doc: GoogleSpreadsheet | null = null;
  let isDocLoaded = false;
  let docLoadPromise: Promise<void> | null = null;
  
  // Cache for spreadsheet data
  const cache: { [key: string]: { data: any; timestamp: number } } = {};
  const inFlightRequests: { [key: string]: Promise<any> } = {};
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
  const syncedSheets = new Set<string>();
  
  async function getCachedData(key: string, fetchFn: () => Promise<any>) {
    if (cache[key] && Date.now() - cache[key].timestamp < CACHE_DURATION) {
      return cache[key].data;
    }
    if (inFlightRequests[key]) {
      return inFlightRequests[key];
    }
    const promise = fetchFn().then(data => {
      cache[key] = { data, timestamp: Date.now() };
      return data;
    }).finally(() => {
      delete inFlightRequests[key];
    });
    inFlightRequests[key] = promise;
    return promise;
  }
  if (process.env.SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    try {
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;
      privateKey = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
      if (!privateKey.includes('\n')) {
        privateKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
          .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----\n')
          .replace(/(.{64})/g, '$1\n');
      }
      console.log('Attempting to connect to Google Sheets...');
      const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
      await doc.loadInfo();
      isDocLoaded = true;
      console.log('Google Spreadsheet connected successfully:', doc.title);
    } catch (error) {
      console.error('Failed to connect to Google Spreadsheet:', error);
      doc = null;
    }
  } else {
    console.warn('Google Sheets environment variables are missing.');
  }

  // Helper to get or create sheet

  // Temporary migration to fix data written to wrong columns
  async function fixMisalignedAttendanceData() {
    if (!doc) return;
    try {
      const sheet = doc.sheetsByTitle['Attendance'];
      if (!sheet) return;
      await sheet.loadHeaderRow();
      
      const idIndex = sheet.headerValues.indexOf('id');
      const nameIndex = sheet.headerValues.indexOf('name');
      const headers = sheet.headerValues;
      
      if (nameIndex >= 9 && idIndex >= 9) {
        console.log('Found misaligned headers, syncing data...');
        const rows = await sheet.getRows();
        
        for (const row of rows) {
          const rawId = (row as any)._rawData[idIndex];
          const rawName = (row as any)._rawData[nameIndex];
          
          if (rawId || rawName) {
            // Read from misaligned columns
            const valId = rawId || (row as any)._rawData[0] || '';
            const valNip = (row as any)._rawData[headers.indexOf('nip')] || (row as any)._rawData[1] || '';
            const valName = rawName || (row as any)._rawData[2] || '';
            const valDate = (row as any)._rawData[headers.indexOf('date')] || (row as any)._rawData[3] || '';
            const valTime = (row as any)._rawData[headers.indexOf('time')] || (row as any)._rawData[4] || '';
            const valType = (row as any)._rawData[headers.indexOf('type')] || (row as any)._rawData[5] || '';
            const valLoc = (row as any)._rawData[headers.indexOf('location')] || (row as any)._rawData[6] || '';
            const valStatus = (row as any)._rawData[headers.indexOf('status')] || (row as any)._rawData[7] || '';
            const valPhoto = (row as any)._rawData[headers.indexOf('photoUrl')] || (row as any)._rawData[8] || '';
            const valShift = (row as any)._rawData[headers.indexOf('shift')] || (row as any)._rawData[9] || '';
            
            // Assign to columns 0-9 using their actual header names
            row.set(headers[0], valId);
            if (headers[1]) row.set(headers[1], valNip);
            if (headers[2]) row.set(headers[2], valName);
            if (headers[3]) row.set(headers[3], valDate);
            if (headers[4]) row.set(headers[4], valTime);
            if (headers[5]) row.set(headers[5], valType);
            if (headers[6]) row.set(headers[6], valLoc);
            if (headers[7]) row.set(headers[7], valStatus);
            if (headers[8]) row.set(headers[8], valPhoto);
            if (headers[9]) row.set(headers[9], valShift);
            
            // Clear ONLY the misaligned standard columns, preserve custom formulas
            const standardKeys = ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift'];
            for(let i = 10; i < headers.length; i++) {
                if (standardKeys.includes(headers[i])) {
                  row.set(headers[i], '');
                }
            }
            await row.save();
          }
        }
        
        // Remove the appended headers
        // Instead of slicing blindly, filter out the duplicated standard headers that were appended
        const standardKeys = ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift'];
        let newHeaders = [];
        let standardKeysFound = new Set();
        
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i];
          if (standardKeys.includes(h)) {
            // Keep only the first occurrence (which might be the ones they renamed? Wait, if they renamed it, it wouldn't match standardKeys)
            // If they renamed 'name' to 'Nama', then 'name' is appended at the end. We want to remove the appended 'name'.
            // Actually, we want to remove the exact block of appended headers.
            // But to be safe, just remove any header that exactly matches the standardKeys IF its index is >= 10.
            if (i >= 10) {
              newHeaders.push(''); // blank out the duplicated header
            } else {
              newHeaders.push(h);
            }
          } else {
            newHeaders.push(h); // keep custom headers like 'Jam Pulang'
          }
        }
        
        // Remove trailing empty headers
        while(newHeaders.length > 0 && newHeaders[newHeaders.length - 1] === '') {
          newHeaders.pop();
        }
        
        await sheet.setHeaderRow(newHeaders);
        console.log('Sync complete.');
      }
    } catch (e) {
      console.error('Error during data sync:', e);
    }
  }

  async function getSheet(title: string) {
    if (!doc) {
      console.error(`Cannot get sheet '${title}': Spreadsheet not connected.`);
      return null;
    }
    try {
      // Ensure doc is loaded
      if (!isDocLoaded) {
        if (!docLoadPromise) {
          docLoadPromise = (async () => {
            try {
              if (doc) await doc.loadInfo();
              isDocLoaded = true;
            } finally {
              docLoadPromise = null;
            }
          })();
        }
        await docLoadPromise;
      }
      const sheet = doc.sheetsByTitle[title];
      if (!sheet) {
        console.error(`Sheet '${title}' not found in spreadsheet.`);
        return null;
      }
      return sheet;
    } catch (error) {
      console.error(`Error getting sheet ${title}:`, error);
      return null;
    }
  }

  // Helper to get or create sheet
  async function getOrCreateSheet(title: string, headerValues: string[]) {
    let sheet = await getSheet(title);
    if (!sheet && doc) {
      sheet = await doc.addSheet({ title, headerValues });
      syncedSheets.add(title);
    } else if (sheet && !syncedSheets.has(title)) {
      try {
        await sheet.loadHeaderRow();
        if (sheet.headerValues.length === 0) {
          await sheet.setHeaderRow(headerValues);
        }
        syncedSheets.add(title);
      } catch (e) {
        // If sheet is empty, loadHeaderRow might throw. Set headers directly.
        await sheet.setHeaderRow(headerValues);
        syncedSheets.add(title);
      }
    }
    return sheet;
  }

  // API Routes

  // --- Employees API ---
  app.get('/api/employees', async (req, res) => {
    if (doc) {
      try {
        const employees = await getCachedData('employees', async () => {
          const sheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
                id: row.get('id'),
                name: row.get('name'),
                nip: row.get('nip'),
                office: row.get('office'),
                office2: row.get('office2'),
                email: row.get('email'),
                gender: row.get('gender'),
                cluster: row.get('cluster'),
                unit: row.get('unit'),
                password: row.get('password'),
                photoUrl: row.get('photoUrl'),
                photoUploadCount: row.get('photoUploadCount') ? parseInt(row.get('photoUploadCount'), 10) : 0
            }));
          }
          return [];
        });
        return res.json(employees);
      } catch (error) {
        console.error('Error fetching employees:', error);
        return res.status(500).send('Error fetching employees');
      }
    } else {
      return res.json(db.employees || []);
    }
  });

  app.post('/api/employees', async (req, res) => {
    try {
      const emp = req.body;
      if (doc) {
        const sheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
        if (sheet) {
          await sheet.addRow({
            id: emp.id || Date.now().toString(),
            name: emp.name || '',
            nip: emp.nip || '',
            office: emp.office || '',
            office2: emp.office2 || '',
            email: emp.email || '',
            gender: emp.gender || '',
            cluster: emp.cluster || '',
            unit: emp.unit || '',
            password: emp.password || '123456',
            photoUrl: emp.photoUrl || '',
            photoUploadCount: emp.photoUploadCount || 0
          });
          delete cache['employees'];
        }
      }
      res.json({ success: true, message: 'Berhasil' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/employees/:id', async (req, res) => {
    try {
      const emp = req.body;
      if (doc) {
        const sheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.get('id') === req.params.id);
          if (row) {
            if (emp.name !== undefined) row.set('name', emp.name);
            if (emp.nip !== undefined) row.set('nip', emp.nip);
            if (emp.office !== undefined) row.set('office', emp.office);
            if (emp.office2 !== undefined) row.set('office2', emp.office2);
            if (emp.email !== undefined) row.set('email', emp.email);
            if (emp.gender !== undefined) row.set('gender', emp.gender);
            if (emp.cluster !== undefined) row.set('cluster', emp.cluster);
            if (emp.unit !== undefined) row.set('unit', emp.unit);
            if (emp.password !== undefined) row.set('password', emp.password);
            if (emp.photoUrl !== undefined) row.set('photoUrl', emp.photoUrl);
            if (emp.photoUploadCount !== undefined) row.set('photoUploadCount', emp.photoUploadCount);
            await row.save();
            delete cache['employees'];
          }
        }
      }
      res.json({ success: true, message: 'Berhasil' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/employees/:id', async (req, res) => {
    try {
      if (doc) {
        const sheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.get('id') === req.params.id);
          if (row) {
            await row.delete();
            delete cache['employees'];
          }
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/employees/bulk', async (req, res) => {
    try {
      const records = req.body;
      if (doc) {
        const sheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
        if (sheet) {
          const rowsToAdd = records.map((emp, index) => ({
            id: emp.id || (Date.now() + index).toString(),
            name: emp.name || '',
            nip: emp.nip || '',
            office: emp.office || '',
            office2: emp.office2 || '',
            email: emp.email || '',
            gender: emp.gender || '',
            cluster: emp.cluster || '',
            unit: emp.unit || '',
            password: emp.password || '123456',
            photoUrl: emp.photoUrl || '',
            photoUploadCount: emp.photoUploadCount || 0
          }));
          await sheet.addRows(rowsToAdd);
          delete cache['employees'];
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admins', async (req, res) => {
    if (doc) {
      try {
        const admins = await getCachedData('admins', async () => {
          const sheet = await getOrCreateSheet('Admins', ['id', 'name', 'nip', 'email', 'phone', 'group', 'isActive', 'access', 'password']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
              id: row.get('id'),
              name: row.get('name'),
              nip: row.get('nip'),
              email: row.get('email'),
              phone: row.get('phone'),
              group: row.get('group'),
              isActive: String(row.get('isActive')).toLowerCase() === 'true',
              access: row.get('access') ? JSON.parse(row.get('access')) : [],
              password: row.get('password')
            }));
          }
          return [];
        });
        return res.json(admins);
      } catch (error) { return res.status(500).send('Error'); }
    } else { return res.json(db.users || []); }
  });

  app.post('/api/admins', async (req, res) => {
    try {
      const admin = req.body;
      if (doc) {
        const sheet = await getOrCreateSheet('Admins', ['id', 'name', 'nip', 'email', 'phone', 'group', 'isActive', 'access', 'password']);
        if (sheet) {
          await sheet.addRow({
            id: admin.id || Date.now().toString(),
            name: admin.name || '',
            nip: admin.nip || '',
            email: admin.email || '',
            phone: admin.phone || '',
            group: admin.group || '',
            isActive: String(admin.isActive !== false),
            access: JSON.stringify(admin.access || []),
            password: admin.password || 'password'
          });
          delete cache['admins'];
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admins/:id', async (req, res) => {
    try {
      const admin = req.body;
      if (doc) {
        const sheet = await getOrCreateSheet('Admins', ['id', 'name', 'nip', 'email', 'phone', 'group', 'isActive', 'access', 'password']);
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.get('id') === req.params.id);
          if (row) {
            if (admin.name !== undefined) row.set('name', admin.name);
            if (admin.nip !== undefined) row.set('nip', admin.nip);
            if (admin.email !== undefined) row.set('email', admin.email);
            if (admin.phone !== undefined) row.set('phone', admin.phone);
            if (admin.group !== undefined) row.set('group', admin.group);
            if (admin.isActive !== undefined) row.set('isActive', String(admin.isActive));
            if (admin.access !== undefined) row.set('access', JSON.stringify(admin.access));
            if (admin.password !== undefined) row.set('password', admin.password);
            await row.save();
            delete cache['admins'];
          }
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admins/:id', async (req, res) => {
    try {
      if (doc) {
        const sheet = await getOrCreateSheet('Admins', ['id', 'name', 'nip', 'email', 'phone', 'group', 'isActive', 'access', 'password']);
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.get('id') === req.params.id);
          if (row) {
            await row.delete();
            delete cache['admins'];
          }
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/device-bindings/:nip', async (req, res) => {
    try {
      if (doc) {
        const sheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.get('nip') === req.params.nip);
          if (row) {
            row.set('photoUploadCount', '0');
            await row.save();
            delete cache['employees'];
          }
        }
      }
      res.json({ success: true, message: "Perangkat berhasil direset" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { nip, password } = req.body;
      let user = null;
      if (doc) {
        const adminsSheet = await getOrCreateSheet('Admins', ['id', 'name', 'nip', 'email', 'phone', 'group', 'isActive', 'access', 'password']);
        if (adminsSheet) {
          const rows = await adminsSheet.getRows();
          const row = rows.find(r => r.get('nip') === nip && r.get('password') === password);
          if (row) {
            user = {
              id: row.get('id'),
              nip: row.get('nip'),
              name: row.get('name'),
              role: 'admin',
              group: row.get('group'),
              access: row.get('access') ? JSON.parse(row.get('access')) : []
            };
          }
        }
        if (!user) {
          const empsSheet = await getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']);
          if (empsSheet) {
            const rows = await empsSheet.getRows();
            const row = rows.find(r => r.get('nip') === nip && r.get('password') === password);
            if (row) {
              user = {
                id: row.get('id'),
                nip: row.get('nip'),
                name: row.get('name'),
                role: 'user',
                office: row.get('office'),
                office2: row.get('office2'),
                unit: row.get('unit') || ''
              };
            }
          }
        }
      }
      
      if (user) {
        res.json({ success: true, user });
      } else {
        res.status(401).json({ success: false, message: 'NIP atau kata sandi salah' });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/attendance', async (req, res) => {
    let allAttendance: any[] = [];
    const { startDate, endDate } = req.query;
    if (doc) {
      try {
        allAttendance = await getCachedData('attendance', async () => {
          const sheet = await getOrCreateSheet('Attendance', ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => {
              const loc = (row as any)._rawData[6] || row.get('location');
              let locationVal = loc;
              try { locationVal = JSON.parse(loc); } catch (e) {}
              const pUrl = (row as any)._rawData[8] || row.get('photoUrl') || '';
              const idVal = (row as any)._rawData[0] || row.get('id');
              
              return {
                id: idVal,
                nip: (row as any)._rawData[1] || row.get('nip'),
                name: (row as any)._rawData[2] || row.get('name'),
                date: (row as any)._rawData[3] || row.get('date'),
                time: (row as any)._rawData[4] || row.get('time'),
                type: (row as any)._rawData[5] || row.get('type'),
                location: locationVal,
                status: (row as any)._rawData[7] || row.get('status'),
                photoUrl: pUrl.startsWith('data:image') ? `/api/attendance/${idVal}/photo` : pUrl,
                shift: (row as any)._rawData[9] || row.get('shift')
              };
            });
          }
          return [];
        });
      } catch (error) {
        console.error('Error fetching attendance from spreadsheet:', error);
      }
    } else {
      allAttendance = db.attendance || [];
    }

    const filterByDateRange = (start: string, end: string) => {
      return allAttendance.filter(a => {
        const aStart = a.date;
        const aEnd = (a.location && typeof a.location === 'object' && a.location.endDate) ? a.location.endDate : a.date;
        return aStart <= end && aEnd >= start;
      });
    };

    let filteredAttendance = allAttendance;
    if (startDate && endDate) {
      filteredAttendance = filterByDateRange(startDate as string, endDate as string);
    } else {
      // Default to last month and current month if no range given 
      const today = new Date();
      const prevMonthObj = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const firstDay = `${prevMonthObj.getFullYear()}-${String(prevMonthObj.getMonth() + 1).padStart(2, '0')}-01`;
      
      const nextMonthObj = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const nextMonthEnd = `${nextMonthObj.getFullYear()}-${String(nextMonthObj.getMonth() + 1).padStart(2, '0')}-${String(nextMonthObj.getDate()).padStart(2, '0')}`;
      filteredAttendance = filterByDateRange(firstDay, nextMonthEnd);
    }

    return res.json(filteredAttendance);
  });

  app.get('/api/attendance/:id/photo', async (req, res) => {
    try {
      const sheet = await getOrCreateSheet('Attendance', ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift']);
      if (!sheet) return res.status(500).send('Database unavailable');
      
      const rows = await sheet.getRows();
      const targetRow = rows.find(row => ((row as any)._rawData[0] || row.get('id')) === req.params.id);
      if (!targetRow) return res.status(404).send('Not found');
      
      const photoUrl = (targetRow as any)._rawData[8] || targetRow.get('photoUrl');
      if (!photoUrl || !photoUrl.startsWith('data:image')) {
        return res.status(404).send('No image for this record');
      }
      
      // photoUrl format is usually like: data:image/jpeg;base64,/9j/4AAQ...
      const matches = photoUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
         return res.status(400).send('Invalid image data');
      }
      
      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      
      res.set('Content-Type', mimeType);
      res.send(buffer);
    } catch (e) {
      console.error(e);
      res.status(500).send('Internal error');
    }
  });

  app.post('/api/attendance', async (req, res) => {
    const attendanceData = req.body;
    // attendanceData: { nip, name, date, time, type, location, status, photoUrl }
    
    // Prevent overriding timezone from client. Enforce Server Time (Asia/Jakarta)
    if (attendanceData.type === 'in' || attendanceData.type === 'out') {
      const now = new Date();
      
      const timeFormatter = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
      let serverTimeStr = timeFormatter.format(now).replace('.', ':');
      attendanceData.time = serverTimeStr;

      if (attendanceData.type === 'in') {
        const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = dateFormatter.formatToParts(now);
        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        const day = parts.find(p => p.type === 'day')?.value;
        attendanceData.date = `${year}-${month}-${day}`;
      }
    }

    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Attendance', ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift']);
        if (sheet) {
          // Google Sheets cell limit is 50,000 characters.
          // Base64 images can easily exceed this.
          let photoUrlToSave = attendanceData.photoUrl || '';
          if (photoUrlToSave.length > 49000) {
             // If it's too large, we can't save the full image in a single cell.
             // Ideally, save to cloud storage and store URL. For now, truncate or store a placeholder.
             photoUrlToSave = 'Image too large to save in spreadsheet';
             console.warn('Attendance photoUrl exceeded 50000 characters, replacing with placeholder.');
          }

          const idToSave = Date.now().toString();
          const rowArray = [
            idToSave,
            attendanceData.nip || '',
            attendanceData.name || '',
            attendanceData.date || '',
            attendanceData.time || '',
            attendanceData.type || '',
            typeof attendanceData.location === 'object' ? JSON.stringify(attendanceData.location) : (attendanceData.location || ''),
            attendanceData.status || '',
            photoUrlToSave,
            attendanceData.shift || ''
          ];
          await sheet.addRow(rowArray);
          delete cache['attendance'];
        }
      } catch (error) {
        console.error('Error saving attendance to spreadsheet:', error);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan absensi ke spreadsheet. Mungkin ukuran foto terlalu besar.' });
      }
    } else {
      db.attendance.push({ id: Date.now().toString(), ...attendanceData } as any);
    }

    res.json({ success: true, message: 'Absensi berhasil dicatat' });
  });

  app.post('/api/attendance/bulk', async (req, res) => {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.json({ success: true, message: 'No records to add' });
    }
    
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Attendance', ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift']);
        if (sheet) {
          const rowsToAdd = records.map((attendanceData: any, index: number) => [
            (Date.now() + index).toString(),
            attendanceData.nip || '',
            attendanceData.name || '',
            attendanceData.date || '',
            attendanceData.time || '',
            attendanceData.type || '',
            typeof attendanceData.location === 'object' ? JSON.stringify(attendanceData.location) : (attendanceData.location || ''),
            attendanceData.status || '',
            attendanceData.photoUrl || '',
            attendanceData.shift || ''
          ]);
          await sheet.addRows(rowsToAdd);
          delete cache['attendance'];
        }
      } catch (error) {
        console.error('Error saving bulk attendance:', error);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan bulk absensi.' });
      }
    } else {
      records.forEach((rec: any, i: number) => {
        db.attendance.push({ id: (Date.now() + i).toString(), ...rec } as any);
      });
    }

    res.json({ success: true, message: 'Bulk absensi berhasil dicatat' });
  });

  app.post('/api/attendance/auto-checkout-check', async (req, res) => {
    if (!doc) return res.json({ success: true, fixedCount: 0 });

    try {
      // Get necessary data
      const [attSheet, empSheet, shiftSheet] = await Promise.all([
        getOrCreateSheet('Attendance', ['id', 'nip', 'name', 'date', 'time', 'type', 'location', 'status', 'photoUrl', 'shift']),
        getOrCreateSheet('Employees', ['id', 'name', 'nip', 'office', 'office2', 'email', 'gender', 'cluster', 'unit', 'password', 'photoUrl', 'photoUploadCount']),
        getOrCreateSheet('Shifts', ['id', 'name', 'startTime', 'endTime', 'fridayEndTime', 'saturdayEndTime', 'checkInBeforeMinutes', 'checkInAfterMinutes', 'checkOutBeforeMinutes', 'checkOutAfterMinutes', 'crossesMidnight', 'isActive', 'unit', 'isOffSunday', 'isOffHoliday'])
      ]);

      if (!attSheet || !empSheet || !shiftSheet) return res.json({ success: false });

      const [attRows, empRows, shiftRows] = await Promise.all([
        attSheet.getRows(),
        empSheet.getRows(),
        shiftSheet.getRows()
      ]);

      const attendance = attRows.map(r => ({
        nip: r.get('nip'), name: r.get('name'), date: r.get('date'),
        time: r.get('time'), type: r.get('type'), location: r.get('location'),
        status: r.get('status'), shift: r.get('shift') || ''
      }));

      const employees = empRows.map(r => ({ nip: r.get('nip'), unit: r.get('unit') }));
      const shifts = shiftRows.map(r => ({
        name: r.get('name'), startTime: r.get('startTime'), endTime: r.get('endTime'),
        fridayEndTime: r.get('fridayEndTime') || '', saturdayEndTime: r.get('saturdayEndTime') || '',
        checkOutAfterMinutes: parseInt(r.get('checkOutAfterMinutes') || '120'),
        crossesMidnight: String(r.get('crossesMidnight')).toLowerCase() === 'true',
        isActive: String(r.get('isActive')).toLowerCase() === 'true',
        unit: r.get('unit') || ''
      }));

      // Find 'in' records without 'out' records
      const inRecords = attendance.filter(a => a.type === 'in');
      const outRecords = attendance.filter(a => a.type === 'out');
      const now = new Date();
      
      const missingOuts = [];

      for (const inRec of inRecords) {
        if (outRecords.some(o => o.nip === inRec.nip && o.date === inRec.date && o.shift === inRec.shift && o.status === inRec.status)) continue;

        // Determine this record's shift
        let targetShift = shifts.find(s => s.name === inRec.shift);
        if (!targetShift) {
          const empUnit = employees.find(e => e.nip === inRec.nip)?.unit || '';
          const activeShifts = shifts.filter(s => s.isActive);
          const specificShifts = activeShifts.filter(s => s.unit && s.unit === empUnit);
          // Simplified fallback: pick first matching shift or first overall
          targetShift = specificShifts[0] || activeShifts.filter(s => !s.unit || s.unit === 'none' || s.unit === '')[0] || shifts[0];
        }

        if (!targetShift) continue;

        // Determine correct end time based on day of week
        const recDateObj = new Date(inRec.date);
        const isFriday = recDateObj.getDay() === 5;
        const isSaturday = recDateObj.getDay() === 6;
        let endTimeStr = targetShift.endTime;
        if (isFriday && targetShift.fridayEndTime) endTimeStr = targetShift.fridayEndTime;
        if (isSaturday && targetShift.saturdayEndTime) endTimeStr = targetShift.saturdayEndTime;

        if (!endTimeStr) continue;

        // Construct absolute end time limit
        const [endHr, endMin] = endTimeStr.split(':').map(Number);
        const endDateTime = new Date(inRec.date);
        endDateTime.setHours(endHr, endMin, 0, 0);

        if (targetShift.crossesMidnight) {
          endDateTime.setDate(endDateTime.getDate() + 1);
        }

        // Add tolerance
        endDateTime.setMinutes(endDateTime.getMinutes() + targetShift.checkOutAfterMinutes);

        // If 'now' is past the maximum allowed checkout time, auto-checkout
        if (now > endDateTime) {
          const autoCheckoutHour = (endHr - 1 + 24) % 24;
          const autoCheckoutTimeStr = `${autoCheckoutHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`;

          missingOuts.push({
            id: (Date.now() + missingOuts.length).toString(),
            nip: inRec.nip,
            name: inRec.name,
            date: inRec.date,
            time: autoCheckoutTimeStr,
            type: 'out',
            location: inRec.location,
            status: 'Hadir (Pulang Cepat)',
            photoUrl: '', // Auto checkout has no photo
            shift: targetShift.name
          });
        }
      }

      if (missingOuts.length > 0) {
        await attSheet.addRows(missingOuts);
        delete cache['attendance'];
        return res.json({ success: true, fixedCount: missingOuts.length });
      }

      return res.json({ success: true, fixedCount: 0 });

    } catch (error) {
      console.error('Error auto-checkout:', error);
      return res.status(500).json({ success: false, message: 'Gagal auto-checkout' });
    }
  });

  app.put('/api/attendance/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (doc) {
      try {
        const sheet = await getSheet('Attendance');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToUpdate = rows.find(r => r.get('id') === id);
          if (rowToUpdate) {
            rowToUpdate.set('status', status);
            await rowToUpdate.save();
            delete cache['attendance'];
            return res.json({ success: true, message: 'Status berhasil diperbarui' });
          } else {
            return res.status(404).json({ success: false, message: 'Absensi tidak ditemukan' });
          }
        }
      } catch (error) {
        console.error('Error updating attendance status:', error);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
      }
    }
    
    // In-memory fallback
    const record = db.attendance.find((a: any) => a.id === id);
    if (record) {
      record.status = status;
      return res.json({ success: true, message: 'Status berhasil diperbarui' });
    }
    return res.status(404).json({ success: false, message: 'Absensi tidak ditemukan' });
  });

  app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    let foundUser = null;
    let userType = '';

    if (doc) {
      try {
        // Check Admins
        const adminSheet = await getSheet('Admins');
        if (adminSheet) {
          const rows = await adminSheet.getRows();
          const admin = rows.find(r => r.get('email') === email);
          if (admin) {
            foundUser = { id: admin.get('id'), name: admin.get('name'), email: admin.get('email') };
            userType = 'admin';
          }
        }

        // Check Employees if not found
        if (!foundUser) {
          const empSheet = await getSheet('Employees');
          if (empSheet) {
            const rows = await empSheet.getRows();
            const emp = rows.find(r => r.get('email') === email);
            if (emp) {
              foundUser = { id: emp.get('id'), name: emp.get('name'), email: emp.get('email') };
              userType = 'employee';
            }
          }
        }
        
        // Check Users if not found
        if (!foundUser) {
          const userSheet = await getSheet('Users');
          if (userSheet) {
            const rows = await userSheet.getRows();
            const user = rows.find(r => r.get('email') === email);
            if (user) {
              foundUser = { id: user.get('id'), name: user.get('name'), email: user.get('email') };
              userType = 'user';
            }
          }
        }
      } catch (error) {
        console.error('Error checking email in spreadsheet:', error);
      }
    }

    if (!foundUser) {
      const user = db.users.find(u => u.email === email);
      if (user) {
        foundUser = user;
        userType = 'user';
      } else {
        const emp = db.employees.find(e => e.email === email);
        if (emp) {
          foundUser = emp;
          userType = 'employee';
        }
      }
    }

    if (!foundUser) {
      // Return success anyway to prevent email enumeration
      return res.json({ success: true, message: 'Jika email terdaftar, tautan reset telah dikirim.' });
    }

    // Generate a simple token (in a real app, use a secure random token and save it to DB with expiration)
    const token = Buffer.from(`${foundUser.id}:${userType}:${Date.now()}`).toString('base64');
    
    // Save token to spreadsheet
    if (doc) {
      try {
        const resetSheet = await getOrCreateSheet('PasswordResets', ['token', 'userId', 'userType', 'expiresAt']);
        if (resetSheet) {
          await resetSheet.addRow({
            token,
            userId: foundUser.id,
            userType,
            expiresAt: Date.now() + 3600000 // 1 hour
          });
        }
      } catch (error) {
        console.error('Error saving reset token:', error);
      }
    }

    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;

    if (resend) {
      try {
        await resend.emails.send({
          from: 'Si Abon Megilan <noreplay@siabonmegilan.qzz.io>',
          to: foundUser.email,
          subject: 'Reset Password - Si Abon Megilan',
          html: `<p>Halo ${foundUser.name},</p><p>Klik tautan berikut untuk mereset password Anda:</p><p><a href="${resetLink}">${resetLink}</a></p><p>Tautan ini akan kedaluwarsa dalam 1 jam.</p>`,
        });
      } catch (error) {
        console.error('Error sending email via Resend:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengirim email. Pastikan API Key Resend valid.' });
      }
    } else {
      console.log(`[MOCK EMAIL] To: ${foundUser.email}, Subject: Reset Password, Link: ${resetLink}`);
      // For testing without Resend API key, we return the link in the response (only in dev!)
      return res.json({ success: true, message: 'Email reset password telah dikirim (Mock Mode)', mockLink: resetLink });
    }

    res.json({ success: true, message: 'Email reset password telah dikirim' });
  });

  app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token dan password baru wajib diisi' });
    }

    let userId = '';
    let userType = '';
    let isValidToken = false;

    if (doc) {
      try {
        const resetSheet = await getSheet('PasswordResets');
        if (resetSheet) {
          const rows = await resetSheet.getRows();
          const tokenRow = rows.find(r => r.get('token') === token);
          
          if (tokenRow) {
            const expiresAt = parseInt(tokenRow.get('expiresAt'));
            if (Date.now() > expiresAt) {
              return res.status(400).json({ success: false, message: 'Token reset password telah kedaluwarsa' });
            }
            userId = tokenRow.get('userId');
            userType = tokenRow.get('userType');
            isValidToken = true;
            
            // Delete used token
            await tokenRow.delete();
          }
        }
      } catch (error) {
        console.error('Error verifying token:', error);
      }
    }

    // Fallback to decoding token if not using spreadsheet (for mock DB)
    if (!isValidToken) {
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const parts = decoded.split(':');
        if (parts.length === 3) {
          userId = parts[0];
          userType = parts[1];
          const timestamp = parseInt(parts[2]);
          if (Date.now() - timestamp < 3600000) {
            isValidToken = true;
          } else {
            return res.status(400).json({ success: false, message: 'Token reset password telah kedaluwarsa' });
          }
        }
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Token tidak valid' });
      }
    }

    if (!isValidToken) {
      return res.status(400).json({ success: false, message: 'Token tidak valid' });
    }

    // Update password
    let passwordUpdated = false;
    if (doc) {
      try {
        let sheetName = '';
        if (userType === 'admin') sheetName = 'Admins';
        else if (userType === 'employee') sheetName = 'Employees';
        else if (userType === 'user') sheetName = 'Users';

        if (sheetName) {
          const sheet = await getSheet(sheetName);
          if (sheet) {
            const rows = await sheet.getRows();
            const userRow = rows.find(r => r.get('id') === userId);
            if (userRow) {
              userRow.set('password', newPassword);
              await userRow.save();
              passwordUpdated = true;
              
              if (userType === 'user') {
                const userNip = userRow.get('nip');
                if (userNip) {
                  const empSheet = await getSheet('Employees');
                  if (empSheet) {
                    const empRows = await empSheet.getRows();
                    const empRow = empRows.find(r => r.get('nip') === userNip);
                    if (empRow) {
                      empRow.set('password', newPassword);
                      await empRow.save();
                    }
                  }
                }
              }
              
              // Clear cache
              if (sheetName === 'Admins') delete cache['admins'];
              if (sheetName === 'Employees') delete cache['employees'];
            }
          }
        }
      } catch (error) {
        console.error('Error updating password:', error);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui password' });
      }
    }

    if (!passwordUpdated) {
      // Update mock DB
      if (userType === 'admin' || userType === 'user') {
        const user = db.users.find(u => u.id.toString() === userId);
        if (user) {
          user.password = newPassword;
          passwordUpdated = true;
        }
      } else if (userType === 'employee') {
        const emp = db.employees.find(e => e.id === userId);
        if (emp) {
          (emp as any).password = newPassword;
          passwordUpdated = true;
        }
      }
    }

    if (passwordUpdated) {
      res.json({ success: true, message: 'Password berhasil diperbarui' });
    } else {
      res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
    }
  });

  app.get('/api/users', (req, res) => {
    res.json(db.users.map(u => ({ id: u.id, nip: u.nip, name: u.name, role: u.role })));
  });

  // --- Locations API ---
  app.get('/api/locations', async (req, res) => {
    if (doc) {
      try {
        const locations = await getCachedData('locations', async () => {
          const sheet = await getOrCreateSheet('Locations', ['id', 'name', 'desa', 'kecamatan', 'kabupaten', 'coordinates', 'radius']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
              id: row.get('id'),
              desa: row.get('desa') || row.get('name') || '',
              kecamatan: row.get('kecamatan') || '',
              kabupaten: row.get('kabupaten') || '',
              coordinates: row.get('coordinates'),
              radius: row.get('radius') || 250
            }));
          }
          return [];
        });
        return res.json(locations);
      } catch (error) {
        console.error('Error fetching locations from spreadsheet:', error);
      }
    }
    res.json([
      { id: "1", desa: "Kantor Induk", kecamatan: "", kabupaten: "", coordinates: "-7.1234, 112.1234", radius: 250 },
      { id: "2", desa: "Pustu A", kecamatan: "", kabupaten: "", coordinates: "-7.1235, 112.1235", radius: 250 }
    ]);
  });

  app.post('/api/locations', async (req, res) => {
    const location = req.body;
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Locations', ['id', 'name', 'desa', 'kecamatan', 'kabupaten', 'coordinates', 'radius']);
        if (sheet) {
          await sheet.addRow({
            id: Date.now().toString(),
            name: location.desa || '',
            desa: location.desa || '',
            kecamatan: location.kecamatan || '',
            kabupaten: location.kabupaten || '',
            coordinates: location.coordinates || '',
            radius: location.radius || 250
          });
          delete cache['locations'];
        }
      } catch (error) {
        console.error('Error saving location to spreadsheet:', error);
      }
    }
    res.json({ success: true, message: 'Lokasi berhasil ditambahkan' });
  });

  app.delete('/api/locations/:id', async (req, res) => {
    const { id } = req.params;
    if (doc) {
      try {
        const sheet = await getSheet('Locations');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToDelete = rows.find(r => String(r.get('id')) === String(id));
          if (rowToDelete) {
            await rowToDelete.delete();
            delete cache['locations'];
          }
        }
      } catch (error) {
        console.error('Error deleting location from spreadsheet:', error);
      }
    }
    res.json({ success: true, message: 'Lokasi berhasil dihapus' });
  });

  // --- Units API ---
  app.get('/api/units', async (req, res) => {
    if (doc) {
      try {
        const units = await getCachedData('units', async () => {
          const sheet = await getOrCreateSheet('Units', ['id', 'name']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
              id: row.get('id'),
              name: row.get('name')
            }));
          }
          return [];
        });
        return res.json(units);
      } catch (error) {
        console.error('Error fetching units:', error);
      }
    }
    res.json((db as any).units || []);
  });

  app.post('/api/units', async (req, res) => {
    const unit = req.body;
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Units', ['id', 'name']);
        if (sheet) {
          if (unit.id) {
            const rows = await sheet.getRows();
            const existingRow = rows.find(r => r.get('id') === unit.id);
            if (existingRow) {
              existingRow.set('name', unit.name || '');
              await existingRow.save();
            } else {
              await sheet.addRow(unit);
            }
          } else {
            unit.id = Date.now().toString();
            await sheet.addRow(unit);
          }
          delete cache['units'];
        }
      } catch (error) {
        console.error('Error saving unit:', error);
      }
    } else {
      unit.id = unit.id || Date.now().toString();
      if (!(db as any).units) (db as any).units = [];
      const index = (db as any).units.findIndex((u: any) => u.id === unit.id);
      if (index >= 0) (db as any).units[index] = unit;
      else (db as any).units.push(unit);
    }
    res.json({ success: true, message: 'Unit berhasil disimpan' });
  });

  app.delete('/api/units/:id', async (req, res) => {
    const { id } = req.params;
    if (doc) {
      try {
        const sheet = await getSheet('Units');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToDelete = rows.find(r => String(r.get('id')) === String(id));
          if (rowToDelete) {
            await rowToDelete.delete();
            delete cache['units'];
          }
        }
      } catch (error) {
        console.error('Error deleting unit:', error);
      }
    } else {
       if ((db as any).units) (db as any).units = (db as any).units.filter((u: any) => u.id !== id);
    }
    res.json({ success: true, message: 'Unit berhasil dihapus' });
  });

  // --- Shifts API ---
  app.get('/api/shifts', async (req, res) => {
    if (doc) {
      try {
        const shifts = await getCachedData('shifts', async () => {
          const sheet = await getOrCreateSheet('Shifts', ['id', 'name', 'startTime', 'endTime', 'fridayEndTime', 'saturdayEndTime', 'checkInBeforeMinutes', 'checkInAfterMinutes', 'checkOutBeforeMinutes', 'checkOutAfterMinutes', 'crossesMidnight', 'isActive', 'unit', 'isOffSunday', 'isOffHoliday']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
              id: row.get('id'),
              name: row.get('name'),
              startTime: row.get('startTime'),
              endTime: row.get('endTime'),
              fridayEndTime: row.get('fridayEndTime') || '',
              saturdayEndTime: row.get('saturdayEndTime') || '',
              checkInBeforeMinutes: parseInt(row.get('checkInBeforeMinutes') || '60'),
              checkInAfterMinutes: parseInt(row.get('checkInAfterMinutes') || '15'),
              checkOutBeforeMinutes: parseInt(row.get('checkOutBeforeMinutes') || '10'),
              checkOutAfterMinutes: parseInt(row.get('checkOutAfterMinutes') || '120'),
              crossesMidnight: String(row.get('crossesMidnight')).toLowerCase() === 'true',
              isActive: String(row.get('isActive')).toLowerCase() === 'true',
              unit: row.get('unit') || '',
              isOffSunday: String(row.get('isOffSunday')).toLowerCase() === 'true',
              isOffHoliday: String(row.get('isOffHoliday')).toLowerCase() === 'true'
            }));
          }
          return [];
        });
        return res.json(shifts);
      } catch (error) {
        console.error('Error fetching shifts from spreadsheet:', error);
      }
    }
    res.json([
      { id: "1", name: "Pagi", startTime: "08:00", endTime: "16:00", fridayEndTime: "10:50", saturdayEndTime: "12:30", checkInBeforeMinutes: 60, checkInAfterMinutes: 15, checkOutBeforeMinutes: 10, checkOutAfterMinutes: 120, crossesMidnight: false, isActive: true, unit: "" },
      { id: "2", name: "Malam", startTime: "20:00", endTime: "04:00", fridayEndTime: "", saturdayEndTime: "", checkInBeforeMinutes: 60, checkInAfterMinutes: 15, checkOutBeforeMinutes: 10, checkOutAfterMinutes: 120, crossesMidnight: true, isActive: true, unit: "" }
    ]);
  });

  app.post('/api/shifts', async (req, res) => {
    const shift = req.body;
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Shifts', ['id', 'name', 'startTime', 'endTime', 'fridayEndTime', 'saturdayEndTime', 'checkInBeforeMinutes', 'checkInAfterMinutes', 'checkOutBeforeMinutes', 'checkOutAfterMinutes', 'crossesMidnight', 'isActive', 'unit', 'isOffSunday', 'isOffHoliday']);
        if (sheet) {
          await sheet.addRow({
            ...shift,
            checkInBeforeMinutes: (shift.checkInBeforeMinutes || 60).toString(),
            checkInAfterMinutes: (shift.checkInAfterMinutes || 15).toString(),
            checkOutBeforeMinutes: (shift.checkOutBeforeMinutes || 10).toString(),
            checkOutAfterMinutes: (shift.checkOutAfterMinutes || 120).toString(),
            crossesMidnight: shift.crossesMidnight.toString(),
            isActive: shift.isActive.toString(),
            unit: shift.unit || '',
            isOffSunday: (shift.isOffSunday || false).toString(),
            isOffHoliday: (shift.isOffHoliday || false).toString()
          });
          delete cache['shifts'];
        }
      } catch (error) {
        console.error('Error saving shift to spreadsheet:', error);
      }
    }
    res.json({ success: true, message: 'Shift berhasil ditambahkan' });
  });

  app.delete('/api/shifts/:id', async (req, res) => {
    const { id } = req.params;
    if (doc) {
      try {
        const sheet = await getSheet('Shifts');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToDelete = rows.find(r => r.get('id') === id);
          if (rowToDelete) {
            await rowToDelete.delete();
            delete cache['shifts'];
          }
        }
      } catch (error) {
        console.error('Error deleting shift from spreadsheet:', error);
      }
    }
    res.json({ success: true, message: 'Shift berhasil dihapus' });
  });

  app.put('/api/shifts/:id', async (req, res) => {
    const { id } = req.params;
    const shift = req.body;
    if (doc) {
      try {
        const sheet = await getSheet('Shifts');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToUpdate = rows.find(r => String(r.get('id')) === String(id));
          if (rowToUpdate) {
            rowToUpdate.set('name', shift.name);
            rowToUpdate.set('startTime', shift.startTime);
            rowToUpdate.set('endTime', shift.endTime);
            rowToUpdate.set('fridayEndTime', shift.fridayEndTime || '');
            rowToUpdate.set('saturdayEndTime', shift.saturdayEndTime || '');
            rowToUpdate.set('checkInBeforeMinutes', (shift.checkInBeforeMinutes || 60).toString());
            rowToUpdate.set('checkInAfterMinutes', (shift.checkInAfterMinutes || 15).toString());
            rowToUpdate.set('checkOutBeforeMinutes', (shift.checkOutBeforeMinutes || 10).toString());
            rowToUpdate.set('checkOutAfterMinutes', (shift.checkOutAfterMinutes || 120).toString());
            rowToUpdate.set('crossesMidnight', shift.crossesMidnight.toString());
            rowToUpdate.set('isActive', shift.isActive.toString());
            rowToUpdate.set('unit', shift.unit || '');
            rowToUpdate.set('isOffSunday', (shift.isOffSunday || false).toString());
            rowToUpdate.set('isOffHoliday', (shift.isOffHoliday || false).toString());
            await rowToUpdate.save();
            delete cache['shifts'];
          }
        }
      } catch (error) {
        console.error('Error updating shift in spreadsheet:', error);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui shift di spreadsheet' });
      }
    }
    res.json({ success: true, message: 'Shift berhasil diperbarui' });
  });

  // --- Announcements API ---
  app.get('/api/announcements', async (req, res) => {
    if (doc) {
      try {
        const announcements = await getCachedData('announcements', async () => {
          const sheet = await getOrCreateSheet('Announcements', ['id', 'title', 'content', 'date', 'expiryDate', 'isActive']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
              id: row.get('id'),
              title: row.get('title'),
              content: row.get('content'),
              date: row.get('date'),
              expiryDate: row.get('expiryDate'),
              isActive: String(row.get('isActive')).toLowerCase() === 'true'
            }));
          }
          return [];
        });
        return res.json(announcements);
      } catch (error) {
        console.error('Error fetching announcements from spreadsheet:', error);
      }
    }
    res.json([]);
  });

  app.post('/api/announcements', async (req, res) => {
    const announcement = req.body;
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Announcements', ['id', 'title', 'content', 'date', 'expiryDate', 'isActive']);
        if (sheet) {
          await sheet.addRow({
            ...announcement,
            isActive: announcement.isActive.toString(),
            date: announcement.date || new Date().toISOString().split('T')[0]
          });
          delete cache['announcements'];
        }
      } catch (error) {
        console.error('Error saving announcement to spreadsheet:', error);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan pengumuman' });
      }
    }
    res.json({ success: true, message: 'Pengumuman berhasil ditambahkan' });
  });

  app.put('/api/announcements/:id', async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    if (doc) {
      try {
        const sheet = await getSheet('Announcements');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToUpdate = rows.find(r => r.get('id') === id);
          if (rowToUpdate) {
            rowToUpdate.set('isActive', isActive.toString());
            await rowToUpdate.save();
            delete cache['announcements'];
          }
        }
      } catch (error) {
        console.error('Error updating announcement:', error);
        return res.status(500).json({ success: false, message: 'Gagal update pengumuman' });
      }
    }
    res.json({ success: true, message: 'Pengumuman diupdate' });
  });

  app.delete('/api/announcements/:id', async (req, res) => {
    const { id } = req.params;
    if (doc) {
      try {
        const sheet = await getSheet('Announcements');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToDelete = rows.find(r => r.get('id') === id);
          if (rowToDelete) {
            await rowToDelete.delete();
            delete cache['announcements'];
          }
        }
      } catch (error) {
        console.error('Error deleting announcement:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus pengumuman' });
      }
    }
    res.json({ success: true, message: 'Pengumuman dihapus' });
  });

  // --- Holidays API ---
  app.get('/api/holidays', async (req, res) => {
    if (doc) {
      try {
        const items = await getCachedData('holidays', async () => {
          const sheet = await getOrCreateSheet('Holidays', ['id', 'date', 'name']);
          if (sheet) {
            const rows = await sheet.getRows();
            return rows.map(row => ({
              id: row.get('id'),
              date: row.get('date'),
              name: row.get('name')
            }));
          }
          return [];
        });
        return res.json(items);
      } catch (error) {
        console.error('Error fetching from spreadsheet:', error);
      }
    }
    res.json([]);
  });

  app.post('/api/holidays', async (req, res) => {
    const item = req.body;
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Holidays', ['id', 'date', 'name']);
        if (sheet) {
          await sheet.addRow({
            id: item.id || Date.now().toString(),
            date: item.date,
            name: item.name
          });
          delete cache['holidays'];
          return res.json({ success: true, message: 'Added successfully' });
        }
      } catch (error) {
        console.error('Error adding to spreadsheet:', error);
        return res.status(500).json({ success: false, message: 'Failed to add item' });
      }
    }
    res.json({ success: false, message: 'No connection' });
  });

  app.delete('/api/holidays/:id', async (req, res) => {
    const { id } = req.params;
    if (doc) {
      try {
        const sheet = await getSheet('Holidays');
        if (sheet) {
          const rows = await sheet.getRows();
          const rowToDelete = rows.find(r => r.get('id') === id);
          if (rowToDelete) {
            await rowToDelete.delete();
            delete cache['holidays'];
            return res.json({ success: true });
          } else {
            return res.status(404).json({ success: false });
          }
        }
      } catch (error) {
        return res.status(500).json({ success: false });
      }
    }
    res.json({ success: false });
  });

  // --- Settings API ---
  app.get('/api/settings', async (req, res) => {
    if (doc) {
      try {
        const settingsPayload = await getCachedData('settings', async () => {
          const sheet = await getOrCreateSheet('Settings', ['key', 'value']);
          if (sheet) {
            const rows = await sheet.getRows();
            const settings: any = {};
            rows.forEach(row => {
              try {
                settings[row.get('key')] = JSON.parse(row.get('value'));
              } catch (e) {
                settings[row.get('key')] = row.get('value');
              }
            });
            return settings;
          }
          return {};
        });
        if (Object.keys(settingsPayload).length > 0) {
          return res.json(settingsPayload);
        }
      } catch (error) {
        console.error('Error fetching settings from spreadsheet:', error);
      }
    }
    res.json(db.settings);
  });

  app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    db.settings = { ...db.settings, [key]: value };
    
    if (doc) {
      try {
        const sheet = await getOrCreateSheet('Settings', ['key', 'value']);
        if (sheet) {
          const rows = await sheet.getRows();
          const existingRow = rows.find(r => r.get('key') === key);
          
          // Google Sheets cell limit is 50,000 characters.
          // If value is a large object (like generalSettings with appLogo), we might need to handle it carefully.
          // For now, we stringify it. If it fails, we catch the error.
          const stringifiedValue = JSON.stringify(value);
          
          if (existingRow) {
            existingRow.set('value', stringifiedValue);
            await existingRow.save();
          } else {
            await sheet.addRow({ key, value: stringifiedValue });
          }
          delete cache['settings'];
        }
      } catch (error) {
        console.error('Error saving settings to spreadsheet:', error);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan ke spreadsheet. Mungkin ukuran data terlalu besar (misal: gambar logo).' });
      }
    }
    res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  });

  app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
