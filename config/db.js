const { Sequelize } = require('sequelize');

// Ambil nilai dari DB_* atau bawaan MYSQL* Railway
const DB_NAME = process.env.DB_NAME || process.env.MYSQLDATABASE;
const DB_USER = process.env.DB_USER || process.env.MYSQLUSER;
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD;
const DB_HOST = process.env.DB_HOST || process.env.MYSQLHOST;
const DB_PORT = process.env.DB_PORT || process.env.MYSQLPORT || 3306;

console.log('DB CONFIG:', {
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    database: DB_NAME,
    passwordSet: !!DB_PASSWORD
});

// Jika menggunakan URL koneksi penuh (MYSQL_URL)
const db = process.env.MYSQL_URL
    ? new Sequelize(process.env.MYSQL_URL, {
        dialect: 'mysql',
        logging: false,
        dialectOptions: { connectTimeout: 60000 }
      })
    : new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
        host: DB_HOST,
        port: Number(DB_PORT),
        dialect: 'mysql',
        logging: false,
        dialectOptions: { connectTimeout: 60000 }
      });

module.exports = db;