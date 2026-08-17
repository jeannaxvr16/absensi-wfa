const { Sequelize } = require('sequelize');

console.log('DB CONFIG:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    passwordSet: !!process.env.DB_PASSWORD
});

const db = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        dialect: 'mysql',
        logging: false,
        dialectOptions: {
            connectTimeout: 60000
        }
    }
);

module.exports = db;