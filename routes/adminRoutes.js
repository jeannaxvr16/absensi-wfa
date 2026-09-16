const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

// ======================================================
// IMPORT MODEL
// ======================================================

const User = require('../models/user');
const Attendance = require('../models/attendance');
const Leave = require('../models/leave');


// ======================================================
// MIDDLEWARE ADMIN
// ======================================================

const isAdmin = (req, res, next) => {

    if (
        req.session &&
        req.session.user &&
        req.session.user.role === 'admin'
    ) {
        return next();
    }

    return res.redirect('/login');
};

router.use(isAdmin);


// ======================================================
// FUNGSI CEK HARI INI
// ======================================================

const isToday = (dateString) => {

    if (!dateString) {
        return false;
    }

    const d = new Date(dateString);
    const today = new Date();

    const options = {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    };

    const dateStr =
        d.toLocaleDateString('id-ID', options);

    const todayStr =
        today.toLocaleDateString('id-ID', options);

    return dateStr === todayStr;
};


// ======================================================
// FUNGSI FORMAT TANGGAL JAKARTA
// ======================================================

const getTanggalJakarta = (dateString) => {

    if (!dateString) {
        return '';
    }

    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(dateString));
};


// ======================================================
// FUNGSI LOGIKA STATUS SHIFT
// ======================================================
//
// Pagi  : 08:00 - 13:00
// Siang : 13:00 - 21:00
// Malam : 21:00 - 05:00
//
// Di dalam rentang shift = Tepat Waktu
// Di luar rentang shift   = Terlambat
//
// Catatan:
// Validasi "belum masuk jam shift" dilakukan di
// attendanceRoutes.js ketika absensi dilakukan.
// Fungsi ini digunakan untuk membaca ulang status
// data yang sudah tersimpan.
// ======================================================

function hitungStatusKeterlambatan(
    waktuAbsen,
    shiftUser
) {

    if (!waktuAbsen) {
        return 'Tepat Waktu';
    }

    const dateObj =
        new Date(waktuAbsen);

    const formatter =
        new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        });

    const formattedParts =
        formatter.formatToParts(dateObj);

    let jamWIB = 0;
    let menitWIB = 0;

    formattedParts.forEach(part => {

        if (part.type === 'hour') {
            jamWIB =
                parseInt(part.value, 10);
        }

        if (part.type === 'minute') {
            menitWIB =
                parseInt(part.value, 10);
        }

    });

    if (jamWIB === 24) {
        jamWIB = 0;
    }

    const totalMenitAbsen =
        (jamWIB * 60) + menitWIB;


    const shift =
        (shiftUser || 'Pagi')
            .toString()
            .trim()
            .toLowerCase();


    // ==================================================
    // SHIFT PAGI
    // 08:00 - 13:00
    // ==================================================

    if (shift === 'pagi') {

        const jamMulai = 8 * 60;
        const jamSelesai = 13 * 60;

        if (
            totalMenitAbsen >= jamMulai &&
            totalMenitAbsen <= jamSelesai
        ) {
            return 'Tepat Waktu';
        }

        return 'Terlambat';
    }


    // ==================================================
    // SHIFT SIANG
    // 13:00 - 21:00
    // ==================================================

    if (shift === 'siang') {

        const jamMulai = 13 * 60;
        const jamSelesai = 21 * 60;

        if (
            totalMenitAbsen >= jamMulai &&
            totalMenitAbsen <= jamSelesai
        ) {
            return 'Tepat Waktu';
        }

        return 'Terlambat';
    }


    // ==================================================
    // SHIFT SORE / MALAM
    // 21:00 - 05:00
    // ==================================================

    if (
        shift === 'sore' ||
        shift === 'malam'
    ) {

        const jamMulai = 21 * 60;
        const jamSelesai = 5 * 60;

        // 21:00 - 23:59
        // ATAU
        // 00:00 - 05:00

        if (
            totalMenitAbsen >= jamMulai ||
            totalMenitAbsen <= jamSelesai
        ) {
            return 'Tepat Waktu';
        }

        return 'Terlambat';
    }


    // Jika shift tidak dikenali
    return 'Tepat Waktu';
}


// ======================================================
// 1. DASHBOARD ADMIN
// ======================================================
//
// Karena server.js menggunakan:
//
// app.use('/admin', adminRoutes)
//
// maka router.get('/') menjadi:
//
// /admin
//
// File EJS yang digunakan:
//
// views/admin/admin.ejs
// ======================================================

router.get('/', async (req, res) => {

    try {

        // ==================================================
        // TOTAL KARYAWAN
        // ==================================================

        const totalKaryawan =
            await User.count({
                where: {
                    role: 'karyawan'
                }
            });


        // ==================================================
        // AMBIL SEMUA ABSENSI
        // ==================================================

        const allAttendancesRaw =
            await Attendance.findAll({

                include: [
                    {
                        model: User
                    }
                ],

                order: [
                    ['waktu', 'DESC']
                ]

            });


        // ==================================================
        // HITUNG ULANG STATUS ABSENSI
        // BERDASARKAN SHIFT KARYAWAN
        // ==================================================

        const allAttendances =
            allAttendancesRaw.map(att => {

                const data =
                    att.toJSON
                        ? att.toJSON()
                        : att;

                const shiftUser =
                    data.User &&
                    data.User.shift
                        ? data.User.shift
                        : 'Pagi';

                return {

                    ...data,

                    statusTelat:
                        hitungStatusKeterlambatan(
                            data.waktu,
                            shiftUser
                        )

                };

            });


        // ==================================================
        // ABSENSI HARI INI
        // ==================================================

        const attendancesToday =
            allAttendances.filter(
                item => isToday(item.waktu)
            );


        // ==================================================
        // JUMLAH HADIR
        // ==================================================

        const hadir =
            attendancesToday.length;


        // ==================================================
        // JUMLAH TERLAMBAT
        // ==================================================

        const terlambat =
            attendancesToday.filter(
                a =>
                    a.statusTelat === 'Terlambat'
            ).length;


        // ==================================================
        // PENGAJUAN PENDING
        // ==================================================

        const izinSakitCuti =
            await Leave.count({
                where: {
                    status: 'Pending'
                }
            });


        // ==================================================
        // JUMLAH SHIFT PAGI
        // ==================================================

        const shiftPagi =
            await User.count({
                where: {
                    shift: 'Pagi',
                    role: 'karyawan'
                }
            });


        // ==================================================
        // JUMLAH SHIFT SIANG
        // ==================================================

        const shiftSiang =
            await User.count({
                where: {
                    shift: 'Siang',
                    role: 'karyawan'
                }
            });


        // ==================================================
        // JUMLAH SHIFT SORE / MALAM
        // ==================================================

        const shiftSore =
            await User.count({
                where: {
                    shift: 'Sore',
                    role: 'karyawan'
                }
            });


        const shiftMalam =
            await User.count({
                where: {
                    shift: 'Malam',
                    role: 'karyawan'
                }
            });


        // ==================================================
        // DATA STATISTIK
        // ==================================================

        const stats = {

            totalKaryawan,

            hadir,

            terlambat,

            izinSakitCuti,

            shiftPagi,

            shiftSiang,

            shiftSore,

            shiftMalam

        };


        // ==================================================
        // RENDER DASHBOARD
        // ==================================================

        res.render(
            'admin/admin',
            {
                user:
                    req.session.user,

                stats,

                attendances:
                    attendancesToday
            }
        );


    } catch (error) {

        console.error(
            'Error Admin Dashboard:',
            error
        );

        res.status(500).send(
            'Terjadi kesalahan pada server'
        );

    }

});


// ======================================================
// 1.1 API SEARCH KARYAWAN
// ======================================================

router.get(
    '/users/search',
    async (req, res) => {

        try {

            const query =
                req.query.q || '';


            if (!query.trim()) {
                return res.json([]);
            }


            const users =
                await User.findAll({

                    where: {

                        role: 'karyawan',

                        [Op.or]: [

                            {
                                nama: {
                                    [Op.like]:
                                        `%${query}%`
                                }
                            },

                            {
                                email: {
                                    [Op.like]:
                                        `%${query}%`
                                }
                            }

                        ]

                    },

                    limit: 5

                });


            res.json(users);


        } catch (error) {

            console.error(
                'Error Search User API:',
                error
            );

            res.status(500).json({

                error:
                    'Gagal mencari data karyawan'

            });

        }

    }
);


// ======================================================
// 1.2 EDIT PROFIL ADMIN
// ======================================================

router.post(
    '/profile/update',
    async (req, res) => {

        try {

            const adminId =
                req.session.user.id;


            const {
                nama,
                email,
                password
            } = req.body;


            const updateData = {

                nama,

                email

            };


            // Jika password diisi,
            // password akan di-hash ulang

            if (
                password &&
                password.trim() !== ''
            ) {

                updateData.password =
                    await bcrypt.hash(
                        password,
                        10
                    );

            }


            await User.update(

                updateData,

                {
                    where: {
                        id: adminId
                    }
                }

            );


            // Update session
            req.session.user.nama =
                nama;

            req.session.user.email =
                email;


            res.redirect('/admin');


        } catch (error) {

            console.error(
                'Error Update Profil Admin:',
                error
            );

            res.status(500).send(
                'Gagal memperbarui profil admin'
            );

        }

    }
);


// ======================================================
// 2. MASTER DATA
// ======================================================

router.get(
    '/master-data',
    async (req, res) => {

        try {

            const users =
                await User.findAll({

                    order: [
                        ['nama', 'ASC']
                    ]

                });


            res.render(
                'admin/master-data',
                {

                    user:
                        req.session.user,

                    users

                }
            );


        } catch (error) {

            console.error(
                'Error Master Data:',
                error
            );

            res.status(500).send(
                'Gagal memuat Master Data'
            );

        }

    }
);


// ======================================================
// 2.1 TAMBAH KARYAWAN
// ======================================================

router.post(
    '/users/add',
    async (req, res) => {

        try {

            const {
                nama,
                email,
                password,
                role,
                shift
            } = req.body;


            // ==================================================
            // CEK EMAIL
            // ==================================================

            const existingUser =
                await User.findOne({
                    where: {
                        email
                    }
                });


            if (existingUser) {

                return res.status(400).send(
                    'Email sudah digunakan oleh pengguna lain.'
                );

            }


            // ==================================================
            // HASH PASSWORD
            // ==================================================

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );


            // ==================================================
            // BUAT USER
            // ==================================================

            await User.create({

                nama,

                email,

                password:
                    hashedPassword,

                role:
                    role || 'karyawan',

                shift:
                    shift || 'Pagi'

            });


            res.redirect(
                '/admin/master-data'
            );


        } catch (error) {

            console.error(
                'Error Tambah User:',
                error
            );

            res.status(500).send(
                'Gagal menambahkan karyawan baru'
            );

        }

    }
);


// ======================================================
// 2.2 RESET DEVICE KARYAWAN
// ======================================================
// Dipakai Admin jika karyawan berganti HP/browser.
// Setelah di-reset, login berikutnya dari perangkat baru
// akan menjadi perangkat yang terikat ke akun tersebut.
// ======================================================

router.post(
    '/users/reset-device/:id',
    async (req, res) => {

        try {
            const user = await User.findByPk(req.params.id)

            if (!user) {
                return res.status(404).send('Karyawan tidak ditemukan')
            }

            if (user.role !== 'karyawan') {
                return res.status(400).send('Device binding hanya digunakan untuk akun karyawan')
            }

            await user.update({ device_id: null })

            res.redirect('/admin/master-data')

        } catch (error) {
            console.error('Error Reset Device:', error)
            res.status(500).send('Gagal mereset perangkat karyawan')
        }
    }
)


// ======================================================
// 2.3 EDIT DATA KARYAWAN
// ======================================================

router.post(
    '/users/edit/:id',
    async (req, res) => {

        try {

            const userId =
                req.params.id;


            const {
                nama,
                email,
                password,
                role,
                shift
            } = req.body;


            const user =
                await User.findByPk(
                    userId
                );


            if (!user) {

                return res.status(404).send(
                    'Karyawan tidak ditemukan'
                );

            }


            // ==================================================
            // DATA YANG AKAN DIUPDATE
            // ==================================================

            const updateData = {

                nama,

                email,

                role:
                    role || user.role,

                shift:
                    shift || user.shift

            };


            // ==================================================
            // UPDATE PASSWORD JIKA DIISI
            // ==================================================

            if (
                password &&
                password.trim() !== ''
            ) {

                updateData.password =
                    await bcrypt.hash(
                        password,
                        10
                    );

            }


            await User.update(

                updateData,

                {
                    where: {
                        id: userId
                    }
                }

            );


            res.redirect(
                '/admin/master-data'
            );


        } catch (error) {

            console.error(
                'Error Edit User:',
                error
            );

            res.status(500).send(
                'Gagal memperbarui data karyawan'
            );

        }

    }
);


// ======================================================
// 2.3 HAPUS DATA KARYAWAN
// ======================================================

router.post(
    '/users/delete/:id',
    async (req, res) => {

        try {

            const userId =
                req.params.id;


            // ==================================================
            // ADMIN TIDAK BOLEH MENGHAPUS AKUN SENDIRI
            // ==================================================

            if (
                req.session.user &&
                req.session.user.id == userId
            ) {

                return res.status(400).send(
                    'Anda tidak bisa menghapus akun Anda sendiri.'
                );

            }


            // ==================================================
            // HAPUS ABSENSI MILIK USER
            // ==================================================

            await Attendance.destroy({

                where: {
                    user_id: userId
                }

            });


            // ==================================================
            // HAPUS PENGAJUAN MILIK USER
            // ==================================================

            await Leave.destroy({

                where: {
                    user_id: userId
                }

            });


            // ==================================================
            // HAPUS USER
            // ==================================================

            await User.destroy({

                where: {
                    id: userId
                }

            });


            res.redirect(
                '/admin/master-data'
            );


        } catch (error) {

            console.error(
                'Error Hapus User:',
                error
            );

            res.status(500).send(
                'Gagal menghapus data karyawan'
            );

        }

    }
);


// ======================================================
// 3. LAPORAN
// ======================================================

router.get(
    '/reports',
    async (req, res) => {

        try {

            const {
                startDate,
                endDate
            } = req.query;


            // ==================================================
            // FILTER TANGGAL
            // ==================================================

            let whereCondition = {};


            if (
                startDate &&
                endDate
            ) {

                whereCondition.waktu = {

                    [Op.between]: [

                        new Date(
                            `${startDate}T00:00:00.000+07:00`
                        ),

                        new Date(
                            `${endDate}T23:59:59.999+07:00`
                        )

                    ]

                };

            }


            // ==================================================
            // AMBIL DATA ABSENSI
            // ==================================================

            const attendancesRaw =
                await Attendance.findAll({

                    where:
                        whereCondition,

                    include: [
                        {
                            model: User
                        }
                    ],

                    order: [
                        ['waktu', 'DESC']
                    ]

                });


            // ==================================================
            // HITUNG ULANG STATUS
            // ==================================================

            const attendances =
                attendancesRaw.map(att => {

                    const data =
                        att.toJSON
                            ? att.toJSON()
                            : att;

                    const shiftUser =
                        data.User &&
                        data.User.shift
                            ? data.User.shift
                            : 'Pagi';


                    return {

                        ...data,

                        statusTelat:
                            hitungStatusKeterlambatan(
                                data.waktu,
                                shiftUser
                            )

                    };

                });


            // ==================================================
            // RENDER LAPORAN
            // ==================================================

            res.render(
                'admin/reports',
                {

                    user:
                        req.session.user,

                    attendances,

                    startDate:
                        startDate || '',

                    endDate:
                        endDate || ''

                }
            );


        } catch (error) {

            console.error(
                'Error Laporan:',
                error
            );

            res.status(500).send(
                'Gagal memuat Laporan'
            );

        }

    }
);


// ======================================================
// 4. QR DINAMIS
// ======================================================
//
// JANGAN BUAT ROUTE QR DINAMIS DI SINI.
//
// Route:
//
// /admin/qr-dinamis
//
// sudah ditangani oleh:
//
// routes/attendanceRoutes.js
//
// Hal ini dilakukan supaya tidak terjadi
// bentrokan antara dua route QR Dinamis.
// ======================================================


// ======================================================
// 5. IZIN / CUTI / SAKIT
// ======================================================

router.get(
    '/leaves',
    async (req, res) => {

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

                });


            // ==================================================
            // FILE YANG DIGUNAKAN:
            //
            // views/admin-leaves.ejs
            //
            // BUKAN:
            // views/admin/admin-leaves.ejs
            // ==================================================

            res.render(
                'admin-leaves',
                {

                    user:
                        req.session.user,

                    leaves

                }
            );


        } catch (error) {

            console.error(
                'Error Leaves:',
                error
            );

            res.status(500).send(
                'Gagal memuat data izin/cuti'
            );

        }

    }
);


// ======================================================
// 5.1 PROSES AKSI SETUJU / TOLAK IZIN
// ======================================================

router.post(
    '/leaves/:id/action',
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            const {
                statusAction
            } = req.body;


            // ==================================================
            // VALIDASI STATUS
            // ==================================================

            if (
                statusAction !== 'Disetujui' &&
                statusAction !== 'Ditolak'
            ) {

                return res.status(400).send(
                    'Status pengajuan tidak valid'
                );

            }


            // ==================================================
            // UPDATE STATUS
            // ==================================================

            await Leave.update(

                {
                    status:
                        statusAction
                },

                {
                    where: {
                        id
                    }
                }

            );


            res.redirect(
                '/admin/leaves'
            );


        } catch (error) {

            console.error(
                'Error Action Leave:',
                error
            );

            res.status(500).send(
                'Gagal memproses pengajuan izin'
            );

        }

    }
);


// ======================================================
// EXPORT ROUTER
// ======================================================

module.exports = router;