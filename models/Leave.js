const { DataTypes } = require('sequelize')
const sequelize = require('../config/db')
const User = require('./User')

// PASTIKAN BARIS INI TULISANNYA SEPERTI INI:
const Leave = sequelize.define('Leave', {
    jenis: {
        type: DataTypes.ENUM('Izin', 'Sakit', 'Cuti'),
        allowNull: false
    },
    tanggal_mulai: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    tanggal_selesai: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    alasan: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('Pending', 'Disetujui', 'Ditolak'),
        defaultValue: 'Pending'
    }
})

User.hasMany(Leave, { foreignKey: 'user_id' })
Leave.belongsTo(User, { foreignKey: 'user_id' })

module.exports = Leave