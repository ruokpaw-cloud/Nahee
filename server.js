const express = require('express');
const crypto = require('crypto');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// ฐานข้อมูลในหน่วยความจำ
const keysDB = {};

// ฟังก์ชันสร้างคีย์สุ่ม 67 ตัวอักษร
function generate67CharKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const bytes = crypto.randomBytes(67);
    for (let i = 0; i < 67; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

// 1. API หน้าแรกสุดป้องกัน Render หา Route ไม่เจอ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. API สร้างคีย์ (Admin)
app.post('/api/admin/create-key', (req, res) => {
    const { days } = req.body;
    const key = generate67CharKey();

    keysDB[key] = {
        keyCode: key,
        typeDays: days,
        lockedIp: null,
        activatedAt: null,
        expiresAt: null,
        isActive: true
    };

    res.json({ status: 'success', key, typeDays: days });
});

// 3. API ตรวจสอบคีย์ (User)
app.post('/api/verify-key', (req, res) => {
    const { key } = req.body;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    const keyData = keysDB[key];

    if (!keyData) return res.status(404).json({ status: 'error', message: 'ไม่พบรหัสคีย์นี้ในระบบ' });
    if (!keyData.isActive) return res.status(403).json({ status: 'error', message: 'คีย์นี้ถูกระงับการใช้งาน' });

    const now = new Date();

    if (!keyData.lockedIp) {
        keyData.lockedIp = clientIp;
        keyData.activatedAt = now;

        if (keyData.typeDays === 'lifetime') {
            keyData.expiresAt = 'LIFETIME';
        } else {
            const exp = new Date(now);
            exp.setDate(exp.getDate() + parseInt(keyData.typeDays));
            keyData.expiresAt = exp;
        }
    } else if (keyData.lockedIp !== clientIp) {
        return res.status(403).json({ status: 'error', message: `คีย์นี้ผูกไว้กับ IP: ${keyData.lockedIp}` });
    }

    if (keyData.expiresAt !== 'LIFETIME' && now > new Date(keyData.expiresAt)) {
        return res.status(403).json({ status: 'error', message: 'คีย์นี้หมดอายุการใช้งานแล้ว' });
    }

    let remainingText = 'ถาวร (Lifetime)';
    if (keyData.expiresAt !== 'LIFETIME') {
        const diffMs = new Date(keyData.expiresAt) - now;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        remainingText = `เหลือเวลาอีก ${diffDays} วัน ${diffHours % 24} ชั่วโมง`;
    }

    return res.json({
        status: 'success',
        message: 'ยืนยันคีย์สำเร็จ!',
        typeDays: keyData.typeDays === 'lifetime' ? 'ถาวร' : `${keyData.typeDays} วัน`,
        lockedIp: keyData.lockedIp,
        expiresAt: keyData.expiresAt,
        remainingText
    });
});

// 4. API ดึงตารางคีย์ทั้งหมด
app.get('/api/admin/keys', (req, res) => {
    res.json(Object.values(keysDB));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// ระบบ Self-Ping ยิงปลุกตัวเองทุกๆ 10 นาที (ป้องกัน Render หลับ)
setInterval(() => {
    const host = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (host) {
        https.get(`https://${host}/api/admin/keys`, (res) => {
            console.log('[Self-Ping] Server alive, status:', res.statusCode);
        }).on('error', (err) => {
            console.error('[Self-Ping] Error:', err.message);
        });
    }
}, 10 * 60 * 1000);
