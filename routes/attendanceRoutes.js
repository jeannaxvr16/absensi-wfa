const express = require('express')
const router = express.Router()
const { Op } = require('sequelize') 

// Import model
const Attendance = require('../models/attendance')
const User = require('../models/user')
const Leave = require('../models/leave')

// ==========================================
// FUNGSI BANTUAN LOGIKA KETERLAMBATAN SHIFT
// ==========================================
function hitungStatusKeterlambatan(waktuAbsen, shiftUser) {
    const dateObj = new Date(waktuAbsen);
    const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    
    const formattedParts = formatter.formatToParts(dateObj);
    let jamWIB = 0;
    let menitWIB = 0;

    formattedParts.forEach(part => {
        if (part.type === 'hour') jamWIB = parseInt(part.value, 10);
        if (part.type === 'minute') menitWIB = parseInt(part.value, 10);
    });

    if (jamWIB === 24) jamWIB = 0;

    const totalMenitAbsen = (jamWIB * 60) + menitWIB;
    const shift = (shiftUser || 'pagi').toLowerCase();

    // 1. SHIFT PAGI (08:00 - 13:00)
    if (shift === 'pagi') {
        const jamMulai = 8 * 60;   // 08:00
        const jamSelesai = 13 * 60; // 13:00
        if (totalMenitAbsen >= jamMulai && totalMenitAbsen <= jamSelesai) {
            return 'Tepat Waktu';
        }
        return 'Terlambat';
    } 
    
    // 2. SHIFT SIANG (13:00 - 21:00)
    else if (shift === 'siang') {
        const jamMulai = 13 * 60;  // 13:00
        const jamSelesai = 21 * 60; // 21:00
        if (totalMenitAbsen >= jamMulai && totalMenitAbsen <= jamSelesai) {
            return 'Tepat Waktu';
        }
        return 'Terlambat';
    } 
    
    // 3. SHIFT SORE / MALAM (21:00 - 05:00)
    else if (shift === 'sore' || shift === 'malam') {
        const jamMulai = 21 * 60; // 21:00
        const jamSelesai = 5 * 60; // 05:00
        if (totalMenitAbsen >= jamMulai || totalMenitAbsen <= jamSelesai) {
            return 'Tepat Waktu';
        }
        return 'Terlambat';
    }

    return 'Tepat Waktu';
}

// ==========================================
// 1. JALUR PROSES ABSENSI QR (POST & GET)
// ==========================================
router.post('/attendance', async (req, res) => {
    try {
        const user = await User.findOne({
            where: { qr_token: req.body.qr_token }
        })

        if (!user) {
            return res.status(400).json({ message: 'QR Code tidak valid' })
        }

        const lastAttendance = await Attendance.findOne({
            where: { user_id: user.id },
            order: [['waktu', 'DESC']]
        })

        if (lastAttendance) {
            const lastDate = new Date(lastAttendance.waktu)
            if (lastDate.toDateString() === new Date().toDateString()) {
                return res.status(400).json({ message: 'Anda sudah melakukan presensi hari ini!' })
            }
        }

        // Kalkulasi Jam WIB
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        });
        
        const parts = formatter.formatToParts(now);
        let jamWIB = 0, menitWIB = 0;
        parts.forEach(p => {
            if (p.type === 'hour') jamWIB = parseInt(p.value, 10);
            if (p.type === 'minute') menitWIB = parseInt(p.value, 10);
        });
        if (jamWIB === 24) jamWIB = 0;

        const totalMenit = (jamWIB * 60) + menitWIB;
        const shift = (user.shift || 'pagi').toLowerCase();

        let batasMulai = 0;
        let batasSelesai = 0;
        let namaShift = "";

        if (shift === 'pagi') {
            batasMulai = 8 * 60;    // 08:00
            batasSelesai = 13 * 60; // 13:00
            namaShift = "Pagi (08:00 - 13:00 WIB)";
        } else if (shift === 'siang') {
            batasMulai = 13 * 60;   // 13:00
            batasSelesai = 21 * 60; // 21:00
            namaShift = "Siang (13:00 - 21:00 WIB)";
        } else if (shift === 'sore' || shift === 'malam') {
            batasMulai = 21 * 60;   // 21:00
            batasSelesai = 5 * 60;  // 05:00
            namaShift = "Malam (21:00 - 05:00 WIB)";
        }

        // --- VALIDASI RENTANG WAKTU SHIFT KETAT ---
        if (shift === 'pagi' || shift === 'siang') {
            if (totalMenit < batasMulai) {
                return res.status(400).json({ 
                    message: `Presensi gagal! Belum waktunya absen. Shift Anda: ${namaShift}` 
                });
            }
            if (totalMenit > batasSelesai) {
                return res.status(400).json({ 
                    message: `Presensi gagal! Waktu shift Anda telah berakhir (${namaShift}).` 
                });
            }
        } else {
            // Kasus Shift Malam (Lintas Hari 21:00 - 05:00)
            const diLuarRentangMalam = (totalMenit > batasSelesai) && (totalMenit < batasMulai);
            if (diLuarRentangMalam) {
                return res.status(400).json({ 
                    message: `Presensi gagal! Di luar jam operasional Shift Anda (${namaShift}).` 
                });
            }
        }

        // Simpan Presensi Berhasil
        const statusTeks = 'Tepat Waktu';

        await Attendance.create({
            user_id: user.id,
            qr_token: req.body.qr_token,
            latitude: req.body.latitude,
            longitude: req.body.longitude,
            statusTelat: statusTeks,
            waktu: now
        })

        res.json({ message: 'Absensi berhasil! Status: Tepat Waktu', status: statusTeks })

    } catch (error) {
        console.error('Error proses absensi:', error)
        res.status(500).json({ message: 'Terjadi kesalahan server' })
    }
})

// Dashboard Karyawan berdasarkan ID
router.get('/dashboard/:id', async (req, res) => {
    try {
        const userId = req.params.id; 

        const currentUser = await User.findByPk(userId);
        if (!currentUser) {
            return res.status(404).send('Karyawan tidak ditemukan');
        }

        const attendances = await Attendance.findAll({
            where: { user_id: userId }, 
            order: [['waktu', 'DESC']]
        });

        const leaves = await Leave.findAll({
            where: { user_id: userId }, 
            order: [['createdAt', 'DESC']]
        });

        const renderData = { 
            currentUser: currentUser.toJSON ? currentUser.toJSON() : currentUser,
            user: req.session && req.session.user ? req.session.user : currentUser,
            attendances, 
            leaves 
        };

        res.render('dashboard', renderData, (err, html) => {
            if (err) {
                return res.render('karyawan/dashboard', renderData);
            }
            res.send(html);
        });

    } catch (error) {
        console.error("Error Dashboard Karyawan:", error);
        res.status(500).send('Gagal memuat dashboard karyawan');
    }
});

router.get('/scan', async (req, res) => {
    try {
        res.render('scan')
    } catch (error) {
        console.error('Error scan:', error)
        res.status(500).send('Gagal memuat halaman scan')
    }
})

// ==========================================
// 2. JALUR FORM PENGAJUAN IZIN KARYAWAN
// ==========================================
router.get('/leave/new', (req, res) => {
    const loggedInUser = (req.session && req.session.user) ? req.session.user : {
        id: 1,
        nama: "Karyawan",
        shift: "Pagi"
    };

    res.render('leave_form', { currentUser: loggedInUser });
});

router.post('/leave/store', async (req, res) => {
    try {
        await Leave.create({
            user_id: req.body.user_id, 
            jenis: req.body.jenis,     
            tanggal_mulai: req.body.tanggal_mulai,
            tanggal_selesai: req.body.tanggal_selesai,
            alasan: req.body.alasan,
            status: 'Pending'          
        })
        res.redirect('/dashboard/' + req.body.user_id); 
    } catch (error) {
        console.error('Error pengajuan izin:', error);
        res.status(500).send('Gagal memproses pengajuan izin');
    }
})

// ==========================================
// 3. JALUR KELOLA IZIN SISI ADMIN
// ==========================================
router.get('/admin/leaves', async (req, res) => {
    try {
        const leaves = await Leave.findAll({
            include: [{ model: User }],
            order: [['createdAt', 'DESC']]
        });
        
        res.render('admin/leaves', (err, html) => {
            if (err) return res.render('admin-leaves', { leaves });
            res.send(html);
        });
    } catch (error) {
        console.error('Error admin leaves:', error);
        res.status(500).send('Gagal memuat data pengajuan izin');
    }
})

router.post('/admin/leaves/:id/action', async (req, res) => {
    try {
        const { statusAction } = req.body; 
        await Leave.update(
            { status: statusAction },
            { where: { id: req.params.id } }
        );
        res.redirect('/admin/leaves'); 
    } catch (error) {
        console.error('Error aksi izin:', error);
        res.status(500).send('Gagal memperbarui status pengajuan');
    }
})

router.post('/admin/leaves/delete/:id', async (req, res) => {
    try {
        await Leave.destroy({
            where: { id: req.params.id }
        });
        res.redirect('/admin/leaves');
    } catch (error) {
        console.error('Error hapus izin:', error);
        res.status(500).send('Gagal menghapus data pengajuan');
    }
});

// ==========================================
// 4. JALUR QR DINAMIS SISI ADMIN (LIVE REKAP)
// ==========================================
router.get('/admin/qr-dinamis', async (req, res) => {
    try {
        const awalHariIni = new Date();
        awalHariIni.setHours(0, 0, 0, 0);

        const attendances = await Attendance.findAll({
            where: {
                waktu: {
                    [Op.gte]: awalHariIni 
                }
            },
            include: [{ model: User }],
            order: [['waktu', 'DESC']]
        });

        const qrData = "WFA_ATTENDANCE_SECRET_TOKEN_GENERATED"; 

        res.render('admin/qr-dinamis', (err, html) => {
            if (err) return res.render('admin-qr', { attendances, qrData });
            res.send(html);
        });

    } catch (error) {
        console.error("Error QR Dinamis:", error);
        res.status(500).send("Gagal memuat halaman QR Dinamis Admin");
    }
});

// ==========================================
// 5. JALUR DASHBOARD UTAMA ADMIN 
// ==========================================
router.get('/admin', async (req, res) => {
    try {
        const attendancesRaw = await Attendance.findAll({
            include: [{ model: User }], 
            order: [['waktu', 'DESC']]
        }).catch(() => []);

        const users = await User.findAll().catch(() => []);
        
        const pendingLeaves = await Leave.findAll({
            where: { status: 'Pending' }
        }).catch(() => []);

        let jumlahTerlambatHariIni = 0;
        const hariIniTeks = new Date().toDateString();

        const totalShiftPagi = users.filter(u => u.shift && u.shift.toLowerCase() === 'pagi').length;
        const totalShiftSiang = users.filter(u => u.shift && u.shift.toLowerCase() === 'siang').length;
        const totalShiftSore = users.filter(u => u.shift && (u.shift.toLowerCase() === 'sore' || u.shift.toLowerCase() === 'malam')).length;

        const attendances = attendancesRaw.map(att => {
            const data = att.toJSON ? att.toJSON() : att;
            const matchUser = data.User || users.find(u => u.id === data.user_id);
            const shiftKaryawan = matchUser && matchUser.shift ? matchUser.shift : 'pagi';
            
            const statusTeks = hitungStatusKeterlambatan(data.waktu, shiftKaryawan);
            
            if (statusTeks === 'Terlambat' && new Date(data.waktu).toDateString() === hariIniTeks) {
                jumlahTerlambatHariIni++;
            }

            return {
                ...data,
                statusTelat: statusTeks,
                User: matchUser ? (matchUser.toJSON ? matchUser.toJSON() : matchUser) : { nama: 'Karyawan' }
            }
        });

        const stats = {
            totalKaryawan: users.length,
            hadir: attendances.filter(a => new Date(a.waktu).toDateString() === hariIniTeks).length, 
            terlambat: jumlahTerlambatHariIni,
            izinSakitCuti: pendingLeaves.length, 
            shiftPagi: totalShiftPagi,
            shiftSiang: totalShiftSiang,
            shiftSore: totalShiftSore,
            shiftMalam: totalShiftSore
        };

        const renderPayload = { 
            attendances, 
            stats,
            user: (req.session && req.session.user) ? req.session.user : { nama: "Admin" }
        };

        res.render('admin/dashboard', renderPayload, (err, html) => {
            if (err) return res.render('admin/admin', renderPayload);
            res.send(html);
        });
        
    } catch (error) {
        console.error("Error Dashboard Admin:", error);
        res.status(500).send('Gagal memuat dashboard admin');
    }
});

module.exports = router;