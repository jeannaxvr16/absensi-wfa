const express = require('express')
const router = express.Router()

const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const QRCode = require('qrcode')

// PERBAIKAN: Mengubah nama file import model menjadi huruf kecil sesuai sistem Linux
const User = require('../models/user')
const Attendance = require('../models/attendance')
const Leave = require('../models/leave')

// ==========================================
// 1. ROUTE REGISTER (PENDAFTARAN AKUN)
// ==========================================

// Tampilan Halaman Register
router.get('/register', (req, res) => {
    res.render('register')
})

// Proses Registrasi & Pembuatan QR Code Otomatis
router.post('/register', async (req, res) => {
    try {
        const hashPassword = await bcrypt.hash(req.body.password, 10)
        
        let qrToken = null 
        let finalShift = null

        // Pembuatan QR Code & Penentuan Shift HANYA untuk Karyawan
        if (req.body.role === 'karyawan') {
            qrToken = uuidv4()
            
            // Menyimpan gambar QR Code ke folder public secara real-time
            const qrPath = `public/qrcodes/${qrToken}.png`
            await QRCode.toFile(qrPath, qrToken)

            // GABUNGAN OPSI A & B (MANUAL SELECTION + AUTOMATIC FALLBACK):
            if (req.body.shift && req.body.shift.trim() !== '') {
                // OPSI A: Jika karyawan memilih shift dari dropdown
                finalShift = req.body.shift;
            } else {
                // OPSI B: Jika form shift kosong, server memilihkan secara acak
                const daftarShift = ['Pagi', 'Siang', 'Malam'];
                const randomIdx = Math.floor(Math.random() * daftarShift.length);
                finalShift = daftarShift[randomIdx];
            }
        }

        // Masukkan data ke database MySQL via Sequelize
        const newUser = await User.create({
            nama: req.body.nama,
            email: req.body.email,
            password: hashPassword,
            role: req.body.role,    // Menyimpan role ('admin'/'karyawan')
            shift: finalShift,      // Berisi pilihan karyawan atau otomatis acak dari server
            qr_token: qrToken       // Bernilai null otomatis di database jika dia Admin
        })

        // TAMPILAN HALAMAN SUKSES DINAMIS (Karyawan vs Admin)
        res.send(`
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
                <style>
                    body { 
                        font-family: 'Inter', sans-serif; 
                        background: #f4f6f9;
                        background-image: radial-gradient(at 0% 0%, rgba(13, 110, 253, 0.08) 0px, transparent 50%);
                        height: 100vh; display: flex; align-items: center; justify-content: center;
                    }
                    .qr-card { max-width: 400px; width: 100%; border: none; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); }
                </style>
            </head>
            <body>
                <div class="card qr-card p-4 text-center bg-white">
                    <div class="text-success fs-1 mb-2"><i class="bi bi-check-circle-fill"></i></div>
                    <h4 class="fw-bold text-dark mb-1">Registrasi Berhasil!</h4>
                    <p class="text-muted small mb-3">Akun ${newUser.role} Anda telah terdaftar dalam sistem.</p>
                    
                    ${newUser.role === 'karyawan' ? `
                        <div class="mb-3">
                            <span class="badge bg-info text-dark px-3 py-2 fs-6">
                                Shift Kerja: <strong>${newUser.shift}</strong>
                            </span>
                        </div>
                        <div class="p-3 bg-light rounded-4 d-inline-block mb-3">
                            <img src="/qrcodes/${qrToken}.png" alt="QR Code Karyawan" class="img-fluid" style="width: 200px; height: 200px; border-radius: 10px;">
                        </div>
                        <h5 class="fw-bold text-secondary mb-3">${newUser.nama}</h5>
                        <a href="/qrcodes/${qrToken}.png" download="QR_Absen_${newUser.nama}.png" class="btn btn-primary w-100 fw-semibold py-2 mb-2">
                            <i class="bi bi-download me-1"></i> Unduh QR Code Saya
                        </a>
                    ` : `
                        <div class="p-4 my-3 bg-light rounded-4 text-secondary">
                            <i class="bi bi-shield-lock-fill fs-1 text-primary"></i>
                            <p class="mt-2 small fw-semibold mb-0">Hak Akses Admin Aktif<br>(Tidak membutuhkan QR Code Absensi)</p>
                        </div>
                        <h5 class="fw-bold text-secondary mb-4">${newUser.nama}</h5>
                    `}
                    
                    <a href="/login" class="btn btn-outline-secondary w-100 btn-sm mt-2">Pergi ke Halaman Login</a>
                </div>
            </body>
            </html>
        `)

    } catch (error) {
        console.log(error)
        res.status(500).send('Terjadi kesalahan saat melakukan registrasi.')
    }
})

// ==========================================
// 2. ROUTE LOGIN (MASUK APLIKASI)
// ==========================================

// Tampilan Halaman Login
router.get('/login', (req, res) => {
    res.render('login', { error: null })
})

// Proses Validasi Authentikasi Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body

        const user = await User.findOne({ where: { email } })
        if (!user) {
            return res.render('login', { error: 'Email atau password salah!' })
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if (!isMatch) {
            return res.render('login', { error: 'Email atau password salah!' })
        }

        // Menyimpan data user ke Session setelah berhasil login
        req.session.user = {
            id: user.id,
            nama: user.nama,
            email: user.email,
            role: user.role,
            shift: user.shift
        };

        // PEMISAH AKSES BEDASARKAN DATA ROLE DI DATABASE
        if (user.role === 'admin' || user.email.includes('admin')) {
            return res.redirect('/admin') 
        }

        // Redirect aman tanpa id di URL
        res.redirect('/dashboard')

    } catch (error) {
        console.log(error)
        res.status(500).send('Terjadi kesalahan server saat mencoba login.')
    }
})

// ==========================================
// 3. ROUTE DASHBOARD KARYAWAN & SCAN
// ==========================================

router.get('/dashboard', async (req, res) => {
    try {
        // PENGAMAN: Jika user belum login/session kosong, tendang langsung ke halaman login
        if (!req.session || !req.session.user) {
            return res.redirect('/login');
        }

        const sessionUser = req.session.user;

        const user = await User.findByPk(sessionUser.id)
        if (!user) {
            return res.status(404).send('User tidak ditemukan')
        }

        // Ambil data riwayat absensi
        const attendances = await Attendance.findAll({
            where: { user_id: user.id },
            order: [['waktu', 'DESC']]
        })

        // Ambil data riwayat cuti dari database berdasarkan id user
        const leaves = await Leave.findAll({
            where: { user_id: user.id },
            order: [['createdAt', 'DESC']]
        })

        // Kirim objek ke dashboard.ejs
        res.render('dashboard', { user, attendances, leaves })

    } catch (error) {
        console.log(error)
        res.status(500).send('Gagal memuat halaman dashboard karyawan.')
    }
})

router.get('/scan', (req, res) => {
    // PENGAMAN: Pastikan user login baru bisa buka kamera scan
    if (!req.session || !req.session.user) {
        return res.redirect('/login');
    }
    res.render('scan')
})

// ==========================================
// 4. ROUTE LOGOUT (KELUAR APLIKASI)
// ==========================================
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log(err);
        }
        res.redirect('/login')
    });
})

// ==========================================
// 5. ROUTE LUPA PASSWORD (RESET PASSWORD)
// ==========================================

router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: null, type: null })
})

router.post('/forgot-password', async (req, res) => {
    try {
        const { email, newPassword } = req.body

        const user = await User.findOne({ where: { email } })
        if (!user) {
            return res.render('forgot-password', { message: 'Email tidak terdaftar!', type: 'danger' })
        }

        const hashPassword = await bcrypt.hash(newPassword, 10)
        await User.update({ password: hashPassword }, { where: { email } })

        res.render('forgot-password', { message: 'Password berhasil diperbarui! Silakan login.', type: 'success' })

    } catch (error) {
        console.log(error)
        res.status(500).send('Terjadi kesalahan server saat memperbarui password.')
    }
})

module.exports = router