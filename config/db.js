const { Sequelize } = require('sequelize');

const databaseUrl =
    process.env.MYSQL_URL ||
    process.env.DATABASE_URL;

const DB_HOST =
    process.env.DB_HOST ||
    process.env.MYSQLHOST;

const DB_PORT =
    process.env.DB_PORT ||
    process.env.MYSQLPORT ||
    3306;

const DB_USER =
    process.env.DB_USER ||
    process.env.MYSQLUSER;

const DB_PASSWORD =
    process.env.DB_PASSWORD ||
    process.env.MYSQLPASSWORD;

const DB_NAME =
    process.env.DB_NAME ||
    process.env.MYSQLDATABASE;

// Jangan tampilkan password atau URL database ke log
console.log('DB CONFIG:', {
    usingUrl: Boolean(databaseUrl),
    hostConfigured: Boolean(DB_HOST),
    portConfigured: Boolean(DB_PORT),
    userConfigured: Boolean(DB_USER),
    databaseConfigured: Boolean(DB_NAME),
    passwordSet: Boolean(DB_PASSWORD)
});

let db;

if (databaseUrl) {
    // Koneksi melalui URL dari Railway MySQL
    db = new Sequelize(databaseUrl, {
        dialect: 'mysql',
        logging: false,
        dialectOptions: {
            connectTimeout: 60000
        },
        timezone: '+07:00'
    });
} else {
    // Koneksi melalui variabel terpisah
    const missingVariables = [];

    if (!DB_HOST) missingVariables.push('DB_HOST/MYSQLHOST');
    if (!DB_USER) missingVariables.push('DB_USER/MYSQLUSER');
    if (!DB_PASSWORD) missingVariables.push('DB_PASSWORD/MYSQLPASSWORD');
    if (!DB_NAME) missingVariables.push('DB_NAME/MYSQLDATABASE');

    if (missingVariables.length > 0) {
        throw new Error(
            'Konfigurasi database belum lengkap: ' +
            missingVariables.join(', ')
        );
    }

    db = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
        host: DB_HOST,
        port: Number(DB_PORT),
        dialect: 'mysql',
        logging: false,
        dialectOptions: {
            connectTimeout: 60000
        },
        timezone: '+07:00'
    });
}

module.exports = db;