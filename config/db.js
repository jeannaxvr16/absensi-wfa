const { Sequelize } = require('sequelize')

const sequelize = new Sequelize(
    'absensi_wfa',
    'root',
    '',
    {
        host: 'localhost',
        dialect: 'mysql'
    }
)

module.exports = sequelize