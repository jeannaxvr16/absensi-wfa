const express = require('express')
const router = express.Router()
const { Op } = require('sequelize') 

// PERBAIKAN: Mengubah nama file import model menjadi huruf kecil sesuai case-sensitive Linux
const Attendance = require('../models/attendance')
const User = require('../models/user')
const Leave = require('../models/leave')

// ==========================================
// 1. JALUR PROSES ABSENSI QR (POST & GET)
// ==========================================
router.post('/attendance', async (req, res) => {
    try {
        const user = await User.findOne({
            where: { qr_token: req.body.qr_token }
        })

        if (!user) {
            return res.status(400).json({ message: 'QR tidak valid' })
        }

        const lastAttendance = await Attendance.findOne({
            where: { user_id: user.id },
            order: [['waktu', 'DESC']]
        })

        if (lastAttendance) {
            const lastDate = new Date(lastAttendance.waktu)
            if (lastDate.toDateString() === new Date().toDateString()) {
                return res.json({ message: 'Anda sudah absen hari ini' })
            }
        }

        // --- KALKULASI KETERLAMBATAN ZONA WAKTU WIB (UTC + 7) ---
        const now = new Date();
        // Konversi jam ke WIB
        const jamWIB = (now.getUTCHours() + 7) % 24;
        const menitWIB = now.getUTCMinutes();
        
        const shiftKaryawan = user.shift ? user.shift.toLowerCase() : 'pagi';
        let statusTeks = 'Tepat Waktu';

        // Batas Atas Toleransi Jam Masuk:
        // Shift Pagi  : Maksimal 09:00 WIB
        // Shift Siang : Maksimal 14:00 WIB
        // Shift Malam / Sore : Maksimal 22:00 WIB
        if (shiftKaryawan === 'pagi') {
            if (jamWIB > 9 || (jamWIB === 9 && menitWIB > 0)) statusTeks = 'Terlambat';
        } else if (shiftKaryawan === 'siang') {
            if (jamWIB > 14 || (jamWIB === 14 && menitWIB > 0)) statusTeks = 'Terlambat';
        } else if (shiftKaryawan === 'sore' || shiftKaryawan === 'malam') {
            if (jamWIB > 22 || (jamWIB === 22 && menitWIB > 0)) statusTeks = 'Terlambat';
        }

        await Attendance.create({
            user_id: user.id,
            qr_token: req.body.qr_token,
            latitude: req.body.latitude,
            longitude: req.body.longitude,
            statusTelat: statusTeks, // Menyimpan status keterlambatan langsung ke database
            waktu: now
        })

        res.json({ message: 'Absensi berhasil', status: statusTeks })

    } catch (error) {
        console.log(error)
        res.status(500).json({ message: 'Terjadi kesalahan server' })
    }
})

// Dashboard Karyawan berdasarkan ID
router.get('/dashboard/:id', async (req, res) => {
    try {
        const userId = req.params.id; 

        const attendances = await Attendance.findAll({
            where: { user_id: userId }, 
            order: [['waktu', 'DESC']]
        });

        const leaves = await Leave.findAll({
            where: { user_id: userId }, 
            order: [['createdAt', 'DESC']]
        });

        res.render('dashboard', { attendances, leaves });
    } catch (error) {
        console.error(error);
        res.status(500).send('Gagal memuat dashboard karyawan');
    }
});

router.get('/scan', async (req, res) => {
    try {
        res.render('scan')
    } catch (error) {
        console.log(error)
        res.status(500).send('Gagal memuat halaman scan')
    }
})

// ==========================================
// 2. JALUR FORM PENGAJUAN IZIN KARYAWAN
// ==========================================
router.get('/leave/new', (req, res) => {
    const loggedInUser = (req.session && req.session.user) ? req.session.user : {
        id: 1,
        nama: "Aulia Adrinna Azzahra",
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
        console.log(error);
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
        res.render('admin-leaves', { leaves });
    } catch (error) {
        console.log(error);
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
        console.log(error);
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
        console.error(error);
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
            include: [{
                model: User 
            }],
            order: [['waktu', 'DESC']]
        });

        const qrData = "WFA_ATTENDANCE_SECRET_TOKEN_GENERATED"; 

        res.render('admin-qr', { 
            attendances: attendances, 
            qrData: qrData 
        });

    } catch (error) {
        console.error("Error pada QR Dinamis:", error);
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
        })

        const users = await User.findAll().catch(() => []);
        
        const pendingLeaves = await Leave.findAll({
            where: { status: 'Pending' }
        }).catch(() => []);

        let jumlahTerlambatHariIni = 0;
        const hariIniTeks = new Date().toDateString();

        const totalShiftPagi = users.filter(u => u.shift && u.shift.toLowerCase() === 'pagi').length;
        const totalShiftSiang = users.filter(u => u.shift && u.shift.toLowerCase() === 'siang').length;
        const totalShiftSore = users.filter(u => u.shift && u.shift.toLowerCase() === 'sore').length;

        const attendances = attendancesRaw.map(att => {
            const data = att.toJSON ? att.toJSON() : att;
            const matchUser = data.User || users.find(u => u.id === data.user_id);
            const shiftKaryawan = matchUser && matchUser.shift ? matchUser.shift.toLowerCase() : 'pagi';
            
            const waktuAbsen = new Date(data.waktu);
            // Konversi ke jam WIB
            const jamWIB = (waktuAbsen.getUTCHours() + 7) % 24;
            const menitWIB = waktuAbsen.getUTCMinutes();
            
            let statusTeks = data.statusTelat || 'Tepat Waktu';

            // Jika status belum tersimpan di DB, lakukan evaluasi ulang berdasar jam WIB
            if (!data.statusTelat) {
                if (shiftKaryawan === 'pagi') {
                    if (jamWIB > 9 || (jamWIB === 9 && menitWIB > 0)) statusTeks = 'Terlambat';
                } else if (shiftKaryawan === 'siang') {
                    if (jamWIB > 14 || (jamWIB === 14 && menitWIB > 0)) statusTeks = 'Terlambat';
                } else if (shiftKaryawan === 'sore' || shiftKaryawan === 'malam') {
                    if (jamWIB > 22 || (jamWIB === 22 && menitWIB > 0)) statusTeks = 'Terlambat';
                }
            }
            
            if (statusTeks === 'Terlambat' && waktuAbsen.toDateString() === hariIniTeks) {
                jumlahTerlambatHariIni++;
            }

            return {
                ...data,
                statusTelat: statusTeks,
                User: matchUser ? (matchUser.toJSON ? matchUser.toJSON() : matchUser) : { nama: 'Karyawan' }
            }
        })

        const stats = {
            totalKaryawan: users.length,
            hadir: attendances.filter(a => new Date(a.waktu).toDateString() === hariIniTeks).length, 
            terlambat: jumlahTerlambatHariIni,
            izinSakitCuti: pendingLeaves.length, 
            shiftPagi: totalShiftPagi,
            shiftSiang: totalShiftSiang,
            shiftSore: totalShiftSore
        }

        res.render('admin/admin', { 
            attendances, 
            stats,
            user: (req.session && req.session.user) ? req.session.user : { nama: "Admin" }
        })
        
    } catch (error) {
        console.log(error)
        res.status(500).send('Gagal memuat dashboard admin')
    }
})

module.exports = router;