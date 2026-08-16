const { Sequelize } = require('sequelize');

// Menggunakan MYSQL_URI dari Railway jika ada, atau fallback ke variabel terpisah
const db = process.env.MYSQL_URI 
    ? new Sequelize(process.env.MYSQL_URI, {
        dialect: 'mysql',
        logging: false,
        dialectOptions: {
            connectTimeout: 60000
        }
      })
    : new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASSWORD,
        {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
            dialect: 'mysql',
            logging: false,
            dialectOptions: {
                connectTimeout: 60000
            }
        }
      );

module.exports = db;