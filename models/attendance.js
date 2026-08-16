const { DataTypes } = require('sequelize')
const sequelize = require('../config/db')

const Attendance = sequelize.define('Attendance', {

    user_id: {
    type: DataTypes.INTEGER
},

    qr_token: {
        type: DataTypes.STRING
    },

    latitude: {
        type: DataTypes.STRING
    },

    longitude: {
        type: DataTypes.STRING
    },

    waktu: {
        type: DataTypes.DATE
    }

})

module.exports = Attendance