const { Sequelize } = require('sequelize');

const db = new Sequelize(process.env.MYSQL_URL, {
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
        connectTimeout: 60000
    }
});

module.exports = db;