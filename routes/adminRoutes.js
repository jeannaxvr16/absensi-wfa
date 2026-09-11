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

        // Hitung ulang status berdasarkan
        // shift masing-masing karyawan
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

        // Ambil absensi hari ini
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

        // ==================================================
        // JUMLAH KARYAWAN PER SHIFT
        // ==================================================

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

        // ==================================================
        // RENDER DASHBOARD
        // File yang benar:
        // views/admin/admin.ejs
        // ==================================================

        res.render(
            'admin/admin',
            {
                user: req.session.user,
                stats,
                attendances: attendancesToday
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