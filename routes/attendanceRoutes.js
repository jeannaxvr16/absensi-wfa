const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const { Op } = require('sequelize')

// ==========================================
// IMPORT MODEL
// ==========================================
const Attendance = require('../models/attendance')
const User = require('../models/user')
const Leave = require('../models/leave')

// ==========================================
// SECRET QR DINAMIS
// HARUS SAMA DENGAN YANG DIPAKAI SAAT SIGN
// ==========================================
const QR_SECRET =
    process.env.SESSION_SECRET ||
    'rahasia_super_aman_absensi_wfa_2026'


// ==========================================
// FUNGSI CEK LOGIN KARYAWAN
// ==========================================
const isKaryawan = (req, res, next) => {

    if (
        req.session &&
        req.session.user &&
        req.session.user.role === 'karyawan'
    ) {
        return next()
    }

    return res.status(401).json({
        message: 'Silakan login terlebih dahulu.'
    })
}


// ==========================================
// FUNGSI CEK ADMIN
// ==========================================
const isAdmin = (req, res, next) => {

    if (
        req.session &&
        req.session.user &&
        req.session.user.role === 'admin'
    ) {
        return next()
    }

    return res.redirect('/login')
}


// ==========================================
// LOGIKA STATUS KETERLAMBATAN
// ==========================================
//
// SHIFT PAGI  : 08:00 - 13:00
// SHIFT SIANG : 13:00 - 21:00
// SHIFT MALAM : 21:00 - 05:00
//
// Di dalam jam shift = Tepat Waktu
// Setelah jam selesai shift = Terlambat
// Sebelum shift dimulai = ditolak
// ==========================================

function hitungStatusKeterlambatan(waktuAbsen, shiftUser) {

    const dateObj = new Date(waktuAbsen)

    const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    })

    const parts =
        formatter.formatToParts(dateObj)

    let jamWIB = 0
    let menitWIB = 0

    parts.forEach(part => {

        if (part.type === 'hour') {
            jamWIB = parseInt(part.value, 10)
        }

        if (part.type === 'minute') {
            menitWIB = parseInt(part.value, 10)
        }

    })

    if (jamWIB === 24) {
        jamWIB = 0
    }

    const totalMenit =
        (jamWIB * 60) + menitWIB

    const shift =
        (shiftUser || 'pagi').toLowerCase()


    // ==========================================
    // SHIFT PAGI
    // 08:00 - 13:00
    // ==========================================

    if (shift === 'pagi') {

        const mulai = 8 * 60
        const selesai = 13 * 60

        if (
            totalMenit >= mulai &&
            totalMenit <= selesai
        ) {
            return 'Tepat Waktu'
        }

        if (totalMenit > selesai) {
            return 'Terlambat'
        }

        return 'Tepat Waktu'
    }


    // ==========================================
    // SHIFT SIANG
    // 13:00 - 21:00
    // ==========================================

    if (shift === 'siang') {

        const mulai = 13 * 60
        const selesai = 21 * 60

        if (
            totalMenit >= mulai &&
            totalMenit <= selesai
        ) {
            return 'Tepat Waktu'
        }

        if (totalMenit > selesai) {
            return 'Terlambat'
        }

        return 'Tepat Waktu'
    }


    // ==========================================
    // SHIFT MALAM
    // 21:00 - 05:00
    // ==========================================

    if (
        shift === 'malam' ||
        shift === 'sore'
    ) {

        const mulai = 21 * 60
        const selesai = 5 * 60

        if (
            totalMenit >= mulai ||
            totalMenit <= selesai
        ) {
            return 'Tepat Waktu'
        }

        return 'Terlambat'
    }


    return 'Tepat Waktu'
}


// ==========================================
// 1. PROSES ABSENSI
// ==========================================

router.post(
    '/attendance',
    isKaryawan,
    async (req, res) => {

        try {

            const {
                dynamic_token,
                latitude,
                longitude
            } = req.body


            // ==========================================
            // AMBIL USER DARI SESSION
            // ==========================================

            const sessionUserId =
                req.session.user.id

            const loggedInUser =
                await User.findByPk(sessionUserId)


            if (!loggedInUser) {

                return res.status(404).json({
                    message:
                        'Data karyawan tidak ditemukan.'
                })

            }


            let user = loggedInUser
            let tokenYangDisimpan = null


            // ==========================================
            // QR DINAMIS
            // ==========================================

            if (dynamic_token) {

                let decoded

                try {
                    const rawDynamicToken = String(dynamic_token).startsWith('WFA_DYNAMIC:')
                        ? String(dynamic_token).slice('WFA_DYNAMIC:'.length)
                        : String(dynamic_token)

                    decoded = jwt.verify(rawDynamicToken, QR_SECRET)

                } catch (error) {

                    console.error(
                        'QR JWT ERROR:',
                        error.message
                    )

                    return res.status(400).json({
                        message:
                            'QR Dinamis sudah kedaluwarsa atau tidak valid.'
                    })

                }


                // Pastikan token memang token absensi
                if (
                    !decoded ||
                    decoded.type !==
                    'dynamic_attendance_qr'
                ) {

                    return res.status(400).json({
                        message:
                            'QR Dinamis tidak valid.'
                    })

                }


                // Identitas karyawan berasal dari
                // akun yang sedang login
                user = loggedInUser


                tokenYangDisimpan =
                    `WFA_DYNAMIC:${dynamic_token}`

            }


            // QR PRIBADI / QR REGISTRASI TIDAK DITERIMA UNTUK ABSENSI.
            // Identitas karyawan diambil dari akun yang sedang login.

            // ==========================================
            // QR TIDAK ADA / BUKAN QR DINAMIS
            // ==========================================

            else {
                return res.status(400).json({
                    message: 'QR absensi tidak valid. Gunakan QR Dinamis dari Admin.'
                })
            }


            // ==========================================
            // VALIDASI GPS
            // ==========================================

            if (
                latitude === undefined ||
                latitude === null ||
                longitude === undefined ||
                longitude === null
            ) {

                return res.status(400).json({
                    message:
                        'Lokasi GPS tidak ditemukan. Silakan izinkan akses lokasi.'
                })

            }


            const lat =
                parseFloat(latitude)

            const lng =
                parseFloat(longitude)


            if (
                Number.isNaN(lat) ||
                Number.isNaN(lng)
            ) {

                return res.status(400).json({
                    message:
                        'Koordinat GPS tidak valid.'
                })

            }


            // ==========================================
            // WAKTU SEKARANG
            // ==========================================

            const now = new Date()


            // ==========================================
            // CEK SUDAH ABSEN HARI INI
            // ==========================================

            const formatterTanggal =
                new Intl.DateTimeFormat(
                    'en-CA',
                    {
                        timeZone:
                            'Asia/Jakarta',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }
                )


            const tanggalWIB =
                formatterTanggal.format(now)


            const awalHariIni =
                new Date(
                    `${tanggalWIB}T00:00:00+07:00`
                )


            const akhirHariIni =
                new Date(
                    `${tanggalWIB}T23:59:59.999+07:00`
                )


            const lastAttendance =
                await Attendance.findOne({

                    where: {

                        user_id:
                            user.id,

                        waktu: {
                            [Op.between]: [
                                awalHariIni,
                                akhirHariIni
                            ]
                        }

                    },

                    order: [
                        ['waktu', 'DESC']
                    ]

                })


            if (lastAttendance) {

                return res.status(400).json({
                    message:
                        'Anda sudah melakukan presensi hari ini!'
                })

            }


            // ==========================================
            // AMBIL JAM WIB
            // ==========================================

            const formatterJam =
                new Intl.DateTimeFormat(
                    'id-ID',
                    {
                        timeZone:
                            'Asia/Jakarta',
                        hour: 'numeric',
                        minute: 'numeric',
                        hour12: false
                    }
                )


            const timeParts =
                formatterJam.formatToParts(now)


            let jamWIB = 0
            let menitWIB = 0


            timeParts.forEach(part => {

                if (part.type === 'hour') {
                    jamWIB =
                        parseInt(
                            part.value,
                            10
                        )
                }

                if (part.type === 'minute') {
                    menitWIB =
                        parseInt(
                            part.value,
                            10
                        )
                }

            })


            if (jamWIB === 24) {
                jamWIB = 0
            }


            const totalMenit =
                (jamWIB * 60) +
                menitWIB


            const shift =
                (user.shift || 'Pagi')
                    .toLowerCase()


            // ==========================================
            // VALIDASI JAM SEBELUM SHIFT
            // ==========================================

            // SHIFT PAGI
            if (shift === 'pagi') {

                const mulai =
                    8 * 60

                if (
                    totalMenit < mulai
                ) {

                    return res.status(400).json({
                        message:
                            'Presensi gagal! Belum waktunya absen. Shift Pagi dimulai pukul 08:00 WIB.'
                    })

                }

            }


            // SHIFT SIANG
            else if (shift === 'siang') {

                const mulai =
                    13 * 60

                if (
                    totalMenit < mulai
                ) {

                    return res.status(400).json({
                        message:
                            'Presensi gagal! Belum waktunya absen. Shift Siang dimulai pukul 13:00 WIB.'
                    })

                }

            }


            // SHIFT MALAM
            else if (
                shift === 'malam' ||
                shift === 'sore'
            ) {

                const mulai =
                    21 * 60

                const selesai =
                    5 * 60


                if (
                    totalMenit > selesai &&
                    totalMenit < mulai
                ) {

                    return res.status(400).json({
                        message:
                            'Presensi gagal! Belum waktunya absen. Shift Malam dimulai pukul 21:00 WIB.'
                    })

                }

            }


            // ==========================================
            // HITUNG STATUS
            // ==========================================

            const statusTeks =
                hitungStatusKeterlambatan(
                    now,
                    user.shift
                )


            // ==========================================
            // SIMPAN ABSENSI
            // ==========================================

            await Attendance.create({

                user_id:
                    user.id,

                qr_token:
                    tokenYangDisimpan,

                latitude:
                    lat,

                longitude:
                    lng,

                statusTelat:
                    statusTeks,

                waktu:
                    now

            })


            // ==========================================
            // RESPONSE
            // ==========================================

            return res.json({

                success: true,

                message:
                    `Absensi berhasil! Status: ${statusTeks}`,

                status:
                    statusTeks

            })


        } catch (error) {

            console.error(
                'ERROR PROSES ABSENSI:',
                error
            )

            return res.status(500).json({
                message:
                    'Terjadi kesalahan server.'
            })

        }

    }
)


// ==========================================
// 2. DASHBOARD KARYAWAN
// ==========================================

router.get(
    '/dashboard/:id',
    async (req, res) => {

        try {

            const userId =
                req.params.id


            const currentUser =
                await User.findByPk(userId)


            if (!currentUser) {

                return res.status(404).send(
                    'Karyawan tidak ditemukan'
                )

            }


            const attendancesRaw =
                await Attendance.findAll({

                    where: {
                        user_id: userId
                    },

                    order: [
                        ['waktu', 'DESC']
                    ]

                })


            const attendances =
                attendancesRaw.map(att => {

                    const data =
                        att.toJSON
                            ? att.toJSON()
                            : att


                    return {

                        ...data,

                        statusTelat:
                            hitungStatusKeterlambatan(
                                data.waktu,
                                currentUser.shift
                            )

                    }

                })


            const leaves =
                await Leave.findAll({

                    where: {
                        user_id: userId
                    },

                    order: [
                        ['createdAt', 'DESC']
                    ]

                })


            const renderData = {

                currentUser:
                    currentUser.toJSON
                        ? currentUser.toJSON()
                        : currentUser,

                user:
                    req.session &&
                    req.session.user
                        ? req.session.user
                        : currentUser,

                attendances,

                leaves

            }


            res.render(
                'dashboard',
                renderData,
                (err, html) => {

                    if (err) {

                        return res.render(
                            'karyawan/dashboard',
                            renderData
                        )

                    }

                    res.send(html)

                }
            )


        } catch (error) {

            console.error(
                'Error Dashboard Karyawan:',
                error
            )

            res.status(500).send(
                'Gagal memuat dashboard karyawan'
            )

        }

    }
)


// ==========================================
// 3. HALAMAN SCAN
// ==========================================

router.get(
    '/scan',
    isKaryawan,
    (req, res) => {

        res.render('scan')

    }
)


// ==========================================
// 4. FORM IZIN
// ==========================================

router.get(
    '/leave/new',
    isKaryawan,
    (req, res) => {

        res.render(
            'leave_form',
            {
                currentUser:
                    req.session.user
            }
        )

    }
)


// ==========================================
// 5. SIMPAN IZIN
// ==========================================

router.post(
    '/leave/store',
    isKaryawan,
    async (req, res) => {

        try {

            const userId =
                req.session.user.id


            await Leave.create({

                user_id:
                    userId,

                jenis:
                    req.body.jenis,

                tanggal_mulai:
                    req.body.tanggal_mulai,

                tanggal_selesai:
                    req.body.tanggal_selesai,

                alasan:
                    req.body.alasan,

                status:
                    'Pending'

            })


            res.redirect(
                '/dashboard/' +
                userId
            )


        } catch (error) {

            console.error(
                'Error pengajuan izin:',
                error
            )

            res.status(500).send(
                'Gagal memproses pengajuan izin'
            )

        }

    }
)


// ==========================================
// 6. QR DINAMIS ADMIN
// ==========================================
//
// QR UNIVERSAL
//
// Admin menampilkan 1 QR.
// Semua karyawan bisa scan QR yang sama.
//
// Identitas karyawan TIDAK berasal dari QR.
// Identitas diambil dari session login.
//
// Token berlaku 5 menit.
// ==========================================

router.get(
    '/admin/qr-dinamis',
    isAdmin,
    async (req, res) => {

        try {

            // ==========================================
            // AMBIL ABSENSI HARI INI
            // ==========================================

            const formatterTanggal =
                new Intl.DateTimeFormat(
                    'en-CA',
                    {
                        timeZone:
                            'Asia/Jakarta',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }
                )


            const tanggalWIB =
                formatterTanggal.format(
                    new Date()
                )


            const awalHariIni =
                new Date(
                    `${tanggalWIB}T00:00:00+07:00`
                )


            const attendances =
                await Attendance.findAll({

                    where: {

                        waktu: {
                            [Op.gte]:
                                awalHariIni
                        }

                    },

                    include: [
                        {
                            model: User
                        }
                    ],

                    order: [
                        ['waktu', 'DESC']
                    ]

                })


            // ==========================================
            // BUAT JWT QR DINAMIS
            // ==========================================

            const dynamicToken =
                jwt.sign(

                    {
                        type:
                            'dynamic_attendance_qr',

                        createdAt:
                            Date.now()

                    },

                    QR_SECRET,

                    {
                        expiresIn:
                            '5m'
                    }

                )


            // ==========================================
            // DATA YANG MASUK KE QR
            // ==========================================

            const qrData =
                `WFA_DYNAMIC:${dynamicToken}`


            // ==========================================
            // RENDER
            // ==========================================

            const renderData = {

                attendances,

                qrData,

                user:
                    req.session.user

            }


            res.render(
                'admin-qr',
                renderData
            )


        } catch (error) {

            console.error(
                'Error QR Dinamis:',
                error
            )

            res.status(500).send(
                'Gagal memuat QR Dinamis Admin'
            )

        }

    }
)


module.exports = router