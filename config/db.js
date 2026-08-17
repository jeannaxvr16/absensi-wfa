const { Sequelize } = require('sequelize');

// Ambil koneksi dari MYSQL_URL Railway atau variabel terpisah
const databaseUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

const DB_HOST = process.env.DB_HOST || process.env.MYSQLHOST;
const DB_PORT = process.env.DB_PORT || process.env.MYSQLPORT || 3306;
const DB_USER = process.env.DB_USER || process.env.MYSQLUSER;
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD;
const DB_NAME = process.env.DB_NAME || process.env.MYSQLDATABASE;

console.log('DB CONFIG:', {
  usingUrl: !!databaseUrl,
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  database: DB_NAME,
  passwordSet: !!DB_PASSWORD
});

let db;

if (databaseUrl) {
  db = new Sequelize(databaseUrl, {
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      connectTimeout: 60000
    }
  });
} else {
  db = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: Number(DB_PORT),
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      connectTimeout: 60000
    }
  });
}

module.exports = db;