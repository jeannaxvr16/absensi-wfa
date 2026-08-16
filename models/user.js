const { DataTypes } = require('sequelize')
const sequelize = require('../config/db')

const User = sequelize.define('User', {
    nama: {
        type: DataTypes.STRING
    },

    email: {
        type: DataTypes.STRING
    },

    password: {
        type: DataTypes.STRING
    },

    qr_token: {
        type: DataTypes.STRING
    },

    // --- TAMBAHAN KOLOM BARU UNTUK SHIFT OTOMATIS ---
    shift: {
        type: DataTypes.STRING,
        allowNull: true,          // Di-set true dulu biar user lama yang belum punya data shift tidak eror
        defaultValue: 'Pagi'      // Secara default, jika tidak diisi akan otomatis masuk Shift Pagi
    },

    // ====================================================
    // TIMPA DI SINI: TAMBAHAN KOLOM ROLE UNTUK MEMBEDAKAN HAK AKSES
    // ====================================================
    role: {
        type: DataTypes.ENUM('admin', 'karyawan'),
        allowNull: false,
        defaultValue: 'karyawan'  // Secara default jika tidak memilih, otomatis jadi karyawan
    }
})

module.exports = User