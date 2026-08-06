const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const regex = /return rows\.map\(row => \{\s*const loc = row\._rawData\[6\][\s\S]*?shift: row\._rawData\[9\] \|\| row\.get\('shift'\)\s*\};\s*\}\);/m;
const replacement = `return rows.map(row => ({
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
              }));`;

code = code.replace(regex, replacement);
fs.writeFileSync('server.ts', code);
