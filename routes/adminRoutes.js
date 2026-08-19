const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // Dipakai untuk hash password user
const { Op } = require('sequelize');

// Import model
const User = require('../models/user'); 
const Attendance = require('../models/attendance'); 
const Leave = require('../models/leave'); 

const isAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    return res.redirect('/login');
};

router.use(isAdmin);

// Fungsi bantu mengecek apakah suatu tanggal berada di hari ini (Sesuai Zona Waktu Asia/Jakarta)
const isToday = (dateString) => {
    if (!dateString) return false;
    const d = new Date(dateString);
    const today = new Date();

    const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric' };
    const dateStr = d.toLocaleDateString('id-ID', options);
    const todayStr = today.toLocaleDateString('id-ID', options);

    return dateStr === todayStr;
};

// 1. DASHBOARD ADMIN
router.get('/', async (req, res) => {
    try {
        const totalKaryawan = await User.count({ where: { role: 'karyawan' } });
        
        // Ambil semua data absensi, lalu filter khusus hari ini untuk ringkasan Dashboard
        const allAttendances = await Attendance.findAll({
            include: [{ model: User }],
            order: [['waktu', 'DESC']]
        });

        const attendancesToday = allAttendances.filter(item => isToday(item.waktu));

        const hadir = attendancesToday.length;
        const terlambat = attendancesToday.filter(a => {
            const status = a.statusTelat || a.status || '';
            return status.toString().toLowerCase().includes('terlambat') || status.toString().toLowerCase().includes('late');
        }).length;
        
        const izinSakitCuti = await Leave.count({ where: { status: 'Pending' } });

        // Hitung shift (termasuk 'Malam' dan legacy 'Sore')
        const shiftPagi = await User.count({ where: { shift: 'Pagi', role: 'karyawan' } });
        const shiftSiang = await User.count({ where: { shift: 'Siang', role: 'karyawan' } });
        const shiftMalam = await User.count({ 
            where: { 
                shift: { [Op.in]: ['Malam', 'Sore'] },
                role: 'karyawan' 
            } 
        });

        const stats = {
            totalKaryawan,
            hadir,
            terlambat,
            izinSakitCuti,
            shiftPagi,
            shiftSiang,
            shiftMalam,
            shiftSore: shiftMalam // Backup kompatibilitas key nama lama
        };

        res.render('admin/dashboard', {
            user: req.session.user,
            stats,
            attendances: attendancesToday
        });
    } catch (error) {
        console.error('Error Admin Dashboard:', error);
        res.status(500).send('Terjadi kesalahan pada server');
    }
});

// 1.1 API SEARCH KARYAWAN UNTUK NAVBAR
router.get('/users/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        if (!query.trim()) {
            return res.json([]);
        }

        const users = await User.findAll({
            where: {
                role: 'karyawan',
                [Op.or]: [
                    { nama: { [Op.like]: `%${query}%` } },
                    { email: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 5
        });

        res.json(users);
    } catch (error) {
        console.error('Error Search User API:', error);
        res.status(500).json({ error: 'Gagal mencari data karyawan' });
    }
});

// 1.2 EDIT PROFIL ADMIN DARI MODAL NAVBAR
router.post('/profile/update', async (req, res) => {
    try {
        const adminId = req.session.user.id;
        const { nama, email, password } = req.body;

        const updateData = { nama, email };

        // Update password jika diisi oleh admin
        if (password && password.trim() !== '') {
            updateData.password = await bcrypt.hash(password, 10);
        }

        await User.update(updateData, { where: { id: adminId } });

        // Update data session login secara live
        req.session.user.nama = nama;
        req.session.user.email = email;

        res.redirect('/admin');
    } catch (error) {
        console.error('Error Update Profil Admin:', error);
        res.status(500).send('Gagal memperbarui profil admin');
    }
});

// 2. MASTER DATA (GET)
router.get('/master-data', async (req, res) => {
    try {
        const users = await User.findAll({
            order: [['nama', 'ASC']]
        });

        res.render('admin/master-data', {
            user: req.session.user,
            users
        });
    } catch (error) {
        console.error('Error Master Data:', error);
        res.status(500).send('Gagal memuat Master Data');
    }
});

// 2.1 TAMBAH KARYAWAN BARU (POST)
router.post('/users/add', async (req, res) => {
    try {
        const { nama, email, password, role, shift } = req.body;

        // Cek apakah email sudah terdaftar
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).send('Email sudah digunakan oleh pengguna lain.');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Simpan user baru ke database
        await User.create({
            nama,
            email,
            password: hashedPassword,
            role: role || 'karyawan',
            shift: shift || 'Pagi'
        });

        res.redirect('/admin/master-data');
    } catch (error) {
        console.error('Error Tambah User:', error);
        res.status(500).send('Gagal menambahkan karyawan baru');
    }
});

// 2.2 EDIT DATA KARYAWAN (POST)
router.post('/users/edit/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const { nama, email, password, role, shift } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).send('Karyawan tidak ditemukan');
        }

        const updateData = {
            nama,
            email,
            role: role || user.role,
            shift: shift || user.shift
        };

        // Update password hanya jika diisi oleh admin
        if (password && password.trim() !== '') {
            updateData.password = await bcrypt.hash(password, 10);
        }

        await User.update(updateData, { where: { id: userId } });

        res.redirect('/admin/master-data');
    } catch (error) {
        console.error('Error Edit User:', error);
        res.status(500).send('Gagal memperbarui data karyawan');
    }
});

// 2.3 HAPUS DATA KARYAWAN (POST)
router.post('/users/delete/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // Mencegah admin menghapus akunnya sendiri
        if (req.session.user && req.session.user.id == userId) {
            return res.status(400).send('Anda tidak bisa menghapus akun Anda sendiri.');
        }

        // Hapus data riwayat absensi dan izin terlebih dahulu (Foreign Key Constraint)
        await Attendance.destroy({ where: { user_id: userId } });
        await Leave.destroy({ where: { user_id: userId } });

        // Hapus data user dari database
        await User.destroy({ where: { id: userId } });

        res.redirect('/admin/master-data');
    } catch (error) {
        console.error('Error Hapus User:', error);
        res.status(500).send('Gagal menghapus data karyawan');
    }
});

// 3. LAPORAN (REPORTS) DENGAN FITUR FILTER TANGGAL
router.get('/reports', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let whereCondition = {};

        // Jika admin memasukkan filter tanggal
        if (startDate && endDate) {
            whereCondition.waktu = {
                [Op.between]: [
                    new Date(`${startDate}T00:00:00.000+07:00`), 
                    new Date(`${endDate}T23:59:59.999+07:00`)
                ]
            };
        }

        const attendances = await Attendance.findAll({
            where: whereCondition,
            include: [{ model: User }],
            order: [['waktu', 'DESC']]
        });

        res.render('admin/reports', {
            user: req.session.user,
            attendances,
            startDate: startDate || '',
            endDate: endDate || ''
        });
    } catch (error) {
        console.error('Error Laporan:', error);
        res.status(500).send('Gagal memuat Laporan');
    }
});

// 4. QR DINAMIS
router.get('/qr-dinamis', (req, res) => {
    res.render('admin/qr-dinamis', {
        user: req.session.user
    });
});

// 5. IZIN / CUTI / SAKIT (LEAVES)
router.get('/leaves', async (req, res) => {
    try {
        const leaves = await Leave.findAll({
            include: [{ model: User }],
            order: [['createdAt', 'DESC']]
        });

        res.render('admin/admin-leaves', {
            user: req.session.user,
            leaves
        });
    } catch (error) {
        console.error('Error Leaves:', error);
        res.status(500).send('Gagal memuat data izin/cuti');
    }
});

// 5.1 PROSES AKSI SETUJU / TOLAK IZIN (POST)
router.post('/leaves/:id/action', async (req, res) => {
    try {
        const { id } = req.params;
        const { statusAction } = req.body; // Mengambil nilai 'Disetujui' / 'Ditolak'

        await Leave.update(
            { status: statusAction },
            { where: { id: id } }
        );

        res.redirect('/admin/leaves');
    } catch (error) {
        console.error('Error Action Leave:', error);
        res.status(500).send('Gagal memproses aksi pengajuan izin');
    }
});

module.exports = router;