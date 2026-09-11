const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

// Import model
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

    if (!dateString) return false;

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
// FUNGSI LOGIKA KETERLAMBATAN SHIFT
// ======================================================

function hitungStatusKeterlambatan(waktuAbsen, shiftUser) {

    const dateObj = new Date(waktuAbsen);

    const formatter = new Intl.DateTimeFormat('id-ID', {

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
            jamWIB = parseInt(part.value, 10);
        }

        if (part.type === 'minute') {
            menitWIB = parseInt(part.value, 10);
        }

    });

    if (jamWIB === 24) {
        jamWIB = 0;
    }

    const totalMenitAbsen =
        (jamWIB * 60) + menitWIB;

    const shift =
        (shiftUser || 'pagi').toLowerCase();


    // SHIFT PAGI
    if (shift === 'pagi') {

        const jamMasuk = 8 * 60;

        if (totalMenitAbsen <= jamMasuk) {
            return 'Tepat Waktu';
        }

        return 'Terlambat';
    }


    // SHIFT SIANG
    else if (shift === 'siang') {

        const jamMasuk = 13 * 60;

        if (totalMenitAbsen <= jamMasuk) {
            return 'Tepat Waktu';
        }

        return 'Terlambat';
    }


    // SHIFT SORE / MALAM
    else if (
        shift === 'sore' ||
        shift === 'malam'
    ) {

        const jamMasuk = 21 * 60;

        if (
            totalMenitAbsen >= jamMasuk ||
            totalMenitAbsen <= (5 * 60)
        ) {
            return 'Tepat Waktu';
        }

        return 'Terlambat';
    }


    return 'Tepat Waktu';
}


// ======================================================
// 1. DASHBOARD ADMIN
// ======================================================

router.get('/', async (req, res) => {

    try {

        const totalKaryawan =
            await User.count({
                where: {
                    role: 'karyawan'
                }
            });


        // Ambil semua data absensi
        // beserta data User
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


        // Hitung ulang status keterlambatan
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
                        : 'pagi';

                return {

                    ...data,

                    statusTelat:
                        hitungStatusKeterlambatan(
                            data.waktu,
                            shiftUser
                        )

                };

            });


        const attendancesToday =
            allAttendances.filter(
                item => isToday(item.waktu)
            );


        const hadir =
            attendancesToday.length;


        const terlambat =
            attendancesToday.filter(
                a => a.statusTelat === 'Terlambat'
            ).length;


        const izinSakitCuti =
            await Leave.count({
                where: {
                    status: 'Pending'
                }
            });


        // Hitung jumlah shift
        const shiftPagi =
            await User.count({
                where: {
                    shift: 'Pagi',
                    role: 'karyawan'
                }
            });


        const shiftSiang =
            await User.count({
                where: {
                    shift: 'Siang',
                    role: 'karyawan'
                }
            });


        const shiftMalam =
            await User.count({

                where: {

                    shift: {
                        [Op.in]: [
                            'Malam',
                            'Sore'
                        ]
                    },

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

            shiftSore: shiftMalam

        };


        res.render(
            'admin/dashboard',
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


            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );


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
// 2.2 EDIT DATA KARYAWAN
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


            const updateData = {

                nama,

                email,

                role:
                    role || user.role,

                shift:
                    shift || user.shift

            };


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


            if (
                req.session.user &&
                req.session.user.id == userId
            ) {

                return res.status(400).send(
                    'Anda tidak bisa menghapus akun Anda sendiri.'
                );

            }


            await Attendance.destroy({

                where: {
                    user_id: userId
                }

            });


            await Leave.destroy({

                where: {
                    user_id: userId
                }

            });


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


            // Hitung ulang status
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
                            : 'pagi';


                    return {

                        ...data,

                        statusTelat:
                            hitungStatusKeterlambatan(
                                data.waktu,
                                shiftUser
                            )

                    };

                });


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
// ROUTE QR DINAMIS TIDAK DITARUH DI SINI.
//
// Route /admin/qr-dinamis ditangani
// oleh routes/attendanceRoutes.js
//
// Alasannya:
// QR Dinamis membutuhkan pembuatan dan
// verifikasi JWT token.
//
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


            res.render(
                'admin/admin-leaves',
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


            await Leave.update(

                {
                    status:
                        statusAction
                },

                {
                    where: {
                        id: id
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