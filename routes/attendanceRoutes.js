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
    const dateObj = new Date(waktuAbsen)

    const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    })

    const formattedParts = formatter.formatToParts(dateObj)

    let jamWIB = 0
    let menitWIB = 0

    formattedParts.forEach(part => {
        if (part.type === 'hour') jamWIB = parseInt(part.value, 10)
        if (part.type === 'minute') menitWIB = parseInt(part.value, 10)
    })

    if (jamWIB === 24) jamWIB = 0

    const totalMenitAbsen = (jamWIB * 60) + menitWIB
    const shift = (shiftUser || 'pagi').toLowerCase()

    // ==========================================
    // SHIFT PAGI 08:00 - 13:00
    // ==========================================
    if (shift === 'pagi') {
        const jamMulai = 8 * 60
        const jamSelesai = 13 * 60

        if (
            totalMenitAbsen >= jamMulai &&
            totalMenitAbsen <= jamSelesai
        ) {
            return 'Tepat Waktu'
        }

        return 'Terlambat'
    }

    // ==========================================
    // SHIFT SIANG 13:00 - 21:00
    // ==========================================
    else if (shift === 'siang') {
        const jamMulai = 13 * 60
        const jamSelesai = 21 * 60

        if (
            totalMenitAbsen >= jamMulai &&
            totalMenitAbsen <= jamSelesai
        ) {
            return 'Tepat Waktu'
        }

        return 'Terlambat'
    }

    // ==========================================
    // SHIFT MALAM 21:00 - 05:00
    // ==========================================
    else if (shift === 'sore' || shift === 'malam') {
        const jamMulai = 21 * 60
        const jamSelesai = 5 * 60

        if (
            totalMenitAbsen >= jamMulai ||
            totalMenitAbsen <= jamSelesai
        ) {
            return 'Tepat Waktu'
        }

        return 'Terlambat'
    }

    return 'Tepat Waktu'
}


// ==========================================
// 1. PROSES ABSENSI QR
// ==========================================
router.post('/attendance', async (req, res) => {
    try {

        // ==========================================
        // DATA DARI FRONTEND
        // ==========================================
        const {
            qr_token,
            dynamic_token,
            latitude,
            longitude
        } = req.body


        // ==========================================
        // WAJIB LOGIN
        // ==========================================
        if (!req.session || !req.session.user) {
            return res.status(401).json({
                message: 'Silakan login terlebih dahulu sebelum melakukan presensi.'
            })
        }


        // ==========================================
        // AMBIL USER DARI SESSION LOGIN
        // ==========================================
        const sessionUserId = req.session.user.id

        const loggedInUser = await User.findByPk(sessionUserId)

        if (!loggedInUser) {
            return res.status(404).json({
                message: 'Data karyawan tidak ditemukan.'
            })
        }


        // ==========================================
        // CEK QR
        // ==========================================

        let user = loggedInUser

        // ------------------------------------------
        // QR DINAMIS ADMIN
        // ------------------------------------------
        if (dynamic_token) {

            // Format QR Dinamis:
            // WFA_DYNAMIC:TOKEN

            if (!dynamic_token.startsWith('WFA_DYNAMIC:')) {
                return res.status(400).json({
                    message: 'QR Dinamis tidak valid.'
                })
            }

            const token = dynamic_token.replace('WFA_DYNAMIC:', '')

            if (!token) {
                return res.status(400).json({
                    message: 'Token QR Dinamis tidak ditemukan.'
                })
            }

            /*
             * Untuk QR Dinamis, identitas karyawan
             * TIDAK diambil dari QR.
             *
             * Identitas diambil dari akun yang sedang login.
             */
            user = loggedInUser
        }

        // ------------------------------------------
        // QR PRIBADI KARYAWAN
        // ------------------------------------------
        else if (qr_token) {

            const qrUser = await User.findOne({
                where: {
                    qr_token: qr_token
                }
            })

            if (!qrUser) {
                return res.status(400).json({
                    message: 'QR Code tidak valid.'
                })
            }

            /*
             * Supaya QR pribadi milik karyawan lain
             * tidak bisa dipakai oleh akun berbeda.
             */
            if (Number(qrUser.id) !== Number(loggedInUser.id)) {
                return res.status(403).json({
                    message: 'QR Code bukan milik akun karyawan yang sedang login.'
                })
            }

            user = qrUser
        }

        // ------------------------------------------
        // TIDAK ADA QR
        // ------------------------------------------
        else {
            return res.status(400).json({
                message: 'QR Code tidak ditemukan.'
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
                message: 'Lokasi GPS tidak ditemukan. Silakan izinkan akses lokasi.'
            })
        }


        // ==========================================
        // CEK PRESENSI HARI INI
        // ==========================================
        const sekarang = new Date()

        const awalHariIni = new Date(sekarang)
        awalHariIni.setHours(0, 0, 0, 0)

        const akhirHariIni = new Date(sekarang)
        akhirHariIni.setHours(23, 59, 59, 999)

        const lastAttendance = await Attendance.findOne({
            where: {
                user_id: user.id,
                waktu: {
                    [Op.between]: [
                        awalHariIni,
                        akhirHariIni
                    ]
                }
            },
            order: [['waktu', 'DESC']]
        })


        if (lastAttendance) {
            return res.status(400).json({
                message: 'Anda sudah melakukan presensi hari ini!'
            })
        }


        // ==========================================
        // WAKTU WIB
        // ==========================================
        const now = new Date()

        const formatter = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        })

        const parts = formatter.formatToParts(now)

        let jamWIB = 0
        let menitWIB = 0

        parts.forEach(p => {
            if (p.type === 'hour') {
                jamWIB = parseInt(p.value, 10)
            }

            if (p.type === 'minute') {
                menitWIB = parseInt(p.value, 10)
            }
        })

        if (jamWIB === 24) {
            jamWIB = 0
        }


        const totalMenit = (jamWIB * 60) + menitWIB
        const shift = (user.shift || 'pagi').toLowerCase()


        // ==========================================
        // VALIDASI SEBELUM JAM SHIFT
        // ==========================================

        // SHIFT PAGI
        if (shift === 'pagi') {

            const jamMulaiPagi = 8 * 60

            if (totalMenit < jamMulaiPagi) {
                return res.status(400).json({
                    message:
                        'Presensi gagal! Belum waktunya absen. Shift Pagi dimulai pukul 08:00 WIB.'
                })
            }
        }

        // SHIFT SIANG
        else if (shift === 'siang') {

            const jamMulaiSiang = 13 * 60

            if (totalMenit < jamMulaiSiang) {
                return res.status(400).json({
                    message:
                        'Presensi gagal! Belum waktunya absen. Shift Siang dimulai pukul 13:00 WIB.'
                })
            }
        }

        // SHIFT MALAM
        else if (shift === 'sore' || shift === 'malam') {

            const jamMulaiMalam = 21 * 60
            const jamSelesaiMalam = 5 * 60

            if (
                totalMenit > jamSelesaiMalam &&
                totalMenit < jamMulaiMalam
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
            hitungStatusKeterlambatan(now, shift)


        // ==========================================
        // TOKEN YANG DISIMPAN
        // ==========================================
        const tokenYangDisimpan =
            dynamic_token || qr_token


        // ==========================================
        // SIMPAN PRESENSI
        // ==========================================
        await Attendance.create({
            user_id: user.id,
            qr_token: tokenYangDisimpan,
            latitude: latitude,
            longitude: longitude,
            statusTelat: statusTeks,
            waktu: now
        })


        // ==========================================
        // RESPONSE
        // ==========================================
        res.json({
            message: `Absensi berhasil! Status: ${statusTeks}`,
            status: statusTeks
        })


    } catch (error) {

        console.error(
            'Error proses absensi:',
            error
        )

        res.status(500).json({
            message: 'Terjadi kesalahan server.'
        })
    }
})


// ==========================================
// DASHBOARD KARYAWAN
// ==========================================
router.get('/dashboard/:id', async (req, res) => {

    try {

        const userId = req.params.id

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
                    att.toJSON ?
                        att.toJSON() :
                        att

                return {
                    ...data,

                    statusTelat:
                        hitungStatusKeterlambatan(
                            data.waktu,
                            currentUser.shift || 'pagi'
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
                currentUser.toJSON ?
                    currentUser.toJSON() :
                    currentUser,

            user:
                req.session &&
                req.session.user ?
                    req.session.user :
                    currentUser,

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
})


// ==========================================
// HALAMAN SCAN
// ==========================================
router.get('/scan', async (req, res) => {

    try {

        res.render('scan')

    } catch (error) {

        console.error(
            'Error scan:',
            error
        )

        res.status(500).send(
            'Gagal memuat halaman scan'
        )
    }
})


// ==========================================
// FORM PENGAJUAN IZIN
// ==========================================
router.get('/leave/new', (req, res) => {

    const loggedInUser =
        (req.session && req.session.user)
            ? req.session.user
            : {
                id: 1,
                nama: 'Karyawan',
                shift: 'Pagi'
            }

    res.render(
        'leave_form',
        {
            currentUser: loggedInUser
        }
    )
})


router.post('/leave/store', async (req, res) => {

    try {

        await Leave.create({

            user_id:
                req.body.user_id,

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
            req.body.user_id
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
})


// ==========================================
// ADMIN - KELOLA IZIN
// ==========================================
router.get('/admin/leaves', async (req, res) => {

    try {

        const leaves =
            await Leave.findAll({

                include: [
                    {
                        model: User
                    }
                ],

                order: [
                    ['createdAt', 'DESC']
                ]
            })


        res.render(
            'admin/leaves',
            (err, html) => {

                if (err) {
                    return res.render(
                        'admin-leaves',
                        {
                            leaves
                        }
                    )
                }

                res.send(html)
            }
        )

    } catch (error) {

        console.error(
            'Error admin leaves:',
            error
        )

        res.status(500).send(
            'Gagal memuat data pengajuan izin'
        )
    }
})


router.post(
    '/admin/leaves/:id/action',
    async (req, res) => {

        try {

            const {
                statusAction
            } = req.body


            await Leave.update(

                {
                    status:
                        statusAction
                },

                {
                    where: {
                        id:
                            req.params.id
                    }
                }
            )


            res.redirect(
                '/admin/leaves'
            )

        } catch (error) {

            console.error(
                'Error aksi izin:',
                error
            )

            res.status(500).send(
                'Gagal memperbarui status pengajuan'
            )
        }
    }
)


router.post(
    '/admin/leaves/delete/:id',
    async (req, res) => {

        try {

            await Leave.destroy({

                where: {
                    id:
                        req.params.id
                }
            })


            res.redirect(
                '/admin/leaves'
            )

        } catch (error) {

            console.error(
                'Error hapus izin:',
                error
            )

            res.status(500).send(
                'Gagal menghapus pengajuan izin'
            )
        }
    }
)


// ==========================================
// QR DINAMIS ADMIN
// ==========================================
router.get(
    '/admin/qr-dinamis',
    async (req, res) => {

        try {

            const awalHariIni =
                new Date()

            awalHariIni.setHours(
                0,
                0,
                0,
                0
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


            /*
             * QR DINAMIS UNIVERSAL
             *
             * QR ini bukan milik satu karyawan.
             * Semua karyawan boleh scan.
             *
             * Format:
             * WFA_DYNAMIC:TOKEN
             */

            const crypto =
                require('crypto')


            const token =
                crypto
                    .randomBytes(24)
                    .toString('hex')


            const qrData =
                `WFA_DYNAMIC:${token}`


            const renderData = {
                attendances,
                qrData,
                user:
                    req.session &&
                    req.session.user
                        ? req.session.user
                        : {
                            nama: 'Admin'
                        }
            }


            res.render(
                'admin/qr-dinamis',
                renderData,
                (err, html) => {

                    if (err) {

                        return res.render(
                            'admin-qr',
                            renderData
                        )
                    }

                    res.send(html)
                }
            )

        } catch (error) {

            console.error(
                'Error QR Dinamis:',
                error
            )

            res.status(500).send(
                'Gagal memuat halaman QR Dinamis Admin'
            )
        }
    }
)


// ==========================================
// DASHBOARD ADMIN
// ==========================================
router.get('/admin', async (req, res) => {

    try {

        const attendancesRaw =
            await Attendance.findAll({

                include: [
                    {
                        model: User
                    }
                ],

                order: [
                    ['waktu', 'DESC']
                ]
            }).catch(() => [])


        const users =
            await User.findAll()
                .catch(() => [])


        const pendingLeaves =
            await Leave.findAll({

                where: {
                    status: 'Pending'
                }

            }).catch(() => [])


        let jumlahTerlambatHariIni = 0

        const hariIniTeks =
            new Date().toDateString()


        const totalShiftPagi =
            users.filter(
                u =>
                    u.shift &&
                    u.shift.toLowerCase() === 'pagi'
            ).length


        const totalShiftSiang =
            users.filter(
                u =>
                    u.shift &&
                    u.shift.toLowerCase() === 'siang'
            ).length


        const totalShiftSore =
            users.filter(
                u =>
                    u.shift &&
                    (
                        u.shift.toLowerCase() === 'sore' ||
                        u.shift.toLowerCase() === 'malam'
                    )
            ).length


        const attendances =
            attendancesRaw.map(att => {

                const data =
                    att.toJSON ?
                        att.toJSON() :
                        att


                const matchUser =
                    data.User ||
                    users.find(
                        u =>
                            u.id === data.user_id
                    )


                const shiftKaryawan =
                    matchUser &&
                    matchUser.shift
                        ? matchUser.shift
                        : 'pagi'


                const statusTeks =
                    hitungStatusKeterlambatan(
                        data.waktu,
                        shiftKaryawan
                    )


                if (
                    statusTeks === 'Terlambat' &&
                    new Date(data.waktu)
                        .toDateString() ===
                        hariIniTeks
                ) {

                    jumlahTerlambatHariIni++
                }


                return {

                    ...data,

                    statusTelat:
                        statusTeks,

                    User:
                        matchUser
                            ? (
                                matchUser.toJSON
                                    ? matchUser.toJSON()
                                    : matchUser
                            )
                            : {
                                nama: 'Karyawan'
                            }
                }
            })


        const stats = {

            totalKaryawan:
                users.length,

            hadir:
                attendances.filter(
                    a =>
                        new Date(a.waktu)
                            .toDateString() ===
                        hariIniTeks
                ).length,

            terlambat:
                jumlahTerlambatHariIni,

            izinSakitCuti:
                pendingLeaves.length,

            shiftPagi:
                totalShiftPagi,

            shiftSiang:
                totalShiftSiang,

            shiftSore:
                totalShiftSore,

            shiftMalam:
                totalShiftSore
        }


        const renderPayload = {

            attendances,

            stats,

            user:
                (
                    req.session &&
                    req.session.user
                )
                    ? req.session.user
                    : {
                        nama: 'Admin'
                    }
        }


        res.render(
            'admin/dashboard',
            renderPayload,
            (err, html) => {

                if (err) {

                    return res.render(
                        'admin/admin',
                        renderPayload
                    )
                }

                res.send(html)
            }
        )

    } catch (error) {

        console.error(
            'Error Dashboard Admin:',
            error
        )

        res.status(500).send(
            'Gagal memuat dashboard admin'
        )
    }
})


module.exports = router