const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { Op } = require('sequelize')

// ==========================================
// IMPORT MODEL
// ==========================================
const Attendance = require('../models/attendance')
const User = require('../models/user')
const Leave = require('../models/leave')

// ==========================================
// TOTP QR DINAMIS
// ==========================================
const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const TOTP_SECRET = process.env.TOTP_SECRET || ''

function base32ToBuffer(base32) {
    const clean = String(base32).toUpperCase().replace(/[^A-Z2-7]/g, '')
    if (!clean) return Buffer.alloc(0)
    let bits = ''
    for (const char of clean) {
        const value = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char)
        if (value >= 0) bits += value.toString(2).padStart(5, '0')
    }
    const bytes = []
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2))
    }
    return Buffer.from(bytes)
}

function generateTotp(secret, timestampMs = Date.now()) {
    const key = base32ToBuffer(secret)
    if (!key.length) throw new Error('TOTP_SECRET belum dikonfigurasi.')
    const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS)
    const counterBuffer = Buffer.alloc(8)
    counterBuffer.writeBigUInt64BE(BigInt(counter))
    const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest()
    const offset = hmac[hmac.length - 1] & 0x0f
    const binary =
        ((hmac[offset] & 0x7f) << 24) |
        (hmac[offset + 1] << 16) |
        (hmac[offset + 2] << 8) |
        hmac[offset + 3]
    return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0')
}

function verifyTotp(token, secret, timestampMs = Date.now()) {
    if (!/^\d{6}$/.test(String(token || ''))) return false
    for (const offset of [-1, 0, 1]) {
        if (generateTotp(secret, timestampMs + offset * TOTP_PERIOD_SECONDS * 1000) === String(token)) {
            return true
        }
    }
    return false
}

function getTotpRemainingSeconds(timestampMs = Date.now()) {
    return TOTP_PERIOD_SECONDS - (Math.floor(timestampMs / 1000) % TOTP_PERIOD_SECONDS)
}


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
                qr_token,
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

                const dynamicPrefix = 'WFA_DYNAMIC:'
                const totpToken = String(dynamic_token).startsWith(dynamicPrefix)
                    ? String(dynamic_token).slice(dynamicPrefix.length)
                    : String(dynamic_token)

                if (!TOTP_SECRET) {
                    return res.status(500).json({
                        message: 'Konfigurasi TOTP_SECRET belum tersedia di server.'
                    })
                }

                let validTotp = false
                try {
                    validTotp = verifyTotp(totpToken, TOTP_SECRET)
                } catch (error) {
                    console.error('TOTP ERROR:', error.message)
                }

                if (!validTotp) {
                    return res.status(400).json({
                        message: 'QR Dinamis tidak valid atau sudah kedaluwarsa. Silakan scan QR terbaru.'
                    })
                }

                // Identitas karyawan berasal dari akun yang sedang login.
                user = loggedInUser
                tokenYangDisimpan = `${dynamicPrefix}${totpToken}`
            }


            // ==========================================
            // QR PRIBADI
            // ==========================================

            else if (qr_token) {

                const qrUser =
                    await User.findOne({
                        where: {
                            qr_token: qr_token
                        }
                    })


                if (!qrUser) {

                    return res.status(400).json({
                        message:
                            'QR Code tidak valid.'
                    })

                }


                // QR pribadi hanya boleh dipakai
                // oleh pemilik akun
                if (
                    Number(qrUser.id) !==
                    Number(loggedInUser.id)
                ) {

                    return res.status(403).json({
                        message:
                            'QR Code bukan milik akun yang sedang login.'
                    })

                }


                user = qrUser

                tokenYangDisimpan =
                    qr_token

            }


            // ==========================================
            // QR TIDAK ADA
            // ==========================================

            else {

                return res.status(400).json({
                    message:
                        'QR Code tidak ditemukan.'
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
            // VALIDASI GEOFENCING
            // Pusat dan radius dikonfigurasi melalui Railway.
            // ==========================================
            const geofenceLat = parseFloat(process.env.GEOFENCE_LATITUDE)
            const geofenceLng = parseFloat(process.env.GEOFENCE_LONGITUDE)
            const geofenceRadius = parseFloat(process.env.GEOFENCE_RADIUS_METERS)

            if (Number.isNaN(geofenceLat) || Number.isNaN(geofenceLng) || Number.isNaN(geofenceRadius) || geofenceRadius <= 0) {
                return res.status(500).json({
                    message: 'Konfigurasi geofencing belum lengkap di server.'
                })
            }

            const toRadians = value => value * Math.PI / 180
            const earthRadiusMeters = 6371000
            const dLat = toRadians(geofenceLat - lat)
            const dLng = toRadians(geofenceLng - lng)
            const lat1 = toRadians(lat)
            const lat2 = toRadians(geofenceLat)
            const a =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
            const distanceMeters =
                2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

            if (distanceMeters > geofenceRadius) {
                return res.status(403).json({
                    message: `Presensi ditolak. Lokasi Anda berada ${Math.round(distanceMeters / 1000)} km dari titik pusat dan di luar radius geofencing ${Math.round(geofenceRadius / 1000)} km.`
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
// Token TOTP berubah setiap 30 detik.
// ==========================================

router.get(
    '/admin/qr-dinamis/token',
    isAdmin,
    (req, res) => {
        try {
            if (!TOTP_SECRET) {
                return res.status(500).json({ message: 'TOTP_SECRET belum dikonfigurasi di server.' })
            }
            const nowMs = Date.now()
            const token = generateTotp(TOTP_SECRET, nowMs)
            return res.json({
                qrData: `WFA_DYNAMIC:${token}`,
                token,
                expiresInSeconds: getTotpRemainingSeconds(nowMs)
            })
        } catch (error) {
            console.error('Error generate TOTP:', error)
            return res.status(500).json({ message: 'Gagal membuat QR Dinamis.' })
        }
    }
)


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
            // BUAT TOTP QR DINAMIS
            // ==========================================
            if (!TOTP_SECRET) {
                return res.status(500).send('TOTP_SECRET belum dikonfigurasi di server.')
            }

            const dynamicToken = generateTotp(TOTP_SECRET)

            // ==========================================
            // DATA YANG MASUK KE QR
            // ==========================================
            const qrData = `WFA_DYNAMIC:${dynamicToken}`


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